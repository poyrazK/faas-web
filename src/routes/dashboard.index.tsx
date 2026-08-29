import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { Harbor, type HarborApp } from '@/components/dashboard/harbor';
import { FirstRun } from '@/components/dashboard/first-run';
import { LiveDot } from '@/components/ui/live-dot';
import { WindFlow } from '@/components/dashboard/wind-flow';
import { Skeleton } from '@/components/ui/skeleton';
import { Odometer } from '@/components/ui/odometer';
import { AnimatedList } from '@/components/ui/animated-list';
import { useData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { useApps, useAppsMetrics, useInstances, useUsageSummary } from '@/lib/api/queries';
import { formatCompact, formatRelative } from '@/lib/mock-data';
import type { Deployment } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/dashboard/')({
  component: OverviewPage,
  head: () => consoleHead('overview'),
});

/**
 * The overview as a harbor at night.
 *
 * One quiet page: the verdict, the Harbor (the fleet as lights on a
 * waterline, reflected in the water), a single hairline strip of figures,
 * and the log. Nothing is boxed; detail lives one hover away instead of
 * on the surface. The page should read in three seconds and reward a
 * fourth.
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

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

type Verdict = {
  text: string;
  /** Dot and full-stop color; the words stay ink. */
  color: string;
  trouble: boolean;
};

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
 * The figures
 * ------------------------------------------------------------------ */

function Figure({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 px-6 py-5 first:pl-0 last:pr-0" title={hint}>
      <p className="text-2xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
        {children}
      </p>
      <p className="label-mono mt-2 text-muted-foreground">{label}</p>
    </div>
  );
}

const UNKNOWN = <span className="text-muted-foreground">—</span>;

/* ------------------------------------------------------------------ *
 * The record
 * ------------------------------------------------------------------ */

const DEPLOY_STATE: Record<string, { label: string; color: string; live?: boolean }> = {
  succeeded: { label: 'Live', color: 'var(--status-good)' },
  failed: { label: 'Failed', color: 'var(--status-critical)' },
};

