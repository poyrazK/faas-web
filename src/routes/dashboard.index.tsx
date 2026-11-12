import { featureFlags } from '@/lib/feature-flags';
import { OnboardingChecklist } from '@/components/onboarding/onboarding-checklist';
import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ClockRotateRight, NavArrowRight, Plus, Refresh } from 'iconoir-react';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { FirstRun } from '@/components/dashboard/first-run';
import { OverviewSearch } from '@/components/dashboard/overview-search';
import { Magnetic } from '@/components/amicro/magnetic';
import { PointerGlow } from '@/components/amicro/pointer-glow';
import { WordReveal } from '@/components/amicro/word-reveal';
import { LiveDot } from '@/components/ui/live-dot';
import { SegmentedControl } from '@/components/dashboard/tabs';
import { OverviewStats } from '@/components/dashboard/overview-analytics/overview-stats';
import { fleetMetrics } from '@/components/dashboard/overview-analytics/overview-stats-data';
import { WindFlow } from '@/components/dashboard/wind-flow';
import { useData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';
import { useAppsMetrics, useDeployments, useInstances, type MetricsRange } from '@/lib/api/queries';
import { formatRelative, type Workflow } from '@/lib/mock-data';
import type { Deployment } from '@/lib/mock-data';
import { FlowDotsField } from '@/components/dashboard/shapes';
import { readRecents, recentLabel } from '@/lib/recents';
import { consoleHead } from '@/lib/seo';
import { cn } from '@/lib/utils';
import { useWorkspaceUsageSummary } from '@/lib/api/org-billing';

export const Route = createFileRoute('/dashboard/')({
  component: OverviewPage,
  head: () => consoleHead('overview'),
  validateSearch: (search: Record<string, unknown>): { range?: OverviewRange } =>
    OVERVIEW_RANGES.some(({ key }) => key === search.range)
      ? { range: search.range as OverviewRange }
      : {},
});

/**
 * The overview as a launchpad.
 *
 * Wireframe borrowed deliberately from the best-tested console layout in
 * the business: a centred greeting with the system's verdict as a pill
 * above it, one big search field (the command palette's front door — the
 * top bar no longer carries one), three resource columns (Apps,
 * Deployments, Recents), and an analytics grid below.
 *
 * The analytics cards carry numbers, not charts: `/v1/apps/metrics`,
 * `/v1/instances` and the usage summary return scalars, and this console
 * does not draw series it does not have. One range governs every metrics
 * figure. A degraded rollup reads as unknown, never as zero.
 */

const OVERVIEW_RANGES = [
  { key: '5m', label: '5m' },
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '15d', label: '15d' },
] as const satisfies readonly { key: MetricsRange; label: string }[];
type OverviewRange = (typeof OVERVIEW_RANGES)[number]['key'];

const RANGE_DESCRIPTION: Record<OverviewRange, string> = {
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

function verdictOf(
  accountStatus: string | undefined,
  failing: number,
  degraded: boolean
): Verdict | null {
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
  return null;
}

/* ------------------------------------------------------------------ *
 * Columns
 * ------------------------------------------------------------------ */

function ColumnHeader({ label, to }: { label: string; to?: string }) {
  if (!to) return <h2 className="label-mono text-muted-foreground">{label}</h2>;
  return (
    <h2>
      <Link
        to={to}
        className="pressable label-mono inline-flex items-center gap-1 rounded text-muted-foreground hover:text-foreground"
      >
        {label}
        <NavArrowRight className="h-3 w-3" />
      </Link>
    </h2>
  );
}

const APP_DOT: Record<string, string> = {
  running: 'var(--status-good)',
  idle: 'var(--chart-muted)',
  error: 'var(--status-critical)',
};

function AppsColumn({ workflows }: { workflows: Workflow[] }) {
  const shown = workflows.slice(0, 4);
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <ColumnHeader label="Apps" to="/dashboard/apps" />
      <Link
        to="/dashboard/apps/new"
        className="pressable relative mt-2 flex items-center justify-center gap-1.5 overflow-hidden surface rounded-[1.25rem] bg-card py-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <PointerGlow />
        <Plus className="h-3.5 w-3.5" />
        New app
      </Link>
      <ul className="flex list-none flex-col divide-y divide-border">
        {shown.map((w) => (
          <li key={w.id}>
            <Link
              to="/dashboard/apps/$appSlug"
              params={{ appSlug: w.id }}
              className="pressable group flex items-center gap-2.5 rounded py-2.5"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  w.state === 'running' && 'animate-breathe'
                )}
                style={{ background: APP_DOT[w.state] ?? 'var(--chart-muted)' }}
              />
              <span className="truncate font-mono text-xs">{w.name}</span>
              <NavArrowRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          </li>
        ))}
      </ul>
      {workflows.length > 4 && (
        <p className="text-xs text-muted-foreground">+{workflows.length - 4} more</p>
      )}
    </section>
  );
}

