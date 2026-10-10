import { memo, type HTMLAttributes, type ReactNode } from 'react';
import { Handle, Position, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import { Cube, Database, Globe, HardDrive, Internet, Plus, Timer } from 'iconoir-react';
import { describeCronSchedule } from '@/lib/cron-schedule';
import { cn } from '@/lib/utils';
import type {
  AppData,
  AppPhase,
  BucketData,
  CanvasNodeData,
  CanvasNodeKind,
  CronData,
  DomainData,
  PostgresData,
} from './topology';

export type ConnectSide = 'in' | 'out';
export type FlowNode = Node<
  CanvasNodeData & { onConnect?: (side: ConnectSide) => void; onRetry?: () => void },
  CanvasNodeKind
>;

const CATEGORY: Record<Exclude<CanvasNodeKind, 'internet'>, string> = {
  domain: 'var(--cat-network)',
  app: 'var(--cat-compute)',
  cron: 'var(--cat-compute)',
  bucket: 'var(--cat-storage)',
  postgres: 'var(--cat-storage)',
};

const PHASE: Record<AppPhase, { label: string; color: string }> = {
  running: { label: 'Serving', color: 'var(--status-good)' },
  parked: { label: 'Parked · snapshot', color: 'var(--status-warning)' },
  idle: { label: 'Idle', color: 'var(--chart-muted)' },
  deploying: { label: 'Deploying', color: 'var(--status-warning)' },
  error: { label: 'Error', color: 'var(--status-critical)' },
  undeployed: { label: 'Undeployed', color: 'var(--chart-muted)' },
};

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const shortCount = (n: number) => compact.format(n).toLowerCase();

function Glyph({ kind, children }: { kind: keyof typeof CATEGORY; children: ReactNode }) {
  const color = CATEGORY[kind];
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-lg [&>svg]:size-4"
      style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      {children}
    </span>
  );
}

function Glass({
  selected,
  tone,
  className,
  children,
  ...rest
}: {
  selected: boolean;
  tone?: 'warning' | 'critical';
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        'canvas-node relative flex items-center gap-3 rounded-xl border border-canvas-glass-border bg-canvas-glass px-3.5 shadow-elevation-2 backdrop-blur-md',
        'transition-[box-shadow,border-color,transform] duration-[var(--motion-fast)] ease-console',
        'hover:-translate-y-px hover:border-border-secondary hover:shadow-elevation-3',
        tone === 'warning' && 'border-status-warning/35',
        tone === 'critical' && 'border-status-critical/35 border-t-status-critical/60',
        selected && 'shadow-elevation-3 ring-[1.5px] ring-brand',
        className
      )}
    >
      {children}
    </div>
  );
}

function Title({ children, max = 'max-w-[140px]' }: { children: string; max?: string }) {
  return (
    <span
      title={children}
      className={cn(
        'block truncate text-[14px] font-semibold tracking-[-0.005em] text-foreground',
        max
      )}
    >
      {children}
    </span>
  );
}

function Meta({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
      {color && (
        <span aria-hidden className="size-1.5 rounded-full" style={{ background: color }} />
      )}
      {children}
    </span>
  );
}

function Metrics({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 flex gap-2.5 text-[11.5px] tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

function PlusButton({
  label,
  onClick,
  className,
  shown,
}: {
  label: string;
  onClick: () => void;
  className: string;
  shown: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-shown={String(shown)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'nodrag pressable absolute top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-lg border border-brand/40 bg-brand-muted text-brand',
        'transition-opacity duration-[var(--motion-fast)] focus-visible:opacity-100',
        shown ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        className
      )}
    >
      <Plus aria-hidden className="size-3.5" strokeWidth={2.2} />
    </button>
  );
}

export const InternetNode = memo(function InternetNode() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="canvas-node grid size-11 place-items-center rounded-full border border-canvas-glass-border bg-canvas-glass shadow-elevation-2">
        <Internet aria-hidden className="size-[18px] text-foreground" />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Internet
      </span>
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

export const DomainNode = memo(function DomainNode({
  data,
  selected,
}: NodeProps<Node<DomainData>>) {
  return (
    <Glass
      selected={selected}
      tone={data.verified ? undefined : 'warning'}
      className="h-14 w-[216px]"
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <Glyph kind="domain">
        <Globe />
      </Glyph>
      <div className="min-w-0">
        <Title>{data.domain}</Title>
        <Meta color={data.verified ? 'var(--status-good)' : 'var(--status-warning)'}>
          {data.verified ? 'Verified' : 'Pending DNS'}
        </Meta>
      </div>
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
    </Glass>
  );
});

type AppNodeData = AppData & { onConnect?: (s: ConnectSide) => void; onRetry?: () => void };

function appStatus(data: AppData) {
  const phase = PHASE[data.phase];
  if (data.phase === 'error' && data.errorRatePct !== undefined) {
    return { ...phase, label: `Error · ${data.errorRatePct.toFixed(1)}% errors` };
  }
  return phase;
}

function AppMetricsRow({ data }: { data: AppNodeData }) {
  if (data.connections === 'error') {
    return (
      <Metrics>
        <span className="text-status-warning">Connections unavailable</span>
        {data.onRetry && (
          <button
            type="button"
            className="nodrag underline underline-offset-2 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              data.onRetry?.();
            }}
          >
            Retry
          </button>
        )}
      </Metrics>
    );
  }
  if (data.requests24h !== undefined) {
    return (
      <Metrics>
        <span>
          <b className="font-medium text-foreground">{shortCount(data.requests24h)}</b> req
        </span>
        {data.p95Ms !== undefined && (
          <span>
            p95 <b className="font-medium text-foreground">{`${Math.round(data.p95Ms)}ms`}</b>
          </span>
        )}
      </Metrics>
    );
  }
  if (data.metricsWhy)
    return (
      <Metrics>{data.metricsWhy === 'plan' ? 'Metrics on Hobby' : 'Metrics unavailable'}</Metrics>
    );
  return null;
}