function RecordRow({ d }: { d: Deployment }) {
  const state = DEPLOY_STATE[d.state] ?? {
    label: 'Deploying',
    color: 'var(--status-warning)',
    live: true,
  };
  return (
    <div className="flex items-center gap-3 py-2.5">
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
}

/** The page's only link furniture: one quiet mono arrow, right-aligned. */
function QuietLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="pressable inline-flex items-center gap-1 rounded font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      {children}
      <ArrowRight className="h-3 w-3" />
    </Link>
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

  // The harbor's data: per-app resident instances (parked rows excluded — a
  // parked instance's cgroup is gone), joined back to slugs via the raw app
  // list, which is a cache hit on the store's own query. When the instance
  // read fails the scene falls back to app states rather than an empty fleet.
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

  const harborApps = useMemo<HarborApp[]>(
    () =>
      workflows.flatMap((w): HarborApp[] => {
        const live = instRollup.get(w.id);
        if (live) return [{ slug: w.id, ramMb: live.mb, instances: live.count, awake: true }];
        if (w.state === 'running' && !residentKnown)
          return [{ slug: w.id, ramMb: w.memoryMb, instances: 1, awake: true }];
        // Active with nothing resident is scale-to-zero doing its job — an
        // unlit berth on the line, because that is what it holds.
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
  const residentCount = useMemo(
    () => [...instRollup.values()].reduce((sum, r) => sum + r.count, 0),
    [instRollup]
  );
  const darkMb = useMemo(
    () => harborApps.filter((a) => !a.awake).reduce((sum, a) => sum + a.ramMb, 0),
    [harborApps]
  );

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
  const usedGbh = usageData?.used_gb_hours ?? 0;
  const remainingGbh = Math.max(0, included - usedGbh);
  const overGbh = usageData?.overage_gb_hours ?? 0;
  const usageUnknown = Boolean(usage.error);

  const recent = useMemo(
    () => [...deployments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [deployments]
  );

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

  const verdict = verdictOf(account?.status, failing.length, metricsDegraded);
  const billingProblem =
    account?.status && account.status !== 'active' ? account.status : null;

  return (
    <div className="relative flex flex-col">
      {/* The gregale itself, blowing over the harbor and nothing else. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[24rem] [mask-image:linear-gradient(to_bottom,black_35%,transparent)]"
      >
        <WindFlow intensity={0.4} />
      </div>

      {/* --- The verdict ------------------------------------------- */}
      <header
        role={verdict.trouble ? 'alert' : 'status'}
        className="animate-item-enter relative flex flex-wrap items-start justify-between gap-x-6 gap-y-4"
      >
        <div className="flex min-w-0 flex-col gap-2.5">
          <p className="label-mono flex items-center gap-2.5 text-muted-foreground">
            <LiveDot color={verdict.color} />
            {firstName ? `${firstName}'s fleet` : 'Your fleet'}
            {account ? (
              <span className="text-muted-foreground/60">
                · {account.app_count} {account.app_count === 1 ? 'app' : 'apps'} · {account.plan}
              </span>
            ) : null}
          </p>
          <h1 className="text-3xl font-medium tracking-[-0.03em] sm:text-4xl">
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
          ) : metricsDegraded ? (
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

      {/* --- The harbor -------------------------------------------- */}
      <section className="animate-item-enter relative mt-12 [animation-delay:70ms]">
        <Harbor apps={harborApps} />
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <p className="text-xs text-muted-foreground">
            <span className="text-foreground [font-variant-numeric:tabular-nums]">
              {residentKnown ? residentMb.toLocaleString() : '—'} MB
            </span>{' '}
            alight
            {darkMb > 0 && (
              <>
                {' · '}
                <span className="[font-variant-numeric:tabular-nums]">
                  {darkMb.toLocaleString()} MB
                </span>{' '}
                dark water — held only when a request arrives
              </>
            )}
          </p>
          <QuietLink to="/dashboard/workflows">All apps</QuietLink>
        </div>
      </section>

      {/* --- The figures ------------------------------------------- */}
      <section className="animate-item-enter relative mt-12 [animation-delay:140ms]">
        <div className="grid grid-cols-2 border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-border lg:grid-cols-5">
          <Figure
            label="MB resident"
            hint={
              residentKnown
                ? `RAM held by ${residentCount} resident ${
                    residentCount === 1 ? 'instance' : 'instances'
                  } at this moment.`
                : 'The instance read failed — resident memory is unknown.'
            }
          >
            {residentKnown ? <Odometer value={residentMb} /> : UNKNOWN}
          </Figure>
          <Figure
            label={overGbh > 0 ? 'GB-h over' : 'GB-h left'}
            hint={
              overGbh > 0
                ? `${formatMoney(usageData?.overage_cents)} of overage in ${usageData?.month}.`
                : `${formatGbHours(usedGbh)} of ${formatGbHours(included)} GB-hours used in ${
                    usageData?.month ?? 'this period'
                  }.`
            }
          >
            {usage.isPending ? (
              <Skeleton className="h-6 w-16" />
            ) : usageUnknown ? (
              UNKNOWN
            ) : overGbh > 0 ? (
              <span style={{ color: 'var(--status-warning)' }}>
                <Odometer value={overGbh} format={formatGbHours} />
              </span>
            ) : (
              <Odometer value={remainingGbh} format={formatGbHours} />
            )}
          </Figure>
          <Figure label="requests · 24h" hint="Requests served across the fleet, last 24 hours.">
            {metricsDegraded ? UNKNOWN : <Odometer value={requests} format={formatCompact} />}
          </Figure>
          <Figure
            label="error rate · 24h"
            hint="Errored share of served requests, weighted by traffic."
          >
            {metricsDegraded ? (
              UNKNOWN
            ) : (
              <span
                style={errorPct > 1 ? { color: 'var(--status-critical)' } : undefined}
              >{`${errorPct.toFixed(2)}%`}</span>
            )}
          </Figure>
          <Figure label="wake p95" hint="95th-percentile cold-start time across the fleet.">
            {metricsDegraded || !wakeP95 ? (
              UNKNOWN
            ) : (
              <>
                {Math.round(wakeP95)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">ms</span>
              </>
            )}
          </Figure>
        </div>
        <div className="mt-3 flex justify-end">
          <QuietLink to="/dashboard/usage">Usage</QuietLink>
        </div>
      </section>

      {/* --- The record -------------------------------------------- */}
      <section className="animate-item-enter relative mt-12 [animation-delay:210ms]">
        {recent.length === 0 ? (
          <EmptyState message="Nothing deployed yet." />
        ) : (
          <AnimatedList
            items={recent}
            className="divide-y divide-border border-y border-border"
            render={(d) => <RecordRow d={d} />}
          />
        )}
        <div className="mt-3 flex justify-end">
          <QuietLink to="/dashboard/deployments">All deployments</QuietLink>
        </div>
      </section>
    </div>
  );
}
