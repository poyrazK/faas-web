import { useId } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { formatCompact, formatRelative, type Workflow } from '@/lib/mock-data';
import { useApps, useAppsMetrics, useInstances } from '@/lib/api/queries';
import type { ProjectDetail } from '@/lib/api/projects';
import { StatCard, Unit, UNKNOWN } from '../overview-analytics/overview-stats';
import { PlanGate } from '../plan-gate';
import { FIELD_ERROR_PCT } from '../error-threshold';
import { lastDeploy, projectResident, projectTraffic } from './project-status-data';
import { workloadNote } from './project-words';

/** Below this share of failed requests the error rate reads as good; the Overview's line. */
const CALM_ERROR_PCT = 1;

const TONE_TEXT = {
  good: 'text-brand',
  warning: 'text-status-warning',
  critical: 'text-status-critical',
} as const;
type Tone = keyof typeof TONE_TEXT;

/** Failing at the console's one threshold, worth a look above the calm line, good below it. */
export function errorTone(pct: number): Tone {
  return pct >= FIELD_ERROR_PCT ? 'critical' : pct > CALM_ERROR_PCT ? 'warning' : 'good';
}

/**
 * How the project is doing, as six numbers: what it served and how much of
 * that failed, its slowest app, how often a request had to wake an app, what
 * is running right now, and when it last deployed.
 *
 * Every figure is one the console already reads for the account, narrowed to
 * this project's apps. They are scalars over a fixed window, so they are
 * numbers and never lines; one that cannot be read for every app is a dash.
 * Trends, per-app tables and other windows are on Analytics.
 */
export function ProjectStatus({
  projectSlug,
  workloads,
  apps,
  paid,
  planKnown,
}: {
  projectSlug: string;
  workloads: ProjectDetail['workloads'];
  /** The account's apps by slug, from the store. */
  apps: ReadonlyMap<string, Workflow>;
  /** Hobby and above: request, error and latency figures exist. */
  paid: boolean;
  planKnown: boolean;
}) {
  const id = useId();
  const slugs = workloads.map((workload) => workload.slug);
  const metrics = useAppsMetrics('24h', { enabled: paid });
  const instances = useInstances();
  const appList = useApps();

  const traffic = projectTraffic(slugs, metrics.data, new Set(apps.keys()));
  const trafficKnown = !metrics.isPending && !metrics.error && traffic.known;
  const degraded = Boolean(metrics.data && metrics.data.source !== 'prometheus');
  const trafficNote = metrics.isPending
    ? 'reading metrics'
    : degraded
      ? 'metrics degraded'
      : 'metrics unavailable';
  const t = traffic.totals;

  const resident = projectResident(
    slugs,
    appList.data && new Map(appList.data.map((app) => [app.slug, app.id])),
    instances.error ? undefined : instances.data
  );
  const deployed = lastDeploy(slugs, apps);
  // How that deployment went, from the project's own answer for its app.
  const deployedWorkload = workloads.find((workload) => workload.slug === deployed?.slug);
  const deployNote = deployedWorkload ? workloadNote(deployedWorkload) : null;
  const deployTone: Tone | undefined = deployNote
    ? deployNote.tone
    : deployedWorkload?.deployment_status === 'live'
      ? 'good'
      : undefined;
  const errTone = trafficKnown && t.errorRatePct != null ? errorTone(t.errorRatePct) : undefined;
  const appWord = (n: number) => `${n} ${n === 1 ? 'app' : 'apps'}`;

  if (!slugs.length) return null;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-[1.75rem] bg-muted/25 p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 id={id} className="text-lg font-semibold tracking-[-0.01em]">
            Status
          </h2>
          {paid && (
            <p className="text-[13px] text-muted-foreground">Traffic over the last 24 hours.</p>
          )}
        </div>
        <Link
          to="/dashboard/analytics"
          search={{ project: projectSlug }}
          className="pressable inline-flex items-center gap-1 rounded text-[13px] text-muted-foreground hover:text-foreground"
        >
          Analytics
          <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      </header>
      {planKnown && !paid && (
        <PlanGate
          feature="Metrics"
          description="Request counts, error rates and response times start on Hobby. What is running now and the last deploy are below."
        />
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {paid && (
          <>
            <StatCard
              label="Requests"
              large
              className="col-span-2"
              hint="Requests this project's apps served over the last 24 hours."
              sub={trafficKnown ? `Across ${appWord(slugs.length)}` : trafficNote}
            >
              {trafficKnown ? formatCompact(t.requests) : UNKNOWN}
            </StatCard>
            <StatCard
              label="Error rate"
              large
              className="col-span-2"
              tone={errTone}
              hint="Share of requests that failed, weighted by each app's traffic."
              sub={
                !trafficKnown
                  ? trafficNote
                  : t.errorRatePct == null
                    ? 'No requests to measure'
                    : `${formatCompact(t.errors)} failed, weighted by traffic`
              }
            >
              {!trafficKnown || t.errorRatePct == null ? (
                UNKNOWN
              ) : (
                <span className={errTone && TONE_TEXT[errTone]}>{t.errorRatePct.toFixed(2)}%</span>
              )}
            </StatCard>
            <StatCard
              label="Slowest app"
              hint="The highest p95 response time among this project's apps: 95% of that app's requests were faster. Percentiles of different apps cannot be combined into one."
              sub={
                !trafficKnown
                  ? trafficNote
                  : t.slowest
                    ? `${t.slowest.slug}, p95`
                    : 'No requests to measure'
              }
            >
              {trafficKnown && t.slowest ? (
                <>
                  {Math.round(t.slowest.p95Ms).toLocaleString('en')}
                  <Unit>ms</Unit>
                </>
              ) : (
                UNKNOWN
              )}
            </StatCard>
            <StatCard
              label="Woke from sleep"
              hint="Share of requests that arrived while the app was asleep and waited for it to wake (cold starts)."
              sub={
                !trafficKnown
                  ? trafficNote
                  : t.coldRatePct == null
                    ? 'No requests to measure'
                    : 'of requests waited for a wake'
              }
            >
              {!trafficKnown || t.coldRatePct == null ? UNKNOWN : `${t.coldRatePct.toFixed(1)}%`}
            </StatCard>
          </>
        )}
        <StatCard
          label="Running now"
          hint="Instances of this project's apps holding memory right now. Sleeping apps hold none."
          sub={
            !resident.known
              ? instances.isPending || appList.isPending
                ? 'reading instances'
                : 'instances unavailable'
              : resident.count === 0
                ? 'Every app is asleep'
                : `${resident.mb.toLocaleString('en')} MB held by ${appWord(resident.apps)}`
          }
        >
          {resident.known ? (
            <>
              {resident.count}
              <Unit>{resident.count === 1 ? 'instance' : 'instances'}</Unit>
            </>
          ) : (
            UNKNOWN
          )}
        </StatCard>
        <StatCard
          label="Last deploy"
          tone={deployTone}
          hint="The most recent deployment of any app in this project."
          sub={
            deployed ? (
              <>
                {deployed.name}
                {deployTone && (
                  <span className={TONE_TEXT[deployTone]}>
                    {' · '}
                    {deployNote ? deployNote.text : 'live'}
                  </span>
                )}
              </>
            ) : (
              'No deployments yet'
            )
          }
        >
          {deployed ? formatRelative(deployed.at) : UNKNOWN}
        </StatCard>
      </div>
    </section>
  );
}
