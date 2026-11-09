import { featureFlags } from '@/lib/feature-flags';
import { OnboardingChecklist } from '@/components/onboarding/onboarding-checklist';
import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Refresh } from 'iconoir-react';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { FirstRun } from '@/components/dashboard/first-run';
import { SegmentedControl } from '@/components/dashboard/tabs';
import {
  AllowanceTile,
  AppsTile,
  ColdBootsTile,
  DeploymentsTile,
  ErrorsTile,
  HourFieldTile,
  InstancesTile,
  RequestsTile,
  type AllowanceState,
  type SeriesState,
} from '@/components/dashboard/overview/bento-tiles';
import { useOverviewSeries } from '@/components/dashboard/overview/use-overview-series';
import { useData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';
import {
  useApps,
  useAppsMetrics,
  useDeployments,
  useInstances,
  usePerAppUsage,
} from '@/lib/api/queries';
import { slugIndex } from '@/lib/api/adapters';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { consoleHead } from '@/lib/seo';
import { cn } from '@/lib/utils';
import { useWorkspaceUsageSummary } from '@/lib/api/org-billing';
import { formatCents } from '@/lib/money';

/** The windows the Overview offers: whole hours, inside every paid plan's retention. */
const OVERVIEW_RANGES = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
] as const;
type OverviewRange = (typeof OVERVIEW_RANGES)[number]['key'];

export const Route = createFileRoute('/dashboard/')({
  component: OverviewPage,
  head: () => consoleHead('overview'),
  validateSearch: (search: Record<string, unknown>): { range?: OverviewRange } =>
    OVERVIEW_RANGES.some(({ key }) => key === search.range)
      ? { range: search.range as OverviewRange }
      : {},
});

/**
 * The overview as a bento: tiles of different sizes, each its own material
 * and figure, all governed by one time window.
 *
 * Request history is `/v1/apps/{slug}/analytics/timeseries` for each charted
 * app, summed hour by hour; counts add across apps, percentiles never do. The
 * allowance is the workspace's (the company's in a company workspace). Wake
 * p95 is the platform-wide figure `/v1/apps/metrics` reports, and is labelled
 * so. A degraded or missing read shows as unknown, never as a measured zero.
 */