export const AppNode = memo(function AppNode({ data, selected }: NodeProps<Node<AppNodeData>>) {
  const status = appStatus(data);
  return (
    <div className="group relative">
      {data.phase === 'parked' && (
        <span
          data-breathing=""
          aria-hidden
          className="pointer-events-none absolute -inset-1.5 animate-breathe rounded-2xl border border-brand/50"
        />
      )}
      <Glass
        selected={selected}
        tone={data.phase === 'error' ? 'critical' : undefined}
        className="h-[76px] w-[248px] border-t-brand/50"
      >
        <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
        <Handle id="top" type="target" position={Position.Top} isConnectable={false} />
        <Glyph kind="app">
          <Cube />
        </Glyph>
        <div className="flex min-w-0 flex-col">
          <Title max="max-w-[160px]">{data.slug}</Title>
          <Meta color={status.color}>{status.label}</Meta>
          <AppMetricsRow data={data} />
        </div>
        <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
      </Glass>
      {data.onConnect && (
        <>
          <PlusButton
            label={`Add something that sends traffic into ${data.slug}`}
            onClick={() => data.onConnect?.('in')}
            className="-left-9"
            shown={selected}
          />
          <PlusButton
            label={`Connect ${data.slug} to a resource`}
            onClick={() => data.onConnect?.('out')}
            className="-right-9"
            shown={selected}
          />
        </>
      )}
    </div>
  );
});

export const CronNode = memo(function CronNode({ data, selected }: NodeProps<Node<CronData>>) {
  return (
    <Glass selected={selected} className={cn('h-14 w-[216px]', !data.enabled && 'opacity-60')}>
      <Glyph kind="cron">
        <Timer />
      </Glyph>
      <div className="min-w-0">
        <Title>{data.path || '/'}</Title>
        <Meta>{data.enabled ? describeCronSchedule(data.schedule) : 'Paused'}</Meta>
      </div>
      <Handle id="out" type="source" position={Position.Bottom} isConnectable={false} />
    </Glass>
  );
});

export const BucketNode = memo(function BucketNode({
  data,
  selected,
}: NodeProps<Node<BucketData>>) {
  return (
    <Glass selected={selected} className="h-14 w-[216px]">
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <Glyph kind="bucket">
        <HardDrive />
      </Glyph>
      <div className="min-w-0">
        <Title>{data.name}</Title>
        <Meta>{data.state === 'ready' ? 'Bucket' : `Bucket · ${data.state}`}</Meta>
      </div>
    </Glass>
  );
});

export const PostgresNode = memo(function PostgresNode({
  data,
  selected,
}: NodeProps<Node<PostgresData>>) {
  return (
    <Glass selected={selected} className="h-14 w-[216px]">
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <Glyph kind="postgres">
        <Database />
      </Glyph>
      <div className="min-w-0">
        <Title>{data.name}</Title>
        <Meta>{data.state === 'ready' ? 'Postgres' : `Postgres · ${data.state}`}</Meta>
      </div>
    </Glass>
  );
});

export const nodeTypes: NodeTypes = {
  internet: InternetNode,
  domain: DomainNode,
  app: AppNode,
  cron: CronNode,
  bucket: BucketNode,
  postgres: PostgresNode,
};
