import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Xmark } from 'iconoir-react';
import { useAppAnalyticsTimeseries, useAppMetrics } from '@/lib/api/queries';
import { useLogStream } from '@/lib/api/logs';
import type { LaunchState } from './launch';
import { ApiError } from '@/lib/api/errors';
import { describeCronSchedule } from '@/lib/cron-schedule';
import { DomainDoctor } from '@/components/dashboard/domain-doctor';
import { Sparkline } from '@/components/dither-kit';
import { useCopy } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';
import { nodeTitle, type AppData, type CanvasNode, type Topology } from './topology';

const TAB_LABEL = { overview: 'Overview', logs: 'Logs', connections: 'Connections' } as const;
export type InspectorTab = keyof typeof TAB_LABEL;
const needsPlan = (e: unknown) => e instanceof ApiError && e.status === 402;
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const short = (n: number) => compact.format(n).toLowerCase();
const label = 'font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground';

function Section({
  title,
  aside,
  children,
  last,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section className={cn('px-5 py-4', !last && 'border-b border-border')}>
      {title && (
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className={label}>{title}</h3>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

function Kpi({ k, v, unit }: { k: string; v?: string; unit?: string }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div className={label}>{k}</div>
      <div className="mt-0.5 text-[18px] font-semibold tracking-[-0.015em] tabular-nums">
        {v ?? '—'}
        {v && unit && (
          <small className="ml-0.5 text-[12px] font-medium text-muted-foreground">{unit}</small>
        )}
      </div>
    </div>
  );
}

function AppOverview({
  data,
  links,
  onFly,
}: {
  data: AppData;
  links: { id: string; title: string; kind: string }[];
  onFly: (id: string) => void;
}) {
  const metrics = useAppMetrics(data.slug, '24h', { retry: false });
  const series = useAppAnalyticsTimeseries(data.slug, '24h');
  const m = metrics.data;
  const why = needsPlan(metrics.error)
    ? 'Metrics need Hobby.'
    : metrics.error
      ? 'Metrics unavailable.'
      : undefined;
  const points = series.data?.points.map((p) => p.requests) ?? [];
  const peak = points.length ? Math.max(...points) : undefined;
  return (
    <>
      <Section title="Last 24 hours">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-border bg-border">
          <Kpi k="Requests" v={m ? short(m.request_count) : undefined} />
          <Kpi k="Error rate" v={m ? m.error_rate_pct.toFixed(2) : undefined} unit="%" />
          <Kpi k="p95" v={m ? String(Math.round(m.latency_p95_ms)) : undefined} unit="ms" />
          <Kpi k="Cold starts" v={m ? m.cold_start_pct.toFixed(1) : undefined} unit="%" />
        </div>
        {why && <p className="mt-2 text-[12px] text-muted-foreground">{why}</p>}
      </Section>
      <Section
        title="Requests per hour"
        aside={peak !== undefined && <span className={label}>{`peak ${short(peak)}`}</span>}
      >
        {series.data ? (
          <>
            <Sparkline data={points} color="green" className="h-14 w-full" />
            <div className={cn(label, 'mt-1 flex justify-between')}>
              <span>−24h</span>
              <span>−12h</span>
              <span>now</span>
            </div>
          </>
        ) : series.isPending ? (
          <div className="h-14" />
        ) : (
          <p className="text-[12px] text-muted-foreground">
            {needsPlan(series.error) ? 'Metrics need Hobby.' : 'Series unavailable for this app.'}
          </p>
        )}
      </Section>
      <Section title="Connected" last>
        <Connections links={links} onFly={onFly} />
      </Section>
    </>
  );
}

const DOT: Record<string, string> = {
  domain: 'var(--cat-network)',
  cron: 'var(--cat-compute)',
  app: 'var(--cat-compute)',
  bucket: 'var(--cat-storage)',
  postgres: 'var(--cat-storage)',
  internet: 'var(--muted-foreground)',
};
const KIND: Record<string, string> = {
  ingress: 'Ingress',
  schedule: 'Schedule',
  storage: 'Storage',
  database: 'Database',
};

function Connections({
  links,
  onFly,
}: {
  links: { id: string; title: string; kind: string; nodeKind?: string }[];
  onFly: (id: string) => void;
}) {
  if (!links.length)
    return <p className="text-[12.5px] text-muted-foreground">Nothing connected yet.</p>;
  return (
    <ul className="-mx-2 flex flex-col">
      {links.map((l) => (
        <li key={l.id}>
          <button
            type="button"
            onClick={() => onFly(l.id)}
            className="flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12.5px] hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-brand"
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: DOT[l.nodeKind ?? 'internet'] }}
            />
            <span className="truncate">{l.title}</span>
            <span className={cn(label, 'ml-auto')}>{KIND[l.kind] ?? l.kind}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Live request logs, or the build's output while a first deploy runs. */
function AppLogs({ slug, buildId }: { slug: string; buildId?: string }) {
  const logs = useLogStream(
    buildId ? { kind: 'build', deploymentId: buildId, limit: 200 } : { kind: 'live', slug }
  );
  return (
    <Section
      title={buildId ? 'Build' : 'Live'}
      aside={
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-brand">
          {logs.status === 'streaming' ? 'Streaming' : logs.status}
        </span>
      }
      last
    >
      <div
        role="log"
        aria-label={`${slug} logs`}
        className="max-h-[60vh] overflow-y-auto font-mono text-[11px] leading-5"
      >
        {logs.lines.slice(-200).map((line) => (
          <div key={line.id} className="truncate text-foreground" title={line.text}>
            {line.text}
          </div>
        ))}
        {!logs.lines.length && (
          <p className="text-muted-foreground">
            {buildId ? 'Waiting for build output…' : 'Waiting for the next request…'}
          </p>
        )}
      </div>
    </Section>
  );
}

export function Inspector({
  node,
  topology,
  onClose,
  onFly,
  launch,
  initialTab = 'overview',
}: {
  node: CanvasNode;
  topology: Topology;
  onClose: () => void;
  onFly: (id: string) => void;
  /** The app's first deploy, while the canvas watches it. */
  launch?: LaunchState;
  initialTab?: InspectorTab;
}) {
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  const buildId = launch && launch.stage !== 'live' ? launch.deploymentId : undefined;
  const { copied, copy } = useCopy();
  const d = node.data;
  if (d.kind === 'internet') return null;
  const title = nodeTitle(d);
  const links = topology.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const other = e.source === node.id ? e.target : e.source;
      const data = topology.nodes.find((n) => n.id === other)?.data;
      return {
        id: other,
        title: data ? nodeTitle(data) : other,
        kind: e.kind,
        nodeKind: data?.kind,
      };
    });
  const status =
    d.kind === 'app'
      ? `${({ running: 'Serving', parked: 'Parked', idle: 'Idle', deploying: 'Deploying', error: 'Error', undeployed: 'Undeployed' } as const)[d.phase]}${d.runtime ? ` · ${d.runtime}` : ''}`
      : d.kind;
  const host = d.kind === 'app' && d.url ? d.url.replace(/^https?:\/\//, '') : undefined;

  return (
    <aside
      aria-label={`${title} details`}
      className="flex w-[360px] shrink-0 animate-item-enter flex-col overflow-y-auto border-l border-border bg-card"
    >
      <header className="relative border-b border-border px-5 pt-4 pb-3">
        <span
          aria-hidden
          className="absolute inset-x-5 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--brand),transparent)]"
        />
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold" title={title}>
              {title}
            </p>
            <p className={label}>{status}</p>
          </div>
          {d.kind === 'app' && (
            <Link
              to="/dashboard/workflows/$workflowId"
              params={{ workflowId: d.slug }}
              className="pressable flex h-7 items-center rounded-lg border border-border-secondary px-2.5 text-[12px] font-semibold hover:bg-accent"
            >
              Open app
            </Link>
          )}
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className="pressable grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
          >
            <Xmark aria-hidden className="size-4" />
          </button>
        </div>
        {host && (
          <div className="mt-2.5 flex items-center gap-2 text-[12px]">
            <a
              href={d.kind === 'app' ? d.url : undefined}
              target="_blank"
              rel="noreferrer"
              className="truncate text-brand hover:underline"
            >
              {host}
            </a>
            <button
              type="button"
              onClick={() => void copy(d.kind === 'app' ? (d.url ?? '') : '')}
              className="text-muted-foreground hover:text-foreground"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
        {d.kind === 'app' && (
          <div role="tablist" className="mt-3 flex gap-1">
            {(['overview', 'logs', 'connections'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px]',
                  tab === t
                    ? 'bg-accent font-semibold text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {TAB_LABEL[t]}
                {t === 'connections' && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {links.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </header>

      {d.kind === 'app' && tab === 'overview' && (
        <AppOverview data={d} links={links} onFly={onFly} />
      )}
      {d.kind === 'app' && tab === 'logs' && <AppLogs slug={d.slug} buildId={buildId} />}
      {d.kind === 'app' && tab === 'connections' && (
        <Section last>
          <Connections links={links} onFly={onFly} />
        </Section>
      )}
      {d.kind === 'domain' && (
        <>
          {!d.verified && d.txtRecord && (
            <Section title="Add this record at your DNS provider">
              <code className="block break-all rounded-lg border border-border bg-background p-2.5 font-mono text-[11px]">
                {d.txtRecord}
              </code>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Gregale re-checks automatically.
              </p>
            </Section>
          )}
          <Section title="Doctor" last>
            <DomainDoctor domain={d.domain} />
          </Section>
        </>
      )}
      {d.kind === 'cron' && (
        <Section title="Schedule" last>
          <p className="text-[13px]">{describeCronSchedule(d.schedule)}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {d.schedule} · {d.timezone} · {d.path}
          </p>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {d.lastFiredAt
              ? `Last fired ${new Date(d.lastFiredAt).toLocaleString()}`
              : 'Has not fired yet'}
          </p>
        </Section>
      )}
      {(d.kind === 'bucket' || d.kind === 'postgres') && (
        <Section title={d.kind === 'bucket' ? 'Bucket' : 'Postgres'} last>
          <p className="text-[13px]">{d.state}</p>
          <Link
            to={d.kind === 'bucket' ? '/dashboard/storage' : '/dashboard/postgres'}
            className="mt-2 inline-block text-[12px] text-brand"
          >
            Manage on its page →
          </Link>
        </Section>
      )}
    </aside>
  );
}
