import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Plus, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  PageHeader,
  StateBadge,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { CountUp } from '@/components/dashboard/motion';
import { FootprintBand, type FootprintApp } from '@/components/dashboard/footprint-band';
import { FirstRun } from '@/components/dashboard/first-run';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { BorderBeam } from '@/components/ui/border-beam';
import { FuelGauge } from '@/components/ui/fuel-gauge';
import { LiveDot } from '@/components/ui/live-dot';
import { WindFlow } from '@/components/dashboard/wind-flow';
import { Skeleton } from '@/components/ui/skeleton';
import { Odometer } from '@/components/ui/odometer';
import { AnimatedList } from '@/components/ui/animated-list';
import { useData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { useApps, useAppsMetrics, useInstances, useUsageSummary } from '@/lib/api/queries';
import { formatCompact, formatRelative, type Workflow } from '@/lib/mock-data';
import type { Deployment } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/')({
  component: OverviewPage,
  head: () => consoleHead('overview'),
});

/**
 * The console landing page.
 *
 * One glance answers three questions, in order: is anything wrong (the
 * status line, and an alert card only when there is), what is alive right
 * now (the fleet card and its Footprint band), and what is it costing (the
 * allowance ring). Recent activity and traffic sit below.
 *
 * Every figure comes from reads the store already makes, plus the instance
 * list. A degraded Prometheus rollup reads as unknown, never as zero.
 */

const formatGbHours = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

function formatMoney(cents: number | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(
    cents / 100
  );
}

/** The mono eyebrow every card leads with. */
function CardLabel({ children }: { children: React.ReactNode }) {
  return <p className="label-mono text-muted-foreground">{children}</p>;
}

/* ------------------------------------------------------------------ *
 * Status line — the first thing the page says
 * ------------------------------------------------------------------ */

type SystemStatus = { color: string; text: string };

function systemStatus(
  accountStatus: string | undefined,
  failing: number,
  degraded: boolean
): SystemStatus {
  if (accountStatus && accountStatus !== 'active')
    return {
      color: 'var(--status-critical)',
      text: `Account ${accountStatus.replace(/_/g, ' ')}`,
    };
  if (failing > 0)
    return {
      color: 'var(--status-critical)',
      text: `${failing} ${failing === 1 ? 'app' : 'apps'} failing`,
    };
  if (degraded) return { color: 'var(--status-warning)', text: 'Metrics degraded' };
  return { color: 'var(--status-good)', text: 'All systems normal' };
}

/* ------------------------------------------------------------------ *
 * Alert card — exists only when something is wrong
 * ------------------------------------------------------------------ */