const DEPLOY_STATE: Record<string, { label: string; color: string; live?: boolean }> = {
  succeeded: { label: 'Live', color: 'var(--status-good)' },
  failed: { label: 'Failed', color: 'var(--status-critical)' },
};

function DeploymentsColumn({ recent }: { recent: Deployment[] }) {
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <ColumnHeader label="Deployments" to="/dashboard/releases" />
      {recent.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nothing deployed yet.</p>
      ) : (
        <ul className="mt-2 flex list-none flex-col divide-y divide-border">
          {recent.map((d) => {
            const state = DEPLOY_STATE[d.state] ?? {
              label: 'Deploying',
              color: 'var(--status-warning)',
              live: true,
            };
            return (
              <li key={d.id}>
                <Link
                  to="/dashboard/releases"
                  search={{ deployment: d.id }}
                  className="pressable group flex items-center gap-2.5 rounded py-2.5"
                >
                  {/* Colour plus text, never hue alone; in-flight breathes. */}
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      state.live && 'animate-breathe'
                    )}
                    style={{ background: state.color }}
                  />
                  <span className="truncate font-mono text-xs">{d.workflowId}</span>
                  <span className="sr-only">{state.label}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatRelative(d.createdAt)}
                  </span>
                  <NavArrowRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RecentsColumn() {
  // Read once on mount: the column is a snapshot of where you have been,
  // and this very visit is already being recorded for the next one.
  const [recents] = useState(() => readRecents().slice(0, 4));
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <ColumnHeader label="Recents" />
      {recents.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Pages you visit will appear here.</p>
      ) : (
        <ul className="mt-2 flex list-none flex-col divide-y divide-border">
          {recents.map((r) => {
            const { section, detail } = recentLabel(r.path);
            return (
              <li key={r.path}>
                <Link
                  to={r.path}
                  className="pressable group flex items-center gap-2.5 rounded py-2.5"
                >
                  <ClockRotateRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs">
                    <span className="text-muted-foreground">{section}</span>
                    {detail && (
                      <>
                        <span className="text-muted-foreground/50"> / </span>
                        <span className="font-mono">{detail}</span>
                      </>
                    )}
                  </span>
                  <NavArrowRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

  const phase = queryPhase({ error, loading });
  const metricsDegraded = Boolean(
    paidAccess && metrics.data && metrics.data.source !== 'prometheus'
  );
  const failing = useMemo(() => workflows.filter((w) => w.state === 'error'), [workflows]);

  const metricsUnavailable = metrics.isPending || Boolean(metrics.error) || metricsDegraded;
  const figures = useMemo(
    () => fleetMetrics(Object.values(metrics.data?.apps ?? {})),
    [metrics.data]
  );

  // Memory held right now: non-parked instances only — a parked instance's
  // cgroup is gone, so it holds nothing. `/v1/instances` is cursor-paginated;
  // a partial page is never presented as an exact total.
  const residentKnown = !instances.isPending && !instances.error && !instances.data?.next_before;
  const resident = useMemo(() => {
    const rows = (instances.data?.instances ?? []).filter(
      (row) => row.state.toLowerCase() !== 'parked'
    );
    return { mb: rows.reduce((sum, row) => sum + row.ram_mb, 0), count: rows.length };
  }, [instances.data]);

  const setRange = (next: OverviewRange) =>
    void navigate({
      search: next === '24h' ? {} : { range: next },
      replace: true,
      resetScroll: false,
    });

  const usagePhase = queryPhase({ error: usage.error, loading: usage.isPending });

  const recent = useMemo(
    () => [...deployments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4),
    [deployments]
  );

  // A manual refresh shows it is working for at least 400ms, so a fast read
  // still reads as done rather than as a click that did nothing.
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    refresh();
    await Promise.allSettled([
      usage.refetch(),
      instances.refetch(),
      ...(paidAccess ? [metrics.refetch()] : []),
      new Promise((done) => setTimeout(done, 400)),
    ]);
    setRefreshing(false);
  };
  const verdict = verdictOf(account?.status, failing.length, metricsDegraded);
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

  return (
    <div className="flex flex-col gap-10">
      {featureFlags.onboardingV2 && <OnboardingChecklist />}
      {/* Keep the wind a faint accent so the charcoal canvas stays neutral. */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <WindFlow intensity={0.06} />
      </div>

      {/* The ground under the wind: the flow-dot field rises from the
          bottom of the viewport and is gone before mid-page — background,
          not furniture. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 h-[36vh] [mask-image:linear-gradient(to_top,black_25%,transparent)]"
      >
        <FlowDotsField />
      </div>

      {/* --- Greeting + search ------------------------------------- */}
      <div className="relative">
        <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-5 pt-2">
          {/* The verdict rides above the greeting as a pill; when something
              is wrong it is the page's alert and links to the trouble. */}
          {verdict && (
            <p role={verdict.trouble ? 'alert' : 'status'} className="contents">
              <Magnetic range={60} strength={0.2}>
                <Link
                  to={verdict.trouble ? '/dashboard/apps' : '/dashboard/usage'}
                  className="glass pressable label-mono inline-flex items-center gap-2 rounded-full bg-muted px-3.5 py-1.5 text-muted-foreground hover:border-border-secondary hover:text-foreground"
                >
                  <LiveDot color={verdict.color} />
                  {verdict.text}
                </Link>
              </Magnetic>
            </p>
          )}

          <h1 className="text-center text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            <WordReveal
              text={firstName ? `Let's get to work, ${firstName}` : "Let's get to work"}
              suffix={
                <span aria-hidden className="text-brand">
                  .
                </span>
              }
            />
          </h1>

          {/* Search, answered in place: a real combobox whose results drop
              down from the field itself — no detour through the ⌘K modal,
              which still exists everywhere for the keyboard. */}
          <OverviewSearch workflows={workflows} />

          {failing.length > 0 && (
            <p className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5">
              {failing.slice(0, 4).map((app) => (
                <Link
                  key={app.id}
                  to="/dashboard/apps/$appSlug"
                  params={{ appSlug: app.id }}
                  search={{ tab: 'Logs' }}
                  className="pressable inline-flex items-center gap-1.5 rounded font-mono text-xs hover:text-foreground"
                >
                  {app.name}
                  {paidAccess && (
                    <span style={{ color: 'var(--status-critical)' }}>
                      {app.errorRatePct.toFixed(2)}%
                    </span>
                  )}
                </Link>
              ))}
            </p>
          )}
        </div>
      </div>

      {/* --- Resource columns -------------------------------------- */}
      <div className="animate-item-enter relative grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 [animation-delay:60ms]">
        <AppsColumn workflows={workflows} />
        <DeploymentsColumn recent={recent} />
        <RecentsColumn />
      </div>

      {/* --- Analytics ------------------------------------------------ */}
      <section aria-labelledby="overview-analytics" className="relative flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id="overview-analytics" className="text-lg font-semibold">
              <Link
                to="/dashboard/analytics"
                search={range === '7d' ? { window: '7d' } : {}}
                className="pressable inline-flex items-center gap-1.5 rounded hover:text-brand"
              >
                Analytics
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            </h2>
            {metricsDegraded && (
              <p role="status" className="text-xs text-status-warning">
                Metrics degraded. Figures may be incomplete.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {paidAccess && (
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
        <OverviewStats
          paid={paidAccess}
          showPlanGate={Boolean(account) && !paidAccess}
          appCount={workflows.length}
          rangeDescription={RANGE_DESCRIPTION[range]}
          metrics={{ unavailable: metricsUnavailable, degraded: metricsDegraded, figures }}
          resident={{
            known: residentKnown,
            partial: Boolean(instances.data?.next_before),
            ...resident,
          }}
          usage={{
            phase: usagePhase,
            usedGbHours: usage.data?.used_gb_hours ?? 0,
            // null: a company with no usage this month carries no allowance yet.
            includedGbHours: usage.data?.included_gb_hours ?? null,
            overGbHours: usage.data?.overage_gb_hours ?? 0,
            overageCents: usage.data?.overage_cents,
            cpuHours: usage.data?.used_cpu_hours ?? null,
          }}
        />
      </section>
    </div>
  );
}
