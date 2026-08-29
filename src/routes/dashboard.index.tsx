import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Key, Plus, Upload } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  PageHeader,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { BeamMap, type RelayApp } from '@/components/dashboard/beam-map';
import { FirstRun } from '@/components/dashboard/first-run';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { BorderBeam } from '@/components/ui/border-beam';
import { ProgressRing } from '@/components/ui/progress-ring';
import { LiveDot } from '@/components/ui/live-dot';
import { WindFlow } from '@/components/dashboard/wind-flow';
import { CountUp } from '@/components/dashboard/motion';
import { Odometer } from '@/components/ui/odometer';
import { AnimatedList } from '@/components/ui/animated-list';
import { useData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { useApps, useAppsMetrics, useInstances, useUsageSummary } from '@/lib/api/queries';
import { formatCompact, formatRelative, type Workflow } from '@/lib/mock-data';
import type { Deployment } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/dashboard/')({
  component: OverviewPage,
  head: () => consoleHead('overview'),
});

/**
 * The overview as a relay station.
 *
 * A glossy bento with one hero: the Relay, the fleet drawn as a live flow
 * map — the edge hub wired to every app, light pulsing along the routes
 * that are awake. Around it, glass surfaces carry the allowance ring, the
 * traffic readouts, the meters, and the log. Everything worth knowing is
 * on the surface; nothing hides behind a hover.
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

const UNKNOWN = <span className="text-muted-foreground">—</span>;

/* ------------------------------------------------------------------ *
 * The verdict
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

function VerdictHeader({
  accountStatus,
  failing,
  degraded,
  firstName,
  appCount,
  plan,
}: {
  accountStatus: string | undefined;
  failing: Workflow[];
  degraded: boolean;
  firstName: string | undefined;
  appCount: number | undefined;
  plan: string | undefined;
}) {
  const verdict = verdictOf(accountStatus, failing.length, degraded);
  const billingProblem = accountStatus && accountStatus !== 'active' ? accountStatus : null;

  return (
    <header
      role={verdict.trouble ? 'alert' : 'status'}
      className="animate-item-enter flex flex-wrap items-start justify-between gap-x-6 gap-y-4"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <p className="label-mono flex items-center gap-2.5 text-muted-foreground">
          <LiveDot color={verdict.color} />
          {firstName ? `${firstName}'s fleet` : 'Your fleet'}
          {appCount != null && plan ? (
            <span className="text-muted-foreground/60">
              · {appCount} {appCount === 1 ? 'app' : 'apps'} · {plan}
            </span>
          ) : null}
        </p>
        <h1 className="text-2xl font-medium tracking-[-0.025em] sm:text-3xl">
          {verdict.text}
          <span aria-hidden style={{ color: verdict.color }}>
            .
          </span>
        </h1>

        {billingProblem ? (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            {billingProblem === 'past_due'
              ? 'Settle the outstanding invoice to avoid suspension.'
              : 'Apps may not serve traffic until it is resolved.'}
            <Link
              to="/dashboard/invoices"
              className="pressable inline-flex items-center gap-1 rounded text-xs text-brand hover:text-brand-hover"
            >
              View invoices
              <ArrowRight className="h-3 w-3" />
            </Link>
          </p>
        ) : failing.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
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
            {failing.length > 4 && (
              <span className="text-xs text-muted-foreground">+{failing.length - 4} more</span>
            )}
          </p>
        ) : degraded ? (
          <p className="text-sm text-muted-foreground">
            The metrics rollup is answering from a fallback — traffic figures read as unknown,
            never as zero.
          </p>
        ) : null}
      </div>

      <Button asChild size="sm" className="gap-1.5">
        <Link to="/dashboard/workflows/new">
          <Plus className="h-3.5 w-3.5" />
          New app
        </Link>
      </Button>
    </header>
  );
}

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

function CardLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="pressable inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
    >
      {children}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function RelayCard({
  apps,
  residentMb,
  residentKnown,
  darkMb,
}: {
  apps: RelayApp[];
  residentMb: number;
  residentKnown: boolean;
  darkMb: number;
}) {
  const awake = apps.filter((a) => a.awake).length;
  const asleep = apps.length - awake;

  return (
    <SpotlightCard elevation="raised" className="glass lg:col-span-8">
      <BorderBeam />
      <WindFlow intensity={0.35} />
      <div className="relative flex h-full flex-col gap-6 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
          <div className="flex items-baseline gap-4">
            <CardLabel>Fleet</CardLabel>
            <p className="text-sm [font-variant-numeric:tabular-nums]">
              <CountUp value={awake} className="font-semibold" />{' '}
              <span className="text-muted-foreground">awake</span>
              <span aria-hidden className="mx-2 text-muted-foreground/40">
                ·
              </span>
              <CountUp value={asleep} className="font-semibold" />{' '}
              <span className="text-muted-foreground">asleep</span>
            </p>
          </div>
          <CardLink to="/dashboard/workflows">All apps</CardLink>
        </div>

        <BeamMap apps={apps} className="flex-1" />

        <p className="text-xs text-muted-foreground">
          <span className="text-foreground [font-variant-numeric:tabular-nums]">
            {residentKnown ? residentMb.toLocaleString() : '—'} MB
          </span>{' '}
          resident
          {darkMb > 0 && (
            <>
              {' · '}
              <span className="[font-variant-numeric:tabular-nums]">
                {darkMb.toLocaleString()} MB
              </span>{' '}
              parked — held only when a request arrives
            </>
          )}
        </p>
      </div>
    </SpotlightCard>
  );
}

function AllowanceCard({ usage }: { usage: ReturnType<typeof useUsageSummary> }) {
  const phase = queryPhase({ error: usage.error, loading: usage.isPending });
  const data = usage.data;
  const used = data?.used_gb_hours ?? 0;
  const included = data?.included_gb_hours ?? 0;
  const remaining = Math.max(0, included - used);
  const over = (data?.overage_gb_hours ?? 0) > 0;
  const usedPct = included > 0 ? Math.min(100, (used / included) * 100) : 0;

  return (
    <SpotlightCard className="glass flex-1 [animation-delay:60ms]">
      <div className="flex h-full flex-col p-5">
        <div className="flex items-baseline justify-between gap-4">
          <CardLabel>Allowance</CardLabel>
          <CardLink to="/dashboard/usage">Usage</CardLink>
        </div>

        {phase !== 'ready' ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <InlinePhase phase={phase} error={usage.error} loadingMessage="Reading usage…" />
          </div>
        ) : (
          <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3">
            <ProgressRing
              value={over ? 100 : usedPct}
              tone={over ? 'warning' : 'brand'}
              size={132}
              label="GB-hour allowance used"
            >
              <span className="flex flex-col items-center">
                <span className="text-xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
                  <Odometer
                    value={over ? (data?.overage_gb_hours ?? 0) : remaining}
                    format={formatGbHours}
                  />
                </span>
                <span className="label-mono mt-1 text-muted-foreground">
                  {over ? 'GB-h over' : 'GB-h left'}
                </span>
              </span>
            </ProgressRing>
            <p className="text-center text-xs text-muted-foreground">
              <span className="[font-variant-numeric:tabular-nums]">{formatGbHours(used)}</span> of{' '}
              {formatGbHours(included)} · {data?.month}
              {over && (
                <span className="block" style={{ color: 'var(--status-warning)' }}>
                  {formatMoney(data?.overage_cents)} overage
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </SpotlightCard>
  );
}

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

  return (
    <SpotlightCard className="glass flex-1 [animation-delay:90ms]">
      <div className="flex h-full flex-col">
        <div className="px-5 pt-4 pb-2">
          <CardLabel>Traffic · last 24h</CardLabel>
        </div>
        <div className="flex flex-1 flex-col divide-y divide-border">
          <div className="flex flex-1 items-center justify-between gap-4 px-5 py-2.5">
            <span className="label-mono text-muted-foreground">Requests</span>
            <span className="text-xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
              {degraded ? (
                UNKNOWN
              ) : (
                <Odometer value={requests} format={formatCompact} className="metric-glow" />
              )}
            </span>
          </div>
          <div className="flex flex-1 items-center justify-between gap-4 px-5 py-2.5">
            <span className="label-mono text-muted-foreground">Error rate</span>
            <span
              className="text-xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]"
              style={!degraded && errorPct > 1 ? { color: 'var(--status-critical)' } : undefined}
            >
              {degraded ? UNKNOWN : `${errorPct.toFixed(2)}%`}
            </span>
          </div>
          <div className="flex flex-1 items-center justify-between gap-4 px-5 py-2.5">
            <span className="label-mono text-muted-foreground">Wake p95</span>
            <span className="text-xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
              {degraded || !wakeP95 ? (
                UNKNOWN
              ) : (
                <>
                  {Math.round(wakeP95)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">ms</span>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </SpotlightCard>
  );
}

function MeterTile({
  label,
  value,
  unit,
  format,
  delay,
  hint,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  format?: (v: number) => string;
  delay: number;
  hint: string;
}) {
  return (
    <SpotlightCard className={cn('glass col-span-6 lg:col-span-3')}>
      <div className="p-4" title={hint} style={{ animationDelay: `${delay}ms` }}>
        <CardLabel>{label}</CardLabel>
        <p className="mt-2.5 text-2xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
          {value == null ? (
            UNKNOWN
          ) : (
            <>
              <Odometer value={value} format={format} />
              <span className="ml-1.5 align-baseline text-sm font-normal text-muted-foreground">
                {unit}
              </span>
            </>
          )}
        </p>
      </div>
    </SpotlightCard>
  );
}

const DEPLOY_STATE: Record<string, { label: string; color: string; live?: boolean }> = {
  succeeded: { label: 'Live', color: 'var(--status-good)' },
  failed: { label: 'Failed', color: 'var(--status-critical)' },
};

function DeploymentsCard({ recent }: { recent: Deployment[] }) {
  return (
    <SpotlightCard className="glass lg:col-span-8 [animation-delay:180ms]">
      <div className="flex items-center justify-between gap-4 px-5 py-3.5">
        <CardLabel>Recent deployments</CardLabel>
        <CardLink to="/dashboard/deployments">All deployments</CardLink>
      </div>

      {recent.length === 0 ? (
        <div className="p-5 pt-0">
          <EmptyState message="Nothing deployed yet." />
        </div>
      ) : (
        <AnimatedList
          items={recent}
          className="divide-y divide-border border-t border-border"
          render={(d) => {
            const state = DEPLOY_STATE[d.state] ?? {
              label: 'Deploying',
              color: 'var(--status-warning)',
              live: true,
            };
            return (
              <div className="flex items-center gap-3 px-5 py-2.5">
                <span className="truncate font-mono text-xs">{d.workflowId}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {d.version || 'no image'} · {formatRelative(d.createdAt)}
                </span>
                {/* Colour plus text, never hue alone; in-flight breathes. */}
                <span
                  className="ml-auto flex shrink-0 items-center gap-1.5 text-xs"
                  style={{ color: state.color }}
                >
                  <span
                    className={cn('h-1.5 w-1.5 rounded-full', state.live && 'animate-breathe')}
                    style={{ background: state.color }}
                  />
                  {state.label}
                </span>
              </div>
            );
          }}
        />
      )}
    </SpotlightCard>
  );
}

