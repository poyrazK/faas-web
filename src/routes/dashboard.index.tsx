import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ClockRotateRight, RefreshDouble } from 'iconoir-react';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  RangeSelector,
  Stats,
  StatTile,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { FirstRun } from '@/components/dashboard/first-run';
import { LiveDot } from '@/components/ui/live-dot';
import { useData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';
import { PlanGate } from '@/components/dashboard/plan-gate';
import {
  useApps,
  useAppsMetrics,
  useDeployments,
  useInstances,
  type MetricsRange,
} from '@/lib/api/queries';
import { formatCompact, formatRelative, type Workflow } from '@/lib/mock-data';
import type { Deployment } from '@/lib/mock-data';
import { readRecents, recentLabel } from '@/lib/recents';
import { consoleHead } from '@/lib/seo';
import { cn } from '@/lib/utils';
import { useWorkspaceUsageSummary } from '@/lib/api/org-billing';
import { formatCents } from '@/lib/money';

export const Route = createFileRoute('/dashboard/')({
  component: OverviewPage,
  head: () => consoleHead('overview'),
  validateSearch: (search: Record<string, unknown>): { range?: MetricsRange } => ({
    ...(OVERVIEW_RANGES.some(({ key }) => key === search.range)
      ? { range: search.range as MetricsRange }
      : {}),
  }),
});

/**
 * The account at a glance: the system's verdict, one strip of figures, and
 * the apps, deployments and pages you are most likely to open next.
 *
 * Figures, not charts: `/v1/apps/metrics` returns scalars, and this console
 * does not draw series it does not have. A degraded Prometheus rollup reads
 * as unknown, never as zero.
 */

const formatGbHours = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

function formatMoney(cents: number | undefined): string {
  if (cents == null) return '—';
  return formatCents(cents);
}

const OVERVIEW_RANGES: { key: MetricsRange; label: string }[] = [
  { key: '5m', label: '5m' },
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '15d', label: '15d' },
];

const RANGE_DESCRIPTION: Record<MetricsRange, string> = {
  '5m': 'last 5 minutes',
  '15m': 'last 15 minutes',
  '1h': 'last hour',
  '6h': 'last 6 hours',
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '15d': 'last 15 days',
};

/* ------------------------------------------------------------------ *
 * Verdict pill
 * ------------------------------------------------------------------ */

type Verdict = { text: string; color: string; trouble: boolean };

function verdictOf(accountStatus: string | undefined, failing: number, degraded: boolean): Verdict {
  if (accountStatus && accountStatus !== 'active')
    return {
      text: `Account ${accountStatus.replace(/_/g, ' ')}`,
      color: 'var(--status-critical)',
      trouble: true,
    };
  if (failing > 0)
    return {
      text: `${failing} ${failing === 1 ? 'app' : 'apps'} failing`,
      color: 'var(--status-critical)',
      trouble: true,
    };
  if (degraded) return { text: 'Metrics degraded', color: 'var(--status-warning)', trouble: false };
  return { text: 'All systems normal', color: 'var(--status-good)', trouble: false };
}

/* ------------------------------------------------------------------ *
 * Lists
 * ------------------------------------------------------------------ */

const ROW =
  'pressable flex h-9 items-center gap-2.5 px-4 text-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand';

const APP_DOT: Record<string, string> = {
  running: 'var(--status-good)',
  idle: 'var(--chart-muted)',
  error: 'var(--status-critical)',
};

function ViewAll({ to }: { to: string }) {
  return (
    <Link to={to} className="text-xs text-muted-foreground hover:text-foreground">
      View all
    </Link>
  );
}