function SystemAlert({
  accountStatus,
  failing,
}: {
  accountStatus: string | undefined;
  failing: Workflow[];
}) {
  const billingProblem = accountStatus && accountStatus !== 'active' ? accountStatus : null;
  if (!billingProblem && failing.length === 0) return null;

  return (
    <div
      role="alert"
      className="animate-item-enter flex flex-wrap items-start gap-x-6 gap-y-3 rounded-xl border px-5 py-4"
      style={{
        borderColor: 'color-mix(in oklab, var(--status-critical) 40%, transparent)',
        background: 'color-mix(in oklab, var(--status-critical) 6%, transparent)',
      }}
    >
      <WarningTriangle
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color: 'var(--status-critical)' }}
      />
      {billingProblem ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            This account is <span className="font-medium">{billingProblem.replace(/_/g, ' ')}</span>
            .
            {billingProblem === 'past_due'
              ? ' Settle the outstanding invoice to avoid suspension.'
              : ' Apps may not serve traffic until it is resolved.'}
          </p>
          <Link
            to="/dashboard/invoices"
            className="pressable inline-flex items-center gap-1 rounded text-xs text-brand hover:text-brand-hover"
          >
            View invoices
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1.5">
          {failing.slice(0, 4).map((app) => (
            <Link
              key={app.id}
              to="/dashboard/workflows/$workflowId"
              params={{ workflowId: app.id }}
              search={{ tab: 'Logs' }}
              className="pressable inline-flex items-center gap-2 rounded font-mono text-xs hover:text-foreground"
            >
              {app.name}
              <span style={{ color: 'var(--status-critical)' }}>
                {app.errorRatePct.toFixed(2)}%
              </span>
            </Link>
          ))}
          {failing.length > 4 && (
            <span className="text-xs text-muted-foreground">+{failing.length - 4} more</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Fleet — the hero card
 * ------------------------------------------------------------------ */

function FleetCard({ workflows, bandApps }: { workflows: Workflow[]; bandApps: FootprintApp[] }) {
  const awake = workflows.filter((w) => w.state === 'running').length;
  const asleep = workflows.filter((w) => w.state === 'idle').length;

  return (
    <SpotlightCard elevation="raised" className="lg:col-span-7">
      <BorderBeam />
      {/* The wind itself — one light source for the hero. Shader-drawn air;
          falls back to the still SVG ribbons without WebGL. */}
      <WindFlow intensity={0.9} />
      <div className="relative flex h-full flex-col gap-7 p-6">
        <div className="flex items-start justify-between gap-4">
          <CardLabel>Fleet</CardLabel>
          <Link
            to="/dashboard/workflows"
            className="pressable inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
          >
            All apps
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <h2 className="text-5xl leading-none font-semibold tracking-[-0.04em] [font-variant-numeric:tabular-nums] sm:text-6xl">
          <CountUp value={awake} />
          <span className="ml-2.5 align-baseline text-xl font-medium tracking-normal text-muted-foreground sm:text-2xl">
            awake
          </span>
          <span aria-hidden className="mx-3.5 align-middle text-2xl text-muted-foreground/40">
            ·
          </span>
          <CountUp value={asleep} className="text-muted-foreground" />
          <span className="ml-2.5 align-baseline text-xl font-medium tracking-normal text-muted-foreground sm:text-2xl">
            asleep
          </span>
        </h2>

        {bandApps.length > 0 && <FootprintBand apps={bandApps} className="mt-auto" />}
      </div>
    </SpotlightCard>
  );
}

/* ------------------------------------------------------------------ *
 * Allowance — the cost ring
 * ------------------------------------------------------------------ */

function AllowanceCard({ usage }: { usage: ReturnType<typeof useUsageSummary> }) {
  const phase = queryPhase({ error: usage.error, loading: usage.isPending });
  const data = usage.data;
  const used = data?.used_gb_hours ?? 0;
  const included = data?.included_gb_hours ?? 0;
  const remaining = Math.max(0, included - used);
  const remainingPct = included > 0 ? Math.max(0, Math.min(100, (remaining / included) * 100)) : 0;
  const over = (data?.overage_gb_hours ?? 0) > 0;
  // Empty-but-alarming: an overrun tank shows a warning residue rather than
  // nothing, so "over" and "exactly empty" cannot be confused at a glance.
  const displayPct = over ? 3 : remainingPct;

  return (
    <SpotlightCard className="lg:col-span-5 [animation-delay:60ms]">
      <div className="flex h-full flex-col p-6">
        <div className="flex items-start justify-between gap-4">
          <CardLabel>Allowance · {data?.month ?? 'this month'}</CardLabel>
          <Link
            to="/dashboard/usage"
            className="pressable inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
          >
            Usage
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {phase !== 'ready' ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <InlinePhase phase={phase} error={usage.error} loadingMessage="Reading usage…" />
          </div>
        ) : (
          <div className="mt-5 flex flex-1 flex-col justify-center gap-6">
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-4xl leading-none font-semibold tracking-tight">
                <Odometer
                  value={over ? (data?.overage_gb_hours ?? 0) : remaining}
                  format={formatGbHours}
                  className="metric-glow"
                />
                <span className="ml-2 align-baseline text-sm font-normal text-muted-foreground">
                  {over ? 'GB-h over' : 'GB-h left'}
                </span>
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span className="[font-variant-numeric:tabular-nums]">{formatGbHours(used)}</span>{' '}
                of {formatGbHours(included)} used
              </p>
              {over && (
                <p className="text-xs" style={{ color: 'var(--status-warning)' }}>
                  {formatMoney(data?.overage_cents)} overage this period
                </p>
              )}
            </div>

            <FuelGauge
              pct={displayPct}
              tone={over ? 'warning' : 'brand'}
              label="GB-hour allowance remaining"
              scale={['0', formatGbHours(included)]}
            />
          </div>
        )}
      </div>
    </SpotlightCard>
  );
}

/* ------------------------------------------------------------------ *
 * Traffic
 * ------------------------------------------------------------------ */

function TrafficCard({ workflows, degraded }: { workflows: Workflow[]; degraded: boolean }) {
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

  const unknown = <span className="text-muted-foreground">—</span>;

  return (
    <SpotlightCard className="lg:col-span-5 [animation-delay:120ms]">
      <div className="flex h-full flex-col gap-5 p-6">
        <CardLabel>Traffic · last 24h</CardLabel>

        <p className="text-4xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
          {degraded ? unknown : <CountUp value={requests} format={formatCompact} />}
          <span className="ml-2 text-sm font-normal text-muted-foreground">requests</span>
        </p>

        <dl className="mt-auto grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-background/60 px-3.5 py-3">
            <dt className="label-mono text-muted-foreground">Error rate</dt>
            <dd
              className="mt-1.5 text-sm [font-variant-numeric:tabular-nums]"
              style={!degraded && errorPct > 1 ? { color: 'var(--status-critical)' } : undefined}
            >
              {degraded ? unknown : `${errorPct.toFixed(2)}%`}
            </dd>
          </div>
          <div className="rounded-lg bg-background/60 px-3.5 py-3">
            <dt className="label-mono text-muted-foreground">Wake p95</dt>
            <dd className="mt-1.5 text-sm [font-variant-numeric:tabular-nums]">
              {degraded || !wakeP95 ? unknown : `${Math.round(wakeP95)} ms`}
              <span className="ml-1 text-xs text-muted-foreground">fleet</span>
            </dd>
          </div>
        </dl>
      </div>
    </SpotlightCard>
  );
}

/* ------------------------------------------------------------------ *
 * Deployments — the live feed
 * ------------------------------------------------------------------ */

function DeploymentsCard({ recent }: { recent: Deployment[] }) {
  return (
    <SpotlightCard className="lg:col-span-7 [animation-delay:180ms]">
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <CardLabel>Recent deployments</CardLabel>
        <Link
          to="/dashboard/deployments"
          className="pressable inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
        >
          All deployments
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {recent.length === 0 ? (
        <div className="p-6">
          <EmptyState message="Nothing deployed yet." />
        </div>
      ) : (
        <AnimatedList
          items={recent}
          itemClassName="border-b border-border last:border-0"
          render={(d) => (
            <div className="flex items-center justify-between gap-3 px-6 py-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-mono text-xs">{d.workflowId}</span>
                <span className="text-xs text-muted-foreground">
                  {d.version || 'no image'} · {formatRelative(d.createdAt)}
                </span>
              </span>
              <StateBadge
                state={
                  d.state === 'succeeded' ? 'running' : d.state === 'failed' ? 'error' : 'deploying'
                }
              />
            </div>
          )}
        />
      )}
    </SpotlightCard>
  );
}

/* ------------------------------------------------------------------ *
 * Consumption rail — the meters, as a measured strip
 * ------------------------------------------------------------------ */

function MetricCell({
  label,
  value,
  unit,
  format,
  loading,
  hint,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  format?: (v: number) => string;
  loading: boolean;
  hint: string;
}) {
  return (
    <div className="crop-marks relative px-5 py-4" title={hint}>
      <i aria-hidden />
      <i aria-hidden />
      <i aria-hidden />
      <i aria-hidden />
      <p className="label-mono text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl leading-none font-semibold tracking-tight">
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : value == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            <Odometer value={value} format={format} className="metric-glow" />
            <span className="ml-1.5 align-baseline text-sm font-normal text-muted-foreground">
              {unit}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The informational meters the platform measures but does not bill —
 * resident memory right now, and the month's CPU, egress, and ingress
 * (ADR-039/046/048). Readout modules rather than cards or a ruled strip:
 * no boxes, just blueprint crop marks measuring each figure, odometer
 * digits that roll up on arrival, and a mint sheen across the numerals.
 * GB-hours stays with the allowance ring.
 */
function ConsumptionRail({
  residentMb,
  residentKnown,
  usage,
}: {
  residentMb: number;
  residentKnown: boolean;
  usage: ReturnType<typeof useUsageSummary>;
}) {
  const loading = usage.isPending;
  const failed = Boolean(usage.error);
  return (
    <div className="animate-item-enter grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-12 [animation-delay:90ms]">
      <MetricCell
        label="Memory now"
        value={residentKnown ? residentMb : undefined}
        unit="MB"
        loading={false}
        hint="RAM held by resident instances at this moment."
      />
      <MetricCell
        label="CPU"
        value={failed ? undefined : usage.data?.used_cpu_hours}
        unit="h"
        format={(v) =>
          v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
        }
        loading={loading}
        hint="CPU-hours consumed this billing period. Measured, not billed."
      />
      <MetricCell
        label="Egress"
        value={failed ? undefined : usage.data?.used_egress_gb}
        unit="GB"
        format={(v) =>
          v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
        }
        loading={loading}
        hint="Outbound transfer this billing period. Measured, not billed."
      />
      <MetricCell
        label="Ingress"
        value={failed ? undefined : usage.data?.used_ingress_gb}
        unit="GB"
        format={(v) =>
          v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
        }
        loading={loading}
        hint="Inbound transfer this billing period. Measured, not billed."
      />
    </div>
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
  const status = systemStatus(account?.status, failing.length, metricsDegraded);

  // The band's data: per-app resident instances (parked rows excluded — a
  // parked instance's cgroup is gone), joined back to slugs via the raw app
  // list, which is a cache hit on the store's own query. When the instance
  // read fails the band falls back to app states rather than an empty fleet.
  const { data: rawApps } = useApps();
  const slugById = useMemo(() => new Map((rawApps ?? []).map((a) => [a.id, a.slug])), [rawApps]);
  const residentKnown = !instances.isPending && !instances.error;
  const instRollup = useMemo(() => {
    const bySlug = new Map<string, { count: number; mb: number }>();
    for (const row of instances.data?.instances ?? []) {
      if (row.state.toLowerCase() === 'parked') continue;
      const slug = slugById.get(row.app_id);
      if (!slug) continue;
      const current = bySlug.get(slug) ?? { count: 0, mb: row.ram_mb };
      bySlug.set(slug, { count: current.count + 1, mb: row.ram_mb });
    }
    return bySlug;
  }, [instances.data, slugById]);

  const bandApps = useMemo<FootprintApp[]>(
    () =>
      workflows.flatMap((w): FootprintApp[] => {
        const live = instRollup.get(w.id);
        if (live) return [{ slug: w.id, ramMb: live.mb, instances: live.count, awake: true }];
        // Active with nothing resident is scale-to-zero doing its job — the
        // app renders dark, like a parked one, because that is what it holds.
        if (w.state === 'running' && !residentKnown)
          return [{ slug: w.id, ramMb: w.memoryMb, instances: 1, awake: true }];
        if (w.state === 'running' || w.state === 'idle')
          return [{ slug: w.id, ramMb: w.memoryMb, instances: 0, awake: false }];
        return [];
      }),
    [workflows, instRollup, residentKnown]
  );

  const residentMb = useMemo(
    () => [...instRollup.values()].reduce((sum, r) => sum + r.count * r.mb, 0),
    [instRollup]
  );

  const recent = useMemo(
    () => [...deployments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [deployments]
  );

  const firstName = user?.name.split(' ')[0];
  // Nothing deployed and the read succeeded: a page of zeroes is accurate
  // and useless, so the page becomes instructions instead.
  const firstRun = phase === 'ready' && workflows.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={firstName ? `Welcome${firstRun ? '' : ' back'}, ${firstName}` : 'Overview'}
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
          <>
            {/* The one-glance answer, before any figure. */}
            <p className="animate-item-enter -mt-2 flex items-center gap-2.5 text-sm text-muted-foreground">
              <LiveDot color={status.color} />
              {status.text}
            </p>

            <SystemAlert accountStatus={account?.status} failing={failing} />

            {/* Mirrored asymmetry: 7/5 then 5/7. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <FleetCard workflows={workflows} bandApps={bandApps} />
              <AllowanceCard usage={usage} />
              <ConsumptionRail
                residentMb={residentMb}
                residentKnown={residentKnown}
                usage={usage}
              />
              <TrafficCard workflows={workflows} degraded={metricsDegraded} />
              <DeploymentsCard recent={recent} />
            </div>
          </>
        ))}
    </div>
  );
}
