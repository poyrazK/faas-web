import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ClockRotateRight, NavArrowRight, Plus, RefreshDouble, Search } from 'iconoir-react';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { BorderBeam } from 'border-beam';
import { FirstRun } from '@/components/dashboard/first-run';
import { Magnetic } from '@/components/amicro/magnetic';
import { PointerGlow } from '@/components/amicro/pointer-glow';
import { Tilt } from '@/components/amicro/tilt';
import { WordReveal } from '@/components/amicro/word-reveal';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { LiveDot } from '@/components/ui/live-dot';
import { WindFlow } from '@/components/dashboard/wind-flow';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { Odometer } from '@/components/ui/odometer';
import { useData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { useAppsMetrics, useInstances, useUsageSummary } from '@/lib/api/queries';
import { formatCompact, formatRelative, type Workflow } from '@/lib/mock-data';
import type { Deployment } from '@/lib/mock-data';
import { readRecents, recentLabel } from '@/lib/recents';
import { consoleHead } from '@/lib/seo';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/dashboard/')({
  component: OverviewPage,
  head: () => consoleHead('overview'),
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
 * The analytics cards carry numbers, not charts: the API returns scalars,
 * and this console does not draw series it does not have. A degraded
 * Prometheus rollup reads as unknown, never as zero.
 */

const formatGbHours = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

function formatMoney(cents: number | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(
    cents / 100
  );
}

const UNKNOWN = <span className="text-muted-foreground">—</span>;

/* ------------------------------------------------------------------ *
 * Verdict pill
 * ------------------------------------------------------------------ */

type Verdict = { text: string; color: string; trouble: boolean };

function verdictOf(
  accountStatus: string | undefined,
  failing: number,
  degraded: boolean
): Verdict {
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
  if (degraded)
    return { text: 'Metrics degraded', color: 'var(--status-warning)', trouble: false };
  return { text: 'All systems normal', color: 'var(--status-good)', trouble: false };
}

/* ------------------------------------------------------------------ *
 * Columns
 * ------------------------------------------------------------------ */

function ColumnHeader({ label, to }: { label: string; to?: string }) {
  if (!to) return <p className="label-mono text-muted-foreground">{label}</p>;
  return (
    <Link
      to={to}
      className="pressable label-mono inline-flex items-center gap-1 rounded text-muted-foreground hover:text-foreground"
    >
      {label}
      <NavArrowRight className="h-3 w-3" />
    </Link>
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
      <ColumnHeader label="Apps" to="/dashboard/workflows" />
      <Link
        to="/dashboard/workflows/new"
        className="pressable relative mt-2 flex items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-border bg-card py-2 text-sm text-muted-foreground hover:border-border-secondary hover:text-foreground"
      >
        <PointerGlow />
        <Plus className="h-3.5 w-3.5" />
        New app
      </Link>
      <ul className="flex list-none flex-col divide-y divide-border">
        {shown.map((w) => (
          <li key={w.id}>
            <Link
              to="/dashboard/workflows/$workflowId"
              params={{ workflowId: w.id }}
              className="pressable group flex items-center gap-2.5 rounded py-2.5"
            >
              <span
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', w.state === 'running' && 'animate-breathe')}
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
      <ColumnHeader label="Deployments" to="/dashboard/deployments" />
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
              <li key={d.id} className="flex items-center gap-2.5 py-2.5">
                {/* Colour plus text, never hue alone; in-flight breathes. */}
                <span
                  className={cn('h-1.5 w-1.5 shrink-0 rounded-full', state.live && 'animate-breathe')}
                  style={{ background: state.color }}
                />
                <span className="truncate font-mono text-xs">{d.workflowId}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {formatRelative(d.createdAt)}
                </span>
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
 * Analytics
 * ------------------------------------------------------------------ */

function StatCard({
  label,
  hint,
  sub,
  large,
  className,
  children,
}: {
  label: string;
  hint: string;
  /** The quiet last line — real context, so the card ends composed instead
   * of trailing off into empty surface. */
  sub?: React.ReactNode;
  large?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // A whisper of tilt — the glass leans toward the cursor. Data cards tip,
    // never flip.
    <Tilt maxTilt={3} className={className}>
      <SpotlightCard className="glass card-lux h-full">
        <div
          className={cn('flex h-full flex-col p-5', large ? 'min-h-36 gap-3 p-6' : 'gap-2.5')}
          title={hint}
        >
          <p className="label-mono text-muted-foreground">{label}</p>
          <p
            className={cn(
              'metric-glow leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]',
              large ? 'text-5xl' : 'text-2xl'
            )}
          >
            {children}
          </p>
          {sub != null && (
            <p className="mt-auto pt-1 text-xs text-muted-foreground">{sub}</p>
          )}
        </div>
      </SpotlightCard>
    </Tilt>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

function OverviewPage() {
  const { workflows, deployments, loading, error, refresh } = useData();
  const { account, user } = useAuth();
  const usage = useUsageSummary();
  // Same key the store already reads — a cache hit, here for `source`.
  const metrics = useAppsMetrics('24h');
  const instances = useInstances();

  const phase = queryPhase({ error, loading });
  const metricsDegraded = Boolean(metrics.data && metrics.data.source !== 'prometheus');
  const failing = useMemo(() => workflows.filter((w) => w.state === 'error'), [workflows]);

  // Resident RAM right now: non-parked instances only — a parked instance's
  // cgroup is gone, so it holds nothing.
  const residentKnown = !instances.isPending && !instances.error;
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
    const total = workflows.reduce((sum, w) => sum + w.invocations24h, 0);
    // Weighted by traffic, not a mean of percentages: one idle app at 100%
    // must not outweigh a busy one at 0.01%.
    const errored = workflows.reduce(
      (sum, w) => sum + w.invocations24h * (w.errorRatePct / 100),
      0
    );
    // The wake histogram is unlabelled upstream — every row carries the same
    // fleet figure, so the first non-zero one is the figure.
    const wake = workflows.find((w) => w.coldStartP50Ms > 0)?.coldStartP50Ms ?? 0;
    return { requests: total, errorPct: total > 0 ? (errored / total) * 100 : 0, wakeP95: wake };
  }, [workflows]);

  const usageData = usage.data;
  const included = usageData?.included_gb_hours ?? 0;
  const remainingGbh = Math.max(0, included - (usageData?.used_gb_hours ?? 0));
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
    void metrics.refetch();
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
          description="Nothing deployed yet. Three commands and you are live."
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

  return (
    <div className="flex flex-col gap-10">
      {/* The gregale fills the whole background: a fixed viewport layer
          behind the content (the chromed sidebar and top bar carry higher
          z and opaque grounds, so it stays the page's air, not theirs). */}
      <div aria-hidden className="fixed inset-0">
        <WindFlow intensity={0.3} />
      </div>

      {/* --- Greeting + search ------------------------------------- */}
      <div className="relative">
        <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-5 pt-2">
          {/* The verdict rides above the greeting as a pill; when something
              is wrong it is the page's alert and links to the trouble. */}
          <p role={verdict.trouble ? 'alert' : 'status'} className="contents">
            <Magnetic range={60} strength={0.2}>
              <Link
                to={verdict.trouble ? '/dashboard/workflows' : '/dashboard/usage'}
                className="glass pressable label-mono inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-1.5 text-muted-foreground hover:border-border-secondary hover:text-foreground"
              >
                <LiveDot color={verdict.color} />
                {verdict.text}
              </Link>
            </Magnetic>
          </p>

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

          {/* The palette's front door — the top bar no longer carries one.
              The beam is the npm `border-beam` package: its ocean variant
              hue-rotated onto the brand mint (~162°) via its --beam-hue-base
              hook, full strength, swing tightened so it stays mint. */}
          <BorderBeam
            size="md"
            colorVariant="ocean"
            theme="dark"
            strength={1}
            hueRange={10}
            className="w-full"
            style={{ ['--beam-hue-base' as string]: '-78deg' }}
          >
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('gregale:open-palette'))}
              aria-label="Search apps, pages, and actions"
              aria-keyshortcuts="Meta+K Control+K"
              className="glass pressable relative flex h-11 w-full items-center gap-3 overflow-hidden rounded-xl border border-border px-4 text-sm text-muted-foreground shadow-elevation-1 hover:border-border-secondary hover:text-foreground"
            >
              <PointerGlow />
              <Search className="h-4 w-4 shrink-0" />
              Search
              <Kbd className="ml-auto px-1.5">⌘K</Kbd>
            </button>
          </BorderBeam>

          {failing.length > 0 && (
            <p className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5">
              {failing.slice(0, 4).map((app) => (
                <Link
                  key={app.id}
                  to="/dashboard/workflows/$workflowId"
                  params={{ workflowId: app.id }}
                  search={{ tab: 'Logs' }}
                  className="pressable inline-flex items-center gap-1.5 rounded font-mono text-xs hover:text-foreground"
                >
                  {app.name}
                  <span style={{ color: 'var(--status-critical)' }}>
                    {app.errorRatePct.toFixed(2)}%
                  </span>
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

      {/* --- Analytics --------------------------------------------- */}
      <section className="animate-item-enter relative flex flex-col gap-4 [animation-delay:120ms]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Analytics</h2>
          <div className="flex items-center gap-2">
            {metricsDegraded && (
              <span className="text-xs" style={{ color: 'var(--status-warning)' }}>
                metrics degraded — unknowns read as —
              </span>
            )}
            <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              Last 24 hours
            </span>
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshing}
              aria-label="Refresh analytics"
              className="pressable rounded-lg border border-border p-1.5 text-muted-foreground hover:border-border-secondary hover:text-foreground disabled:opacity-50"
            >
              <RefreshDouble className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Total requests"
            large
            className="col-span-2"
            hint="Requests served across the fleet, last 24 hours."
            sub={
              metricsDegraded
                ? 'metrics degraded'
                : `across ${workflows.length} ${workflows.length === 1 ? 'app' : 'apps'} · last 24 hours`
            }
          >
            {metricsDegraded ? UNKNOWN : <Odometer value={requests} format={formatCompact} />}
          </StatCard>
          <StatCard
            label="Error rate"
            large
            className="col-span-2"
            hint="Errored share of served requests, weighted by traffic."
            sub={
              metricsDegraded
                ? 'metrics degraded'
                : `≈ ${formatCompact(Math.round((requests * errorPct) / 100))} errored · weighted by traffic`
            }
          >
            {metricsDegraded ? (
              UNKNOWN
            ) : (
              <span style={errorPct > 1 ? { color: 'var(--status-critical)' } : undefined}>
                {errorPct.toFixed(2)}%
              </span>
            )}
          </StatCard>

          <StatCard
            label="Wake p95"
            hint="95th-percentile cold-start time across the fleet."
            sub="cold start · fleet"
          >
            {metricsDegraded || !wakeP95 ? (
              UNKNOWN
            ) : (
              <>
                {Math.round(wakeP95)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">ms</span>
              </>
            )}
          </StatCard>
          <StatCard
            label="Memory now"
            hint="RAM held by resident instances at this moment."
            sub={
              residentKnown
                ? `${residentCount} resident ${residentCount === 1 ? 'instance' : 'instances'}`
                : 'instance read failed'
            }
          >
            {residentKnown ? (
              <>
                <Odometer value={residentMb} />
                <span className="ml-1 text-sm font-normal text-muted-foreground">MB</span>
              </>
            ) : (
              UNKNOWN
            )}
          </StatCard>
          <StatCard
            label={overGbh > 0 ? 'GB-h over' : 'GB-h left'}
            hint="Compute allowance for this billing period."
            sub={
              usage.isPending || usageFailed
                ? 'reading usage'
                : overGbh > 0
                  ? `${formatMoney(usageData?.overage_cents)} overage · ${usageData?.month}`
                  : `of ${formatGbHours(included)} · ${usageData?.month}`
            }
          >
            {usage.isPending ? (
              <Skeleton className="h-6 w-16" />
            ) : usageFailed ? (
              UNKNOWN
            ) : overGbh > 0 ? (
              <span style={{ color: 'var(--status-warning)' }}>
                <Odometer value={overGbh} format={formatGbHours} />
              </span>
            ) : (
              <Odometer value={remainingGbh} format={formatGbHours} />
            )}
          </StatCard>
          <StatCard
            label="CPU"
            hint="CPU-hours consumed this billing period. Measured, not billed."
            sub="this period · measured, not billed"
          >
            {usage.isPending ? (
              <Skeleton className="h-6 w-16" />
            ) : usageFailed || usageData?.used_cpu_hours == null ? (
              UNKNOWN
            ) : (
              <>
                <Odometer
                  value={usageData.used_cpu_hours}
                  format={(v) =>
                    v.toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })
                  }
                />
                <span className="ml-1 text-sm font-normal text-muted-foreground">h</span>
              </>
            )}
          </StatCard>
        </div>

        <div className="flex justify-end">
          <Link
            to="/dashboard/usage"
            className="pressable inline-flex items-center gap-1 rounded font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            Usage
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </section>
    </div>
  );
}
