import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, CheckCircle, Plus, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  PageHeader,
  Panel,
  StateBadge,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { CountUp } from '@/components/dashboard/motion';
import { FirstRun } from '@/components/dashboard/first-run';
import { useData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { useAppsMetrics, useInstances, useUsageSummary } from '@/lib/api/queries';
import { formatCompact, formatRelative, type Workflow } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/dashboard/')({
  component: OverviewPage,
  head: () => consoleHead('overview'),
});

/**
 * The console landing page.
 *
 * Laid out by importance rather than symmetry: the fleet's parked/running
 * split leads, because scale-to-zero is the thing this platform does that
 * others do not and the one figure an operator cannot get anywhere else.
 * Anything wrong sits beside it; cost and recent activity sit below.
 *
 * Every figure here comes from a read the store already makes — the app list,
 * the deployment list, and the 24h Prometheus rollup — plus the instance list
 * for resident memory. A degraded rollup zeroes its response, so the tiles
 * that depend on it say so rather than reporting a confident zero.
 */

const formatGbHours = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

function formatMoney(cents: number | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(
    cents / 100
  );
}

/** The mono eyebrow every tile leads with. */
function TileLabel({ children }: { children: React.ReactNode }) {
  return <p className="label-mono text-muted-foreground">{children}</p>;
}

/* ------------------------------------------------------------------ *
 * Fleet — the signature tile
 * ------------------------------------------------------------------ */

