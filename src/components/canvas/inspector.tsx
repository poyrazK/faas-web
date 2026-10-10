import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Xmark } from 'iconoir-react';
import { useAppAnalyticsTimeseries, useAppMetrics } from '@/lib/api/queries';
import { useLogStream } from '@/lib/api/logs';
import { ApiError } from '@/lib/api/errors';
import { describeCronSchedule } from '@/lib/cron-schedule';
import { StatTile } from '@/components/dashboard/primitives';
import { LogView } from '@/components/dashboard/log-view';
import { DomainDoctor } from '@/components/dashboard/domain-doctor';
import { Sparkline } from '@/components/dither-kit';
import type { AppData, CanvasNode, Topology } from './topology';

const needsPlan = (e: unknown) => e instanceof ApiError && e.status === 402;

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-3.5">
      <div className="flex items-center justify-between">
        <h3 className="label-mono text-[11px] text-muted-foreground">{title}</h3>
        {aside}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function AppDetail({ data, topology, id }: { data: AppData; topology: Topology; id: string }) {
  const metrics = useAppMetrics(data.slug, '24h', { retry: false });
  const series = useAppAnalyticsTimeseries(data.slug, '24h');
  const logs = useLogStream({ kind: 'live', slug: data.slug });
  const m = metrics.data;
  const tile = metrics.isPending ? 'loading' : m ? 'ready' : 'unavailable';
  const planNote = needsPlan(metrics.error) ? 'Metrics need Hobby' : undefined;
  const label = (nid: string) => {
    const n = topology.nodes.find((x) => x.id === nid)?.data;
    if (!n) return nid;
    return n.kind === 'domain'
      ? n.domain
      : n.kind === 'app'
        ? n.slug
        : n.kind === 'cron'
          ? `cron ${n.path}`
          : n.kind === 'internet'
            ? 'Internet'
            : n.name;
  };
  const links = topology.edges.filter((e) => e.source === id || e.target === id);

  return (
    <>
      <Section title="Last 24h">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Requests" value={m?.request_count} state={tile} note={planNote} />
          <StatTile
            label="Error rate"
            value={m ? `${m.error_rate_pct.toFixed(2)}%` : undefined}
            state={tile}
          />
          <StatTile
            label="p95"
            value={m ? Math.round(m.latency_p95_ms) : undefined}
            unit="ms"
            state={tile}
          />
          <StatTile
            label="Wakes · cold start"
            value={
              m
                ? // `wakes_24h` is optional upstream; never print a count we were not given.
                  m.wakes_24h === undefined
                  ? `${m.cold_start_pct.toFixed(1)}% cold`
                  : `${m.wakes_24h} · ${m.cold_start_pct.toFixed(1)}%`
                : undefined
            }
            state={tile}
          />
        </div>
      </Section>
      <Section
        title="Requests per hour"
        aside={<span className="label-mono text-[10px] text-muted-foreground">24 buckets</span>}
      >
        {series.data ? (
          <Sparkline
            data={series.data.points.map((p) => p.requests)}
            color="green"
            className="h-16 w-full"
          />
        ) : series.isPending ? (
          <div className="h-16" />
        ) : (
          <p className="text-xs text-muted-foreground">
            {needsPlan(series.error)
              ? 'Metrics need Hobby.'
              : 'Hourly series unavailable for this app.'}
          </p>
        )}
      </Section>
      <Section title="Connections">
        <ul className="flex flex-col gap-1 text-xs">
          {links.map((e) => (
            <li key={e.id} className="flex justify-between gap-3">
              <span className="flex min-w-0 gap-1">
                <span aria-hidden>{e.target === id ? '↙' : '↘'}</span>
                <span className="truncate">{label(e.target === id ? e.source : e.target)}</span>
              </span>
              <span className="label-mono text-[10px] text-muted-foreground">
                {e.pending ? 'pending' : e.kind}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section
        title="Logs"
        aside={
          <span className="label-mono text-[10px] text-brand">
            {logs.status === 'streaming' ? 'Live' : logs.status}
          </span>
        }
      >
        <LogView lines={logs.lines.slice(-200)} className="h-56" />
      </Section>
    </>
  );
}

export function Inspector({
  node,
  topology,
  onClose,
}: {
  node: CanvasNode;
  topology: Topology;
  onClose: () => void;
}) {
  const d = node.data;
  if (d.kind === 'internet') return null;
  const title =
    d.kind === 'domain'
      ? d.domain
      : d.kind === 'app'
        ? d.slug
        : d.kind === 'cron'
          ? d.path || '/'
          : d.name;

  return (
    <aside
      aria-label={`${title} details`}
      className="flex w-[380px] shrink-0 animate-item-enter flex-col overflow-y-auto border-l border-border bg-card"
    >
      <header className="relative flex items-center gap-2 border-b border-border px-4 py-3.5">
        <span
          aria-hidden
          className="absolute inset-x-4 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--brand),transparent)]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={title}>
            {title}
          </p>
          <p className="label-mono text-[10px] text-muted-foreground">{d.kind}</p>
        </div>
        {d.kind === 'app' && (
          <Link
            to="/dashboard/workflows/$workflowId"
            params={{ workflowId: d.slug }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Open app ↗
          </Link>
        )}
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="pressable rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <Xmark aria-hidden className="size-4" />
        </button>
      </header>

      {d.kind === 'app' && <AppDetail data={d} topology={topology} id={node.id} />}
      {d.kind === 'domain' && (
        <>
          {!d.verified && d.txtRecord && (
            <Section title="Add this record at your DNS provider">
              <code className="block break-all rounded-md border border-border bg-background p-2 font-mono text-[11px]">
                {d.txtRecord}
              </code>
              <p className="mt-2 text-xs text-muted-foreground">Gregale re-checks automatically.</p>
            </Section>
          )}
          <Section title="Doctor">
            <DomainDoctor domain={d.domain} />
          </Section>
        </>
      )}
      {d.kind === 'cron' && (
        <Section title="Schedule">
          <p className="text-sm">{describeCronSchedule(d.schedule)}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {d.schedule} · {d.timezone} · {d.path}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {d.lastFiredAt
              ? `Last fired ${new Date(d.lastFiredAt).toLocaleString()}`
              : 'Has not fired yet'}
          </p>
        </Section>
      )}
      {(d.kind === 'bucket' || d.kind === 'postgres') && (
        <Section title={d.kind === 'bucket' ? 'Bucket' : 'Postgres'}>
          <p className="text-sm">{d.state}</p>
          <Link
            to={d.kind === 'bucket' ? '/dashboard/storage' : '/dashboard/postgres'}
            className="mt-2 inline-block text-xs text-brand"
          >
            Manage on its page →
          </Link>
        </Section>
      )}
    </aside>
  );
}