const ACTIONS = [
  { to: '/dashboard/workflows/new', label: 'Deploy a new app', icon: Plus },
  { to: '/dashboard/import', label: 'Import a project', icon: Upload },
  { to: '/dashboard/keys', label: 'Mint an API key', icon: Key },
] as const;

function ActionsCard() {
  return (
    <SpotlightCard className="glass lg:col-span-4 [animation-delay:210ms]">
      <div className="px-5 pt-3.5 pb-1">
        <CardLabel>Shortcuts</CardLabel>
      </div>
      <ul className="flex list-none flex-col px-2 pb-2">
        {ACTIONS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="pressable flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
              <ArrowRight className="ml-auto h-3 w-3 opacity-50" />
            </Link>
          </li>
        ))}
      </ul>
    </SpotlightCard>
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

  // The relay's data: per-app resident instances (parked rows excluded — a
  // parked instance's cgroup is gone), joined back to slugs via the raw app
  // list, which is a cache hit on the store's own query. When the instance
  // read fails the map falls back to app states rather than an empty fleet.
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

  const relayApps = useMemo<RelayApp[]>(
    () =>
      workflows.flatMap((w): RelayApp[] => {
        const live = instRollup.get(w.id);
        if (live) return [{ slug: w.id, ramMb: live.mb, instances: live.count, awake: true }];
        if (w.state === 'running' && !residentKnown)
          return [{ slug: w.id, ramMb: w.memoryMb, instances: 1, awake: true }];
        // Active with nothing resident is scale-to-zero doing its job — a
        // dark route on the map, because that is what it holds.
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
  const darkMb = useMemo(
    () => relayApps.filter((a) => !a.awake).reduce((sum, a) => sum + a.ramMb, 0),
    [relayApps]
  );

  const recent = useMemo(
    () => [...deployments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [deployments]
  );

  const usageFailed = Boolean(usage.error);
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
    <div className="flex flex-col gap-6">
      <VerdictHeader
        accountStatus={account?.status}
        failing={failing}
        degraded={metricsDegraded}
        firstName={firstName}
        appCount={account?.app_count}
        plan={account?.plan}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <RelayCard
          apps={relayApps}
          residentMb={residentMb}
          residentKnown={residentKnown}
          darkMb={darkMb}
        />

        <div className="flex flex-col gap-4 lg:col-span-4">
          <AllowanceCard usage={usage} />
          <TrafficCard workflows={workflows} degraded={metricsDegraded} />
        </div>

        <div className="col-span-full grid grid-cols-12 gap-4">
          <MeterTile
            label="Memory now"
            value={residentKnown ? residentMb : undefined}
            unit="MB"
            delay={120}
            hint="RAM held by resident instances at this moment."
          />
          <MeterTile
            label="CPU"
            value={usageFailed ? undefined : usage.data?.used_cpu_hours}
            unit="h"
            format={(v) =>
              v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
            }
            delay={140}
            hint="CPU-hours consumed this billing period. Measured, not billed."
          />
          <MeterTile
            label="Egress"
            value={usageFailed ? undefined : usage.data?.used_egress_gb}
            unit="GB"
            format={(v) =>
              v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
            }
            delay={160}
            hint="Outbound transfer this billing period. Measured, not billed."
          />
          <MeterTile
            label="Ingress"
            value={usageFailed ? undefined : usage.data?.used_ingress_gb}
            unit="GB"
            format={(v) =>
              v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
            }
            delay={180}
            hint="Inbound transfer this billing period. Measured, not billed."
          />
        </div>

        <DeploymentsCard recent={recent} />
        <ActionsCard />
      </div>
    </div>
  );
}