function AppsList({ workflows }: { workflows: Workflow[] }) {
  return (
    <Panel title="Apps" actions={<ViewAll to="/dashboard/apps" />} padded={false}>
      <ul className="divide-y divide-border">
        {workflows.slice(0, 6).map((w) => (
          <li key={w.id}>
            <Link to="/dashboard/apps/$appSlug" params={{ appSlug: w.id }} className={ROW}>
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: APP_DOT[w.state] ?? 'var(--chart-muted)' }}
              />
              <span className="truncate font-mono">{w.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground capitalize">
                {w.state}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const DEPLOY_STATE: Record<string, { label: string; color: string }> = {
  succeeded: { label: 'Live', color: 'var(--status-good)' },
  failed: { label: 'Failed', color: 'var(--status-critical)' },
};

function DeploymentsList({ recent }: { recent: Deployment[] }) {
  return (
    <Panel title="Deployments" actions={<ViewAll to="/dashboard/releases" />} padded={false}>
      {recent.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Nothing deployed yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {recent.map((d) => {
            const state = DEPLOY_STATE[d.state] ?? {
              label: 'Deploying',
              color: 'var(--status-warning)',
            };
            return (
              <li key={d.id}>
                <Link to="/dashboard/releases" search={{ deployment: d.id }} className={ROW}>
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: state.color }}
                  />
                  <span className="truncate font-mono">{d.workflowId}</span>
                  <span className="sr-only">{state.label}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatRelative(d.createdAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function RecentsList() {
  // Read once on mount: a snapshot of where you have been, and this very
  // visit is already being recorded for the next one.
  const [recents] = useState(() => readRecents().slice(0, 6));
  return (
    <Panel title="Recently visited" padded={false}>
      {recents.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {recents.map((r) => {
            const { section, detail } = recentLabel(r.path);
            return (
              <li key={r.path}>
                <Link to={r.path} className={ROW}>
                  <ClockRotateRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">
                    <span className="text-muted-foreground">{section}</span>
                    {detail && (
                      <>
                        <span className="text-muted-foreground/50"> / </span>
                        <span className="font-mono">{detail}</span>
                      </>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
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
  const { range = '24h' } = Route.useSearch();
  const navigate = Route.useNavigate();
  // The workspace's allowance: the company's in a company workspace.
  const usage = useWorkspaceUsageSummary();
  // The default remains a cache hit with the store. Other windows are queried
  // directly so the overview changes the underlying rollup, not just its label.
  const paidAccess = isPaidPlan(account?.plan);
  const metrics = useAppsMetrics(range, { enabled: paidAccess });
  // The overview breathes on a gentle poll while it is on screen: this
  // observer's interval joins the store's own (TanStack runs the smallest
  // among observers) and leaves with the page. Real reads on a cadence —
  // the spec has no general event stream to subscribe to instead.
  const instances = useInstances({ refetchInterval: 10_000 });
  useDeployments(50, { refetchInterval: 10_000 });
  useApps({ refetchInterval: 15_000 });

  const phase = queryPhase({ error, loading });
  const metricsDegraded = Boolean(
    paidAccess && metrics.data && metrics.data.source !== 'prometheus'
  );
  const metricsUnavailable = metrics.isPending || Boolean(metrics.error) || metricsDegraded;
  const failing = useMemo(() => workflows.filter((w) => w.state === 'error'), [workflows]);

  // Resident RAM right now: non-parked instances only — a parked instance's
  // cgroup is gone, so it holds nothing.
  // `/v1/instances` is cursor-paginated. Never present a partial page as an
  // exact fleet total; the Workers view can load the remaining pages.
  const residentKnown = !instances.isPending && !instances.error && !instances.data?.next_before;
  const { residentMb, residentCount } = useMemo(() => {
    const resident = (instances.data?.instances ?? []).filter(
      (row) => row.state.toLowerCase() !== 'parked'
    );
    return {
      residentMb: resident.reduce((sum, row) => sum + row.ram_mb, 0),
      residentCount: resident.length,
    };
  }, [instances.data]);

  const { requests, errorPct, wakeP95 } = useMemo(() => {
    const rows = Object.values(metrics.data?.apps ?? {});
    const total = rows.reduce((sum, row) => sum + row.request_count, 0);
    // Weighted by traffic, not a mean of percentages: one idle app at 100%
    // must not outweigh a busy one at 0.01%.
    const errored = rows.reduce(
      (sum, row) => sum + row.request_count * (row.error_rate_pct / 100),
      0
    );
    // The wake histogram is unlabelled upstream — every row carries the same
    // fleet figure, so the first non-zero one is the figure.
    const wake = rows.find((row) => row.wake_p95_ms > 0)?.wake_p95_ms ?? 0;
    return { requests: total, errorPct: total > 0 ? (errored / total) * 100 : 0, wakeP95: wake };
  }, [metrics.data]);

  const setRange = (next: MetricsRange) =>
    void navigate({
      search: next === '24h' ? {} : { range: next },
      replace: true,
      resetScroll: false,
    });
  const rangeDescription = RANGE_DESCRIPTION[range];

  const usageData = usage.data;
  // null: a company with no usage this month carries no allowance yet.
  const includedKnown = usageData?.included_gb_hours ?? null;
  const included = includedKnown ?? 0;
  const usedGbh = usageData?.used_gb_hours ?? 0;
  const remainingGbh = Math.max(0, included - usedGbh);
  const overGbh = usageData?.overage_gb_hours ?? 0;
  const usageFailed = Boolean(usage.error);

  const recent = useMemo(
    () => [...deployments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4),
    [deployments]
  );

  const refreshing = usage.isRefetching || metrics.isRefetching || instances.isRefetching;
  const refreshAll = () => {
    refresh();
    void usage.refetch();
    if (paidAccess) void metrics.refetch();
    void instances.refetch();
  };

  const verdict = verdictOf(account?.status, failing.length, metricsDegraded);
  const firstName = user?.name.split(' ')[0];
  // Nothing deployed and the read succeeded: a page of zeroes is accurate
  // and useless, so the page becomes instructions instead.
  const firstRun = phase === 'ready' && workflows.length === 0;

  if (firstRun) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={firstName ? `Welcome, ${firstName}` : 'Overview'}
          description="Your first app starts here. Choose a source and we’ll guide you through deployment."
        />
        <FirstRun />
      </div>
    );
  }

  if (phase !== 'ready') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Overview" description="Your account at a glance." />
        {phase === 'unreachable' ? (
          <UnreachableState onRetry={refresh} />
        ) : phase === 'error' ? (
          <ErrorState error={error} onRetry={refresh} />
        ) : (
          <LoadingState message="Reading your account…" />
        )}
      </div>
    );
  }

  const metricsState = metrics.isPending && !metricsDegraded ? 'loading' : 'unavailable';
  const usageState = usage.isPending ? 'loading' : usageFailed ? 'unavailable' : 'ready';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Overview"
        meta={
          <p role={verdict.trouble ? 'alert' : 'status'}>
            <Link
              to={verdict.trouble ? '/dashboard/apps' : '/dashboard/usage'}
              className="pressable inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <LiveDot color={verdict.color} />
              {verdict.text}
            </Link>
          </p>
        }
        actions={
          <>
            <RangeSelector
              value={range}
              options={OVERVIEW_RANGES}
              onChange={setRange}
              disabled={!paidAccess}
            />
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshing}
              aria-label="Refresh analytics"
              className="pressable inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-border-secondary hover:text-foreground disabled:opacity-50"
            >
              <RefreshDouble
                className={cn(
                  'h-3.5 w-3.5',
                  refreshing && 'animate-spin motion-reduce:animate-none'
                )}
              />
            </button>
          </>
        }
      />

      {account && !paidAccess && (
        <PlanGate
          feature="Metrics"
          description="Request counts, error rates, and wake metrics require a paid plan."
        />
      )}

      {metricsDegraded && (
        <p role="status" className="text-xs" style={{ color: 'var(--status-warning)' }}>
          Metrics degraded. Figures that could not be read show as —.
        </p>
      )}
      <Stats columns={paidAccess ? 6 : 3}>
        {paidAccess && (
          <>
            <StatTile
              label="Requests"
              value={formatCompact(requests)}
              state={metricsUnavailable ? metricsState : 'ready'}
              note={`${workflows.length} ${workflows.length === 1 ? 'app' : 'apps'}, ${rangeDescription}`}
            />
            <StatTile
              label="Error rate"
              value={errorPct.toFixed(2)}
              unit="%"
              state={metricsUnavailable ? metricsState : 'ready'}
              note={`${formatCompact(Math.round((requests * errorPct) / 100))} errored`}
            />
            <StatTile
              label="Wake p95"
              value={Math.round(wakeP95)}
              unit="ms"
              state={metricsUnavailable ? metricsState : wakeP95 ? 'ready' : 'unavailable'}
              note="Cold start, fleet-wide"
            />
          </>
        )}
        <StatTile
          label="Memory now"
          value={residentMb.toLocaleString()}
          unit="MB"
          state={residentKnown ? 'ready' : instances.isPending ? 'loading' : 'unavailable'}
          note={`${residentCount} resident ${residentCount === 1 ? 'instance' : 'instances'}`}
        />
        <StatTile
          label={
            overGbh > 0
              ? 'GB-hours over'
              : includedKnown === null && usageData
                ? 'GB-hours used'
                : 'GB-hours left'
          }
          value={formatGbHours(
            overGbh > 0 ? overGbh : includedKnown === null ? usedGbh : remainingGbh
          )}
          state={usageState}
          note={
            overGbh > 0
              ? usageData?.overage_cents === undefined
                ? 'Over the allowance'
                : `${formatMoney(usageData.overage_cents)} overage`
              : includedKnown === null
                ? 'This period'
                : `of ${formatGbHours(included)}`
          }
        />
        <StatTile
          label="CPU"
          value={(usageData?.used_cpu_hours ?? 0).toLocaleString(undefined, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}
          unit="h"
          state={
            usageData?.used_cpu_hours == null && usageState === 'ready' ? 'unavailable' : usageState
          }
          note="This period, not billed"
        />
      </Stats>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <AppsList workflows={workflows} />
        <DeploymentsList recent={recent} />
        <RecentsList />
      </div>
    </div>
  );
}