function FleetTile({
  workflows,
  residentMb,
  instanceCount,
  residentKnown,
}: {
  workflows: Workflow[];
  residentMb: number;
  instanceCount: number;
  residentKnown: boolean;
}) {
  const running = workflows.filter((w) => w.state === 'running').length;
  // Parked is the whole point: an app that exists, costs nothing, and wakes on
  // the next request. Undeployed apps are neither — they are excluded.
  const parked = workflows.filter((w) => w.state === 'idle').length;

  // Busiest first: on a page with one screen of room, traffic is the most
  // useful ordering, and the full list is one click away.
  const roster = useMemo(
    () => [...workflows].sort((a, b) => b.invocations24h - a.invocations24h).slice(0, 6),
    [workflows]
  );

  return (
    <Panel lit elevation="raised" padded={false} className="brand-wash lg:col-span-7 lg:row-span-2">
      <div className="relative p-5">
        <div className="flex items-start justify-between gap-4">
          <TileLabel>Fleet</TileLabel>
          <Link
            to="/dashboard/workflows"
            className="pressable inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
          >
            All apps
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <p className="text-5xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
            <CountUp value={running} />
            <span className="ml-2 text-sm font-normal text-muted-foreground">running</span>
          </p>
          <p className="text-3xl leading-none font-semibold tracking-tight text-muted-foreground [font-variant-numeric:tabular-nums]">
            <CountUp value={parked} />
            <span className="ml-2 text-sm font-normal">parked</span>
          </p>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {residentKnown ? (
            <>
              <span className="text-foreground [font-variant-numeric:tabular-nums]">
                {residentMb.toLocaleString()} MB
              </span>{' '}
              resident across {instanceCount} {instanceCount === 1 ? 'instance' : 'instances'}.
              Parked apps hold no memory and bill nothing until the next request.
            </>
          ) : (
            <>Parked apps hold no memory and bill nothing until the next request.</>
          )}
        </p>
      </div>

      {roster.length > 0 && (
        <ul className="flex flex-col border-t border-border">
          {roster.map((app) => (
            <li key={app.id} className="border-b border-border last:border-0">
              <Link
                to="/dashboard/workflows/$workflowId"
                params={{ workflowId: app.id }}
                className="flex items-center justify-between gap-3 bg-background/40 px-5 py-2.5 transition-colors hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="truncate font-mono text-xs">{app.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{app.runtime}</span>
                </span>
                <span className="flex shrink-0 items-center gap-4">
                  <span className="text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
                    {app.invocations24h ? formatCompact(app.invocations24h) : '—'}
                  </span>
                  <StateBadge state={app.state} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Attention — adaptive, and quiet when there is nothing to say
 * ------------------------------------------------------------------ */

function AttentionTile({
  status,
  failing,
  metricsDegraded,
}: {
  status: string | undefined;
  failing: Workflow[];
  metricsDegraded: boolean;
}) {
  // Billing state outranks everything: a suspended account is why the apps
  // stopped, and the overview never used to mention it at all.
  const billingProblem = status && status !== 'active' ? status : null;

  return (
    <Panel elevation="resting" className="lg:col-span-5 [animation-delay:60ms]">
      <TileLabel>Needs attention</TileLabel>

      {billingProblem ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="flex items-start gap-2 text-sm">
            <WarningTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ color: 'var(--status-critical)' }}
            />
            <span>
              This account is{' '}
              <span className="font-medium">{billingProblem.replace(/_/g, ' ')}</span>.
              {billingProblem === 'past_due'
                ? ' Settle the outstanding invoice to avoid suspension.'
                : ' Apps may not serve traffic until it is resolved.'}
            </span>
          </p>
          <Link
            to="/dashboard/invoices"
            className="pressable inline-flex w-fit items-center gap-1 rounded text-xs text-brand hover:text-brand-hover"
          >
            View invoices
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : failing.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm">
            <span className="[font-variant-numeric:tabular-nums]">{failing.length}</span>{' '}
            {failing.length === 1 ? 'app is' : 'apps are'} failing.
          </p>
          <ul className="flex flex-col gap-1">
            {failing.slice(0, 4).map((app) => (
              <li key={app.id}>
                <Link
                  to="/dashboard/workflows/$workflowId"
                  params={{ workflowId: app.id }}
                  search={{ tab: 'Logs' }}
                  className="pressable inline-flex items-center gap-2 rounded font-mono text-xs text-muted-foreground hover:text-foreground"
                >
                  {app.name}
                  <span style={{ color: 'var(--status-critical)' }}>
                    {app.errorRatePct.toFixed(2)}% errors
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : metricsDegraded ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <WarningTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: 'var(--status-warning)' }}
          />
          Metrics are degraded, so app health cannot be read for this window.
        </p>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle className="h-4 w-4 shrink-0" style={{ color: 'var(--status-good)' }} />
          Nothing needs attention.
        </p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Traffic
 * ------------------------------------------------------------------ */

function TrafficTile({ workflows, degraded }: { workflows: Workflow[]; degraded: boolean }) {
  const { requests, errorPct, wakeP95 } = useMemo(() => {
    const total = workflows.reduce((sum, w) => sum + w.invocations24h, 0);
    // Weighted by traffic, not a mean of percentages: one idle app at 100%
    // must not outweigh a busy one at 0.01%.
    const errored = workflows.reduce(
      (sum, w) => sum + w.invocations24h * (w.errorRatePct / 100),
      0
    );
    // The wake histogram is unlabelled upstream, so every row carries the same
    // fleet figure — take the first that has one.
    const wake = workflows.find((w) => w.coldStartP50Ms > 0)?.coldStartP50Ms ?? 0;
    return {
      requests: total,
      errorPct: total > 0 ? (errored / total) * 100 : 0,
      wakeP95: wake,
    };
  }, [workflows]);

  const unknown = <span className="text-muted-foreground">—</span>;

  return (
    <Panel elevation="resting" className="lg:col-span-5 [animation-delay:120ms]">
      <TileLabel>Traffic · last 24h</TileLabel>

      <p className="mt-4 text-4xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
        {degraded ? unknown : <CountUp value={requests} format={formatCompact} />}
        <span className="ml-2 text-sm font-normal text-muted-foreground">requests</span>
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-background px-3 py-2.5">
          <dt className="label-mono text-muted-foreground">Error rate</dt>
          <dd
            className="mt-1 text-sm [font-variant-numeric:tabular-nums]"
            style={!degraded && errorPct > 1 ? { color: 'var(--status-critical)' } : undefined}
          >
            {degraded ? unknown : `${errorPct.toFixed(2)}%`}
          </dd>
        </div>
        <div className="rounded-lg bg-background px-3 py-2.5">
          <dt className="label-mono text-muted-foreground">Wake p95</dt>
          <dd className="mt-1 text-sm [font-variant-numeric:tabular-nums]">
            {degraded || !wakeP95 ? unknown : `${Math.round(wakeP95)} ms`}
            <span className="ml-1 text-xs text-muted-foreground">fleet</span>
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Allowance
 * ------------------------------------------------------------------ */

function AllowanceTile({ usage }: { usage: ReturnType<typeof useUsageSummary> }) {
  const phase = queryPhase({ error: usage.error, loading: usage.isPending });
  const data = usage.data;
  const used = data?.used_gb_hours ?? 0;
  const included = data?.included_gb_hours ?? 0;
  // Guard the divide: a plan with no included allowance would render NaN%.
  const pct = included > 0 ? Math.min(100, (used / included) * 100) : 0;
  const over = (data?.overage_gb_hours ?? 0) > 0;

  return (
    <Panel elevation="resting" className="lg:col-span-5 [animation-delay:180ms]">
      <div className="flex items-start justify-between gap-4">
        <TileLabel>Allowance · {data?.month ?? 'this month'}</TileLabel>
        <Link
          to="/dashboard/usage"
          className="pressable inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
        >
          Usage
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {phase !== 'ready' ? (
        <div className="mt-4">
          <InlinePhase phase={phase} error={usage.error} loadingMessage="Reading usage…" />
        </div>
      ) : (
        <>
          <p className="mt-4 text-4xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
            <CountUp value={used} format={formatGbHours} />
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              of {formatGbHours(included)} GB-hours
            </span>
          </p>

          <div
            className="mt-4 h-2 w-full overflow-hidden rounded-full bg-background"
            role="meter"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Included allowance used"
          >
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-console"
              style={{
                width: `${pct}%`,
                background: over ? 'var(--status-warning)' : 'var(--brand)',
              }}
            />
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            {over ? (
              <>
                Into overage:{' '}
                <span style={{ color: 'var(--status-warning)' }}>
                  {formatGbHours(data?.overage_gb_hours ?? 0)} GB-hours
                </span>{' '}
                · {formatMoney(data?.overage_cents)} this period.
              </>
            ) : (
              <>An idle app accrues none — GB-hours are memory × time.</>
            )}
          </p>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

function OverviewPage() {
  const { workflows, deployments, loading, error, refresh } = useData();
  const { account, user } = useAuth();
  const usage = useUsageSummary();
  // Same key the store already reads, so this is a cache hit — it is here for
  // `source`, which says whether the figures can be trusted.
  const metrics = useAppsMetrics('24h');
  const instances = useInstances();

  const phase = queryPhase({ error, loading });
  const metricsDegraded = Boolean(metrics.data && metrics.data.source !== 'prometheus');

  const failing = useMemo(() => workflows.filter((w) => w.state === 'error'), [workflows]);

  // Resident memory is the sum over instances that actually hold memory — a
  // parked instance row still exists but its cgroup is gone, which is the
  // claim the tile makes in words and so must not contradict in arithmetic.
  // Unreadable is not zero, so the tile drops the line rather than reporting
  // an empty fleet.
  const { residentMb, instanceCount, residentKnown } = useMemo(() => {
    const resident = (instances.data?.instances ?? []).filter(
      (i) => i.state.toLowerCase() !== 'parked'
    );
    return {
      residentMb: resident.reduce((sum, i) => sum + (i.ram_mb ?? 0), 0),
      instanceCount: resident.length,
      residentKnown: !instances.isPending && !instances.error,
    };
  }, [instances.data, instances.isPending, instances.error]);

  const recent = useMemo(
    () => [...deployments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [deployments]
  );

  const firstName = user?.name.split(' ')[0];
  // Nothing deployed and the read succeeded: a page of zeroes is accurate and
  // useless, so the page becomes instructions instead.
  const firstRun = phase === 'ready' && workflows.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          // "Welcome back" to someone who has never deployed anything is the
          // wrong greeting; a first run is a welcome, not a return.
          firstName ? `Welcome${firstRun ? '' : ' back'}, ${firstName}` : 'Overview'
        }
        description={
          firstRun
            ? 'Nothing deployed yet. Three commands and you are live.'
            : account
              ? `${account.app_count} app${account.app_count === 1 ? '' : 's'} on the ${account.plan} plan.`
              : 'Your account at a glance.'
        }
        actions={
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/dashboard/workflows/new">
              <Plus className="h-3.5 w-3.5" />
              New app
            </Link>
          </Button>
        }
      />

      {firstRun && <FirstRun />}

      {!firstRun &&
        (phase === 'unreachable' ? (
          <UnreachableState onRetry={refresh} />
        ) : phase === 'error' ? (
          <ErrorState error={error} onRetry={refresh} />
        ) : phase === 'loading' ? (
          <LoadingState message="Reading your account…" />
        ) : (
          /* Two bands, mirrored: 7/5 then 5/7. The asymmetry is the hierarchy —
             the fleet leads, cost and history sit under it — and the reversal
             keeps the page from reading as two identical rows. */
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <FleetTile
              workflows={workflows}
              residentMb={residentMb}
              instanceCount={instanceCount}
              residentKnown={residentKnown}
            />
            <AttentionTile
              status={account?.status}
              failing={failing}
              metricsDegraded={metricsDegraded}
            />
            <TrafficTile workflows={workflows} degraded={metricsDegraded} />

            <AllowanceTile usage={usage} />

            <Panel
              elevation="resting"
              padded={false}
              className="lg:col-span-7 [animation-delay:240ms]"
              title="Recent deployments"
              actions={
                <Link
                  to="/dashboard/deployments"
                  className="pressable inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
                >
                  All deployments
                  <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              {recent.length === 0 ? (
                <div className="p-5">
                  <EmptyState message="Nothing deployed yet." />
                </div>
              ) : (
                <ul className="flex flex-col">
                  {recent.map((d) => (
                    <li
                      key={d.id}
                      className={cn(
                        'flex items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-0'
                      )}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-mono text-xs">{d.workflowId}</span>
                        <span className="text-xs text-muted-foreground">
                          {d.version || 'no image'} · {formatRelative(d.createdAt)}
                        </span>
                      </span>
                      <StateBadge
                        state={
                          d.state === 'succeeded'
                            ? 'running'
                            : d.state === 'failed'
                              ? 'error'
                              : 'deploying'
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        ))}
    </div>
  );
}
