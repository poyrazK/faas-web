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
  CanvasNodeData & { onConnect?: (side: ConnectSide) => void },
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

function Glyph({ kind, children }: { kind: keyof typeof CATEGORY; children: ReactNode }) {
  const color = CATEGORY[kind];
  return (
    <span
      aria-hidden
      className="grid size-[26px] shrink-0 place-items-center rounded-md [&>svg]:size-3.5"
      style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      {children}
    </span>
  );
}

function Glass({
  selected,
  className,
  children,
  ...rest
}: {
  selected: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        'relative flex items-center gap-2.5 rounded-[var(--console-surface-radius)] border border-canvas-glass-border bg-canvas-glass px-3 shadow-elevation-2 backdrop-blur-md',
        'transition-shadow duration-[var(--motion-fast)] ease-console',
        selected && 'ring-[1.5px] ring-brand',
        className
      )}
    >
      {children}
    </div>
  );
}

function Title({ children }: { children: string }) {
  return (
    <span
      title={children}
      className="block max-w-[150px] truncate text-[13px] font-semibold text-foreground"
    >
      {children}
    </span>
  );
}

function Meta({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="label-mono flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
      {color && (
        <span aria-hidden className="size-1.5 rounded-full" style={{ background: color }} />
      )}
      {children}
    </span>
  );
}

function PlusButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'nodrag pressable absolute top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-[7px] border border-brand/40 bg-brand-muted text-brand',
        'opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 focus-visible:opacity-100',
        className
      )}
    >
      <Plus aria-hidden className="size-3.5" strokeWidth={2.2} />
    </button>
  );
}

export const InternetNode = memo(function InternetNode() {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="grid size-10 place-items-center rounded-full border border-canvas-glass-border bg-canvas-glass shadow-elevation-2">
        <Internet aria-hidden className="size-[18px] text-foreground" />
      </span>
      <span className="label-mono text-[9.5px] text-muted-foreground">Internet</span>
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
      className={cn('h-12 w-[210px]', !data.verified && 'border-status-warning/40')}
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

export const AppNode = memo(function AppNode({
  data,
  selected,
}: NodeProps<Node<AppData & { onConnect?: (s: ConnectSide) => void }>>) {
  const phase = PHASE[data.phase];
  return (
    <div className="group relative">
      {data.phase === 'parked' && (
        <span
          data-breathing=""
          aria-hidden
          className="pointer-events-none absolute -inset-[5px] animate-breathe rounded-[14px] border border-brand/50"
        />
      )}
      <Glass selected={selected} className="h-[68px] w-[230px] border-t-brand/55">
        <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
        <Handle id="top" type="target" position={Position.Top} isConnectable={false} />
        <Glyph kind="app">
          <Cube />
        </Glyph>
        <div className="flex min-w-0 flex-col gap-0.5">
          <Title>{data.slug}</Title>
          <Meta color={phase.color}>{phase.label}</Meta>
          {data.connections === 'error' ? (
            <span className="text-[11px] text-status-critical">Couldn’t load connections</span>
          ) : (
            data.requests24h !== undefined && (
              <span className="font-mono text-[10.5px] text-muted-foreground">
                <b className="font-medium text-foreground">
                  {compact.format(data.requests24h).toLowerCase()}
                </b>{' '}
                req/24h
                {data.p95Ms !== undefined && (
                  <>
                    {' · p95 '}
                    <b className="font-medium text-foreground">{`${Math.round(data.p95Ms)}ms`}</b>
                  </>
                )}
              </span>
            )
          )}
        </div>
        <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
      </Glass>
      {data.onConnect && (
        <>
          <PlusButton
            label={`Add something that sends traffic into ${data.slug}`}
            onClick={() => data.onConnect?.('in')}
            className="-left-9"
          />
          <PlusButton
            label={`Connect ${data.slug} to a resource`}
            onClick={() => data.onConnect?.('out')}
            className="-right-9"
          />
        </>
      )}
    </div>
  );
});

export const CronNode = memo(function CronNode({ data, selected }: NodeProps<Node<CronData>>) {
  return (
    <Glass selected={selected} className={cn('h-12 w-[210px]', !data.enabled && 'opacity-60')}>
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
    <Glass selected={selected} className="h-12 w-[190px]">
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
    <Glass selected={selected} className="h-12 w-[190px]">
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
