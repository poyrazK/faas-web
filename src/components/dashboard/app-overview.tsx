import { CheckCircle, Circle, OpenNewWindow, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import type { Workflow } from '@/lib/mock-data';
import { formatCompact, formatMs } from '@/lib/mock-data';
import type { AppMetrics, Deployment } from '@/lib/api/queries';
import { deploymentPhase } from '@/lib/deployment-status';
import { ReleaseStatusLabel } from './release-status-label';
import { failureSummary } from './failure-summary';

type Read<T> = { data?: T; isPending: boolean; error: unknown };
type Destination = 'Metrics' | 'Deployments' | 'Logs' | 'Errors' | 'Configuration';

interface AppOverviewProps {
  app: Workflow;
  releases: Read<Deployment[]>;
  metrics: Read<AppMetrics>;
  metricsAccess: 'checking' | 'available' | 'restricted';
  onNavigate: (tab: Destination, deploymentId?: string) => void;
  onDeploy: () => void;
  onRetryReleases: () => void;
  onRetryMetrics: () => void;
}

const APP_STATES: Record<string, { label: string; detail: string; tone: string }> = {
  active: {
    label: 'Running',
    detail: 'Your app is active. Check traffic below for recent request health.',
    tone: 'var(--status-good)',
  },
  running: {
    label: 'Running',
    detail: 'Your app is active. Check traffic below for recent request health.',
    tone: 'var(--status-good)',
  },
  parked: {
    label: 'Idle',
    detail: 'Your app is parked. Idle is a normal part of scale-to-zero.',
    tone: 'var(--muted-foreground)',
  },
  stopped: {
    label: 'Stopped',
    detail: 'The platform reports this app as stopped.',
    tone: 'var(--muted-foreground)',
  },
  idle: {
    label: 'Idle',
    detail: 'No running state is reported. Check the latest release for context.',
    tone: 'var(--muted-foreground)',
  },
  deploying: {
    label: 'Deploying',
    detail: 'A deployment is in progress. Follow its status below.',
    tone: 'var(--status-warning)',
  },
  pending: {
    label: 'Pending',
    detail: 'The app is waiting for its next state.',
    tone: 'var(--status-warning)',
  },
  building: {
    label: 'Building',
    detail: 'A deployment is being built. Follow its status below.',
    tone: 'var(--status-warning)',
  },
  error: {
    label: 'App error',
    detail: 'The app reports an error. Inspect its logs and latest release.',
    tone: 'var(--status-critical)',
  },
  failed: {
    label: 'App error',
    detail: 'The app reports a failure. Inspect its logs and latest release.',
    tone: 'var(--status-critical)',
  },
  crashed: {
    label: 'App crashed',
    detail: 'The app reports a crash. Inspect its logs and latest release.',
    tone: 'var(--status-critical)',
  },
};

const SOURCE_LABELS = new Map([
  ['github', 'GitHub'],
  ['tarball', 'Source archive'],
  ['image', 'Container image'],
  ['oci', 'Container image'],
]);

function endpoint(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Time not reported'
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function measured(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A read-only landing view. All actions lead to existing, app-scoped workflows. */
export function AppOverview({
  app,
  releases,
  metrics,
  metricsAccess,
  onNavigate,
  onDeploy,
  onRetryReleases,
  onRetryMetrics,
}: AppOverviewProps) {
  // The app-scoped API orders deployments newest-first. Do not replace this
  // with the first successful row: a failed latest attempt still needs attention.
  const latest = releases.data?.[0];
  const releasesReady = !releases.isPending && !releases.error;
  const empty = releasesReady && !latest;
  const rawState = app.reportedStatus?.trim() || app.state;
  const state = empty
    ? {
        label: 'Not deployed',
        detail: 'Your app is created. Deploy code to give it a running release.',
        tone: 'var(--muted-foreground)',
      }
    : !latest && !releasesReady
      ? {
          label: 'Status unconfirmed',
          detail: 'Deployment history is needed to confirm whether this app has been deployed.',
          tone: 'var(--muted-foreground)',
        }
      : Object.hasOwn(APP_STATES, rawState.toLowerCase())
        ? APP_STATES[rawState.toLowerCase()]
        : {
            label: rawState,
            detail: 'This is the app state reported by the platform.',
            tone: 'var(--muted-foreground)',
          };
  const failed =
    latest &&
    deploymentPhase(latest.status) === 'failed' &&
    latest.status.toLowerCase() !== 'cancelled';
  const appError = ['error', 'failed', 'crashed'].includes(rawState.toLowerCase());
  const url = endpoint(app.url);
  const canOpen =
    url &&
    releasesReady &&
    releases.data?.some((release) => deploymentPhase(release.status) === 'live');
  const observed =
    metricsAccess === 'available' &&
    !metrics.isPending &&
    !metrics.error &&
    metrics.data?.source === 'prometheus'
      ? metrics.data
      : undefined;
  const hasTraffic = observed && measured(observed.request_count) && observed.request_count > 0;
  const requestErrors =
    hasTraffic && measured(observed.error_rate_pct) && observed.error_rate_pct > 0;
  const attention = Boolean(failed || appError || requestErrors);
  const source = latest ? (SOURCE_LABELS.get(latest.kind) ?? latest.kind) : '';

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section
        aria-label="App status"
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        <div className="flex flex-col items-start justify-between gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Circle
                aria-hidden
                className="h-3 w-3 shrink-0 fill-current"
                style={{ color: state.tone }}
              />
              App status
            </div>
            <h2 className="mt-2 text-2xl font-medium tracking-tight [overflow-wrap:anywhere]">
              {state.label}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {state.detail}
            </p>
          </div>
          {canOpen && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-brand/30 px-3 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Open app <OpenNewWindow aria-hidden className="h-4 w-4" />
            </a>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-4 border-t border-border px-5 py-4 text-xs sm:grid-cols-[1fr_1fr_2fr] sm:px-6">
          <div>
            <dt className="text-muted-foreground">Runtime</dt>
            <dd className="mt-1.5 font-medium">{app.runtime}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Memory</dt>
            <dd className="mt-1.5 font-medium">{app.memoryMb} MB</dd>
          </div>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <dt className="text-muted-foreground">Endpoint</dt>
            <dd className="mt-1.5 [overflow-wrap:anywhere]">
              {url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Not available'}
            </dd>
          </div>
        </dl>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section
          aria-label="Latest release"
          className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-medium">Latest release</h2>
            <Button size="xs" variant="ghost" onClick={() => onNavigate('Deployments')}>
              View history
            </Button>
          </div>
          {releases.isPending ? (
            <p role="status" className="mt-5 text-sm text-muted-foreground">
              Loading releases…
            </p>
          ) : (
            <>
              {!!releases.error && (
                <div className="mt-4 rounded-lg border border-border p-3 text-sm" role="status">
                  <p className="text-muted-foreground">
                    {latest
                      ? 'Last known release. History could not be refreshed.'
                      : 'Release history is unavailable.'}
                  </p>
                  <Button className="mt-2" variant="outline" size="xs" onClick={onRetryReleases}>
                    Retry releases
                  </Button>
                </div>
              )}
              {latest ? (
                <>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <ReleaseStatusLabel status={latest.status} />
                    <span className="text-xs text-muted-foreground">{source}</span>
                  </div>
                  <p className="mt-3 break-all font-mono text-sm">{latest.id}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Created <time dateTime={latest.created_at}>{timestamp(latest.created_at)}</time>
                  </p>
                  <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Image</dt>
                      <dd className="mt-1.5 break-all font-mono" title={latest.image_digest}>
                        {latest.image_digest
                          ? `${latest.image_digest.replace(/^sha256:/, '').slice(0, 12)}`
                          : 'Not built yet'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Environment scope</dt>
                      <dd className="mt-1.5 [overflow-wrap:anywhere]">
                        {latest.scope || 'default'}
                      </dd>
                    </div>
                  </dl>
                  <Button
                    className="mt-5"
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigate('Deployments', latest.id)}
                  >
                    View release
                  </Button>
                </>
              ) : (
                empty && (
                  <div className="mt-5">
                    <p className="text-sm">Your first release starts here.</p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Deploy from GitHub or upload an archive. Its progress and result will appear
                      here.
                    </p>
                    <Button className="mt-5" size="sm" onClick={onDeploy}>
                      Deploy your app
                    </Button>
                  </div>
                )
              )}
            </>
          )}
        </section>

        <section aria-label="Needs attention" className="min-w-0 px-1 py-2 xl:px-2">
          <h2 className="text-base font-medium">Needs attention</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            From app state, the latest release, and available traffic.
          </p>
          <div className="mt-4 divide-y divide-border">
            {failed && latest && (
              <div className="py-3 first:pt-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <WarningTriangle aria-hidden className="h-4 w-4 shrink-0 text-status-critical" />
                  Latest deployment failed
                </p>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {failureSummary({ deployment: latest }).cause}
                </p>
                <Button
                  className="mt-2"
                  size="xs"
                  variant="outline"
                  onClick={() => onNavigate('Deployments', latest.id)}
                >
                  Inspect failure
                </Button>
              </div>
            )}
            {appError && (
              <div className="py-3 first:pt-0">
                <p className="text-sm font-medium">The app reports an error</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Check runtime output for the reported failure.
                </p>
                <Button
                  className="mt-2"
                  size="xs"
                  variant="outline"
                  onClick={() => onNavigate('Logs')}
                >
                  Inspect logs
                </Button>
              </div>
            )}
            {requestErrors && (
              <div className="py-3 first:pt-0">
                <p className="text-sm font-medium">Requests returned errors</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {observed.error_rate_pct.toFixed(2)}% error rate in the {observed.range} window.
                  This does not identify the cause.
                </p>
                <Button
                  className="mt-2"
                  size="xs"
                  variant="outline"
                  onClick={() => onNavigate('Errors')}
                >
                  Inspect errors
                </Button>
              </div>
            )}
            {!attention && (
              <div className="flex items-start gap-3 py-2">
                <CheckCircle
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                />
                <div>
                  <p className="text-sm">
                    {releasesReady && latest
                      ? 'Nothing flagged in the available signals.'
                      : 'No confirmed issues to show yet.'}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {!observed
                      ? 'Request health is unconfirmed without metrics.'
                      : !hasTraffic
                        ? 'No traffic to assess in this window.'
                        : 'This is a summary of reported signals, not an uptime check.'}
                  </p>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onNavigate('Configuration')}
            className="mt-5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            View app configuration
          </button>
        </section>
      </div>

      <section
        aria-label="Traffic snapshot"
        className="rounded-xl border border-border bg-card p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-medium">
            Traffic{' '}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {observed?.range ?? '24h'}
            </span>
          </h2>
          {metricsAccess === 'available' && (
            <Button size="xs" variant="ghost" onClick={() => onNavigate('Metrics')}>
              View metrics
            </Button>
          )}
        </div>
        {metricsAccess === 'checking' || (metricsAccess === 'available' && metrics.isPending) ? (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            Loading traffic signals…
          </p>
        ) : metricsAccess === 'restricted' ? (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Request metrics are available on Hobby and above. Your app status and release history
            remain available here.
          </p>
        ) : !observed ? (
          <div className="mt-4" role="status">
            <p className="text-sm text-muted-foreground">
              Traffic metrics are unavailable. Missing data is not a zero error rate.
            </p>
            <Button className="mt-3" size="xs" variant="outline" onClick={onRetryMetrics}>
              Retry metrics
            </Button>
          </div>
        ) : (
          <>
            <dl className="mt-5 grid grid-cols-3 gap-3 sm:gap-5">
              <Signal
                label="Requests"
                value={
                  measured(observed.request_count)
                    ? formatCompact(observed.request_count)
                    : 'Unavailable'
                }
              />
              <Signal
                label="Error rate"
                value={
                  hasTraffic && measured(observed.error_rate_pct)
                    ? `${observed.error_rate_pct.toFixed(2)}%`
                    : '—'
                }
              />
              <Signal
                label="p95 response time"
                value={
                  hasTraffic && measured(observed.latency_p95_ms)
                    ? formatMs(observed.latency_p95_ms)
                    : '—'
                }
                note="Successful (2xx) responses"
              />
            </dl>
            <p className="mt-5 text-xs text-muted-foreground">
              {observed.request_count === 0
                ? 'No requests recorded in this window. Latency and error rate are not assessed.'
                : `As of ${timestamp(observed.as_of)}. App state and request health are separate signals.`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function Signal({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-xl font-medium tracking-tight [font-variant-numeric:tabular-nums] sm:text-2xl">
        {value}
      </dd>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