function OverviewPage() {
  const { workflows, deployments, loading, error, refresh } = useData();
  const { account, user } = useAuth();
  const { range = '24h' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { org, ready: workspaceReady } = useWorkspaceTarget();
  const usage = useWorkspaceUsageSummary();
  const paid = isPaidPlan(account?.plan);
  const metrics = useAppsMetrics(range, { enabled: paid });
  // The overview breathes on a gentle poll while it is on screen; real reads
  // on a cadence — the spec has no general event stream to subscribe to.
  const instances = useInstances({ refetchInterval: 10_000 });
  useDeployments(50, { refetchInterval: 10_000 });
  const apps = useApps({ refetchInterval: 15_000 });
  const perApp = usePerAppUsage({ enabled: workspaceReady && !org });

  const chartable = useMemo(
    () =>
      workflows.map((w) => ({
        slug: w.id,
        name: w.name,
        weight: w.metricsUnavailable ? 0 : w.invocations24h,
      })),
    [workflows]
  );
  const seriesRead = useOverviewSeries(chartable, range, paid);
  const series: SeriesState = { paid, ...seriesRead };

  const phase = queryPhase({ error, loading });
  const metricsDegraded = Boolean(
    paid &&
    metrics.data &&
    (metrics.data.source !== 'prometheus' ||
      Object.values(metrics.data.apps ?? {}).some((row) => row.source !== 'prometheus'))
  );
  const wakeP95 = metricsDegraded
    ? null
    : (Object.values(metrics.data?.apps ?? {}).find(
        (row) => row.wake_p95_ms > 0 && (row.wake_samples === undefined || row.wake_samples >= 20)
      )?.wake_p95_ms ?? null);

  // Resident RAM right now: non-parked instances only. `/v1/instances` is
  // cursor-paginated; a partial page is never presented as the fleet total.
  const instanceRows = instances.data?.instances ?? [];
  const parkedCount = instanceRows.filter((r) => r.state.toLowerCase() === 'parked').length;
  const resident = instanceRows.filter((r) => r.state.toLowerCase() !== 'parked');
  const instancesState = {
    known: !instances.isPending && !instances.error && !instances.data?.next_before,
    partial: Boolean(instances.data?.next_before),
    failed: Boolean(instances.error),
    residentCount: resident.length,
    residentMb: resident.reduce((sum, r) => sum + r.ram_mb, 0),
    parkedCount,
  };

  const usageData = usage.data;
  const includedGbHours = usageData?.included_gb_hours ?? null;
  const byApp = useMemo(() => {
    if (org || !perApp.data) return null;
    const slugs = slugIndex(apps.data ?? []);
    return perApp.data
      .map((row) => ({
        slug: slugs.get(row.app_id) ?? row.app_id.slice(0, 8),
        gbHours: (row.mb_seconds ?? 0) / 1024 / 3600,
      }))
      .filter((row) => row.gbHours > 0)
      .sort((a, b) => b.gbHours - a.gbHours);
  }, [org, perApp.data, apps.data]);
  const allowance: AllowanceState = {
    phase: queryPhase({ error: usage.error, loading: usage.isPending }),
    error: usage.error,
    usedGbHours: usageData?.used_gb_hours ?? 0,
    includedGbHours,
    overGbHours: usageData?.overage_gb_hours ?? 0,
    overageLabel:
      usageData?.overage_cents !== undefined && (usageData?.overage_gb_hours ?? 0) > 0
        ? `${formatCents(usageData.overage_cents)} overage`
        : undefined,
    byApp,
  };

  const recent = useMemo(
    () => [...deployments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4),
    [deployments]
  );

  const setRange = (next: OverviewRange) =>
    void navigate({
      search: next === '24h' ? {} : { range: next },
      replace: true,
      resetScroll: false,
    });

  // A manual refresh shows it is working for at least 400ms, so a fast read
  // still reads as "done" rather than as a click that did nothing.
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    refresh();
    await Promise.allSettled([
      usage.refetch(),
      instances.refetch(),
      ...(paid ? [metrics.refetch(), series.refetch()] : []),
      new Promise((done) => setTimeout(done, 400)),
    ]);
    setRefreshing(false);
  };

  const windowLabel = range === '7d' ? 'last 7 days · UTC' : 'last 24 hours · UTC';
  const firstName = user?.name.split(' ')[0];
  // Nothing deployed and the read succeeded: a page of zeroes is accurate
  // and useless, so the page becomes instructions instead.
  const firstRun = phase === 'ready' && workflows.length === 0;

  if (firstRun) {
    return (
      <div className="flex flex-col gap-6">
        {featureFlags.onboardingV2 && <OnboardingChecklist />}
        <PageHeader
          title={firstName ? `Welcome, ${firstName}` : 'Overview'}
          help="Choose a source and we’ll guide you through your first deployment."
        />
        <FirstRun />
      </div>
    );
  }

  if (phase !== 'ready') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Overview" />
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

  // Attention checks live in the top bar's Needs attention modal; the page
  // only says whether its own figures are live.
  const status = metricsDegraded
    ? { tone: 'warning', text: 'Metrics degraded. Figures may be incomplete.' }
    : { tone: 'live', text: 'Live' };

  return (
    <div className="flex flex-col gap-5">
      {featureFlags.onboardingV2 && <OnboardingChecklist />}

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.02em]">Overview</h1>
          <p
            role={status.tone === 'live' ? 'status' : 'alert'}
            className="bento-live inline-flex h-[26px] items-center gap-[7px] rounded-full px-[11px] text-[13px] font-medium"
            data-tone={status.tone === 'live' ? undefined : status.tone}
          >
            {status.text}
          </p>
          {metrics.data?.as_of && !metricsDegraded && (
            <span className="font-mono text-[13px] text-muted-foreground">
              as of {formatAsOf(metrics.data.as_of)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {paid && (
            <SegmentedControl
              label="Time window"
              value={range}
              options={OVERVIEW_RANGES}
              onChange={setRange}
            />
          )}
          <button
            type="button"
            onClick={() => void refreshAll()}
            aria-label="Refresh"
            aria-busy={refreshing}
            className="pressable inline-grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
          >
            <Refresh
              className={cn(
                'h-4 w-4',
                refreshing && 'animate-spin motion-reduce:animate-none motion-reduce:opacity-50'
              )}
            />
          </button>
        </div>
      </header>

      <div className="bento">
        <RequestsTile state={series} windowLabel={windowLabel} />
        <AllowanceTile state={allowance} />
        <ErrorsTile state={series} />
        <ColdBootsTile state={series} wakeP95Ms={wakeP95} />
        <InstancesTile state={instancesState} />
        <AppsTile state={series} appCount={workflows.length} />
        <HourFieldTile state={series} windowLabel={windowLabel} />
        <DeploymentsTile recent={recent} />
      </div>
    </div>
  );
}

function formatAsOf(iso: string) {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return iso;
  const day = at.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = at.toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${day} · ${time} UTC`;
}
