import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { Link } from '@tanstack/react-router';
import {
  CheckCircle,
  HelpCircle,
  InfoCircle,
  RefreshDouble,
  WarningTriangle,
  XmarkCircle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/errors';
import { useAppHealth, useAppHealthHistory } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import { CapabilityGate } from './capability-gate';
import { MaturityLabel } from './maturity-label';
import { InlinePhase, Panel, queryPhase } from './primitives';

/* ------------------------------------------------------------------ *
 * apid's observed health for one app (faas docs/app-health.md,
 * pkg/apid/apidserver/handlers_app_health.go). It is an evidence read:
 * apid never wakes, probes or tests a cold start to answer it, so it is
 * safe to show on every Overview visit, including a parked app's.
 *
 * Structural checks are on every plan; request telemetry follows the Hobby+
 * metrics entitlement, and on Free the requests check says so itself
 * (`request_plan_restricted`). Nothing here is plan-gated.
 *
 * Every figure is the API's. An assessment is only good for its own
 * `valid_for_seconds`; past that the panel stops showing it rather than
 * keep a cached "Healthy" on screen, and a failed read wins over a cached
 * answer (queryPhase puts the error first).
 * ------------------------------------------------------------------ */

type Assessment = components['schemas']['AppHealthResponse'];
type Check = components['schemas']['AppHealthCheck'];
type Finding = components['schemas']['AppHealthFinding'];
type HealthStatus = Assessment['status'];
type CheckStatus = Check['status'];
type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const CAPABILITY = 'app-health';

/** True while the API's own validity window still covers the assessment. */
export function assessmentCurrent(
  data: Pick<Assessment, 'evaluated_at' | 'valid_for_seconds'>,
  now: number
): boolean {
  const at = Date.parse(data.evaluated_at);
  if (!Number.isFinite(at) || !(data.valid_for_seconds > 0)) return false;
  return now - at <= data.valid_for_seconds * 1000;
}

const STATUS: Record<HealthStatus, { label: string; color: string; icon: Icon }> = {
  healthy: { label: 'Healthy', color: 'var(--status-good)', icon: CheckCircle },
  degraded: { label: 'Degraded', color: 'var(--status-warning)', icon: WarningTriangle },
  unhealthy: { label: 'Unhealthy', color: 'var(--status-critical)', icon: XmarkCircle },
  unknown: { label: 'Unconfirmed', color: 'var(--muted-foreground)', icon: HelpCircle },
};

const CHECK_STATUS: Record<CheckStatus, { label: string; color: string; icon: Icon }> = {
  pass: { label: 'Pass', color: 'var(--status-good)', icon: CheckCircle },
  warning: { label: 'Warning', color: 'var(--status-warning)', icon: WarningTriangle },
  fail: { label: 'Fail', color: 'var(--status-critical)', icon: XmarkCircle },
  unknown: { label: 'Unconfirmed', color: 'var(--muted-foreground)', icon: HelpCircle },
  not_applicable: { label: 'Info', color: 'var(--muted-foreground)', icon: InfoCircle },
};

/** apid's closed set of check codes (AppHealthCheck.code), in words. */
const CHECK_NAMES: Record<Check['code'], string> = {
  workload: 'Workload',
  queue: 'Queue',
  memory: 'Memory',
  replicas: 'Replicas',
  backlog: 'Backlog',
  dead_letters: 'Failed messages',
  deployment: 'Serving release',
  latest_deployment: 'Latest release',
  readiness: 'Readiness',
  traffic_readiness: 'Traffic readiness',
  maintenance: 'Maintenance',
  requests: 'Requests',
  collection: 'Evidence collection',
};

/** Lifecycle phase, which apid keeps separate from confidence in health. */
const PHASES: Record<Assessment['phase'], { label: string; note?: string }> = {
  serving: { label: 'Serving' },
  idle: {
    label: 'Idle',
    note: 'Idle is a lifecycle phase, not a health verdict: scaling to zero is expected when no warm replicas are required.',
  },
  starting: { label: 'Starting' },
  deploying: { label: 'Deploying' },
  stopped: { label: 'Stopped' },
  not_deployed: { label: 'Not deployed' },
  maintenance: { label: 'Maintenance' },
  unsupported: {
    label: 'Not assessed',
    note: 'Only HTTP request and service workloads are assessed; worker and job execution is not.',
  },
  unknown: { label: 'Phase unconfirmed' },
};

/** Where apid says to look next (AppHealthCheck.action), as the app tab that answers it. */
const ACTIONS = {
  deployments: { tab: 'Deployments', label: 'Inspect release' },
  configuration: { tab: 'Runtime', label: 'Inspect configuration' },
  logs: { tab: 'Logs', label: 'Inspect logs' },
  metrics: { tab: 'Metrics', label: 'Inspect metrics' },
  errors: { tab: 'Errors', label: 'Inspect errors' },
} as const;

/** AppHealthFinding.source: node, configuration, primary_app, or sidecar:<name>. */
function sourceLabel(source: string): string {
  if (source === 'primary_app') return 'Primary app';
  if (source === 'node') return 'Node';
  if (source === 'configuration') return 'Configuration';
  if (source.startsWith('sidecar:')) return `Companion ${source.slice('sidecar:'.length)}`;
  return source;
}

function StatusMark({
  label,
  color,
  icon: Glyph,
  className = 'text-sm',
}: {
  label: string;
  color: string;
  icon: Icon;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${className}`} style={{ color }}>
      <Glyph aria-hidden className="h-4 w-4 shrink-0" />
      {label}
    </span>
  );
}

/** A clock that ticks, so an assessment expires on screen without a refetch. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const number = (value: number) => value.toLocaleString('en-US');

/** Replica counts, only when apid measured them (`capacity.known`). */
function capacityLine(capacity: Assessment['capacity']): string {
  if (!capacity.known) return 'Replica readiness unconfirmed';
  const parts = [
    capacity.starting > 0 && `${capacity.starting} starting`,
    capacity.unready > 0 && `${capacity.unready} not ready`,
    capacity.unknown > 0 && `${capacity.unknown} unconfirmed`,
  ].filter(Boolean);
  if (capacity.required === 0 && capacity.ready === 0 && parts.length === 0)
    return 'No warm replicas required';
  return [`${capacity.ready} of ${capacity.required} required replicas ready`, ...parts].join(
    ' · '
  );
}

/** The Overview's health panel; reads nothing until `app-health` is released to the account. */
export function AppHealthPanel({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability={CAPABILITY} title="Health">
      <HealthBody slug={slug} />
    </CapabilityGate>
  );
}

function HealthBody({ slug }: { slug: string }) {
  const { capability } = useCapabilityAccess(CAPABILITY);
  const health = useAppHealth(slug);
  const history = useAppHealthHistory(slug);
  const now = useNow(5_000);
  const phase = queryPhase({ error: health.error, loading: health.isPending });
  const data = phase === 'ready' ? health.data : undefined;
  const current = data && assessmentCurrent(data, now) ? data : undefined;
  const status = STATUS[current?.status ?? 'unknown'];

  return (
    <Panel
      title="Health"
      help="Observed serving health from checks Gregale already holds. Reading it never wakes or probes your app."
      actions={
        <div className="flex items-center gap-2">
          <MaturityLabel capability={capability} />
          <Button
            size="xs"
            variant="ghost"
            aria-label="Refresh health"
            disabled={health.isFetching}
            onClick={() => {
              void health.refetch();
              void history.refetch();
            }}
          >
            <RefreshDouble
              aria-hidden
              className={`h-3.5 w-3.5 ${health.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`}
            />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={health.error}
            loadingMessage="Reading health…"
            onRetry={() => void health.refetch()}
          />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span role="status" aria-label="Health status" aria-live="polite">
                  <StatusMark {...status} className="text-base" />
                </span>
                {current && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {PHASES[current.phase].label}
                  </span>
                )}
              </div>
              {current ? (
                <>
                  <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {current.summary}
                  </p>
                  {PHASES[current.phase].note && (
                    <p className="text-xs text-muted-foreground">{PHASES[current.phase].note}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The last assessment expired{' '}
                  <Timestamp
                    value={Date.parse(data.evaluated_at) + data.valid_for_seconds * 1000}
                  />
                  , so health is unconfirmed until it is read again. It refreshes every 30 seconds
                  while this page is open.
                </p>
              )}
            </div>
            {current && <Evidence slug={slug} data={current} />}
          </>
        )}
        <History history={history} now={now} />
        <p className="text-xs text-muted-foreground">
          Covers default-scope HTTP serving. Worker and job execution are not assessed, and this is
          not a public reachability or uptime check.
        </p>
      </div>
    </Panel>
  );
}

function Evidence({ slug, data }: { slug: string; data: Assessment }) {
  const { capacity, requests } = data;
  return (
    <>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Assessed <Timestamp value={data.evaluated_at} />
        </span>
        <span>{capacityLine(capacity)}</span>
      </p>
      {requests && (
        <div className="text-xs text-muted-foreground">
          {requests.known ? (
            <p>
              <span className="text-foreground">
                {number(requests.request_count)} requests · {number(requests.server_errors)} server
                errors ({requests.error_rate_pct.toFixed(2)}%)
              </span>{' '}
              over the last {Math.round(requests.window_seconds / 60)} minutes on{' '}
              {requests.deployment_ids.length === 1
                ? 'the serving release'
                : `${requests.deployment_ids.length} serving releases`}
              {data.metrics_as_of && (
                <>
                  , as of <Timestamp value={data.metrics_as_of} />
                </>
              )}
              .
            </p>
          ) : (
            <p>Request counts unconfirmed: missing data does not mean a zero error rate.</p>
          )}
          <p className="mt-1">
            Diagnostic defaults, not your SLO: a warning at {requests.policy.warning_error_rate_pct}
            % server errors and a failure at {requests.policy.unhealthy_error_rate_pct}%, once there
            are at least {number(requests.policy.minimum_requests)} requests and{' '}
            {number(requests.policy.minimum_server_errors)} server errors.
          </p>
        </div>
      )}
      <ul aria-label="Health checks" className="flex flex-col divide-y divide-border">
        {data.checks.map((check) => (
          <CheckRow key={check.code} slug={slug} check={check} />
        ))}
      </ul>
    </>
  );
}

function CheckRow({ slug, check }: { slug: string; check: Check }) {
  const name = CHECK_NAMES[check.code] ?? check.code.replace(/_/g, ' ');
  const action = check.action ? ACTIONS[check.action] : undefined;
  return (
    <li aria-label={`${name} check`} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{name}</span>
        <StatusMark {...CHECK_STATUS[check.status]} className="text-xs" />
      </div>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{check.detail}</p>
      {check.findings && check.findings.length > 0 && (
        <ul aria-label={`${name} findings`} className="flex flex-col gap-1.5 pl-1">
          {check.findings.map((finding) => (
            <FindingRow
              key={`${finding.deployment_id}:${finding.instance_id}:${finding.source}:${finding.reason}`}
              finding={finding}
            />
          ))}
        </ul>
      )}
      {check.findings_truncated && (
        <p className="text-xs text-muted-foreground">
          More findings were left out; the replica counts still cover every scanned instance.
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {check.reason === 'request_plan_restricted' && (
          <Link to="/dashboard/plans" className="text-brand underline-offset-2 hover:underline">
            View plans
          </Link>
        )}
        {action && (
          <Link
            to="/dashboard/apps/$appSlug"
            params={{ appSlug: slug }}
            search={{
              tab: action.tab,
              ...(action.tab === 'Deployments' && check.deployment_id
                ? { deployment: check.deployment_id, releaseSection: 'overview' as const }
                : {}),
            }}
            resetScroll={false}
            className="text-brand underline-offset-2 hover:underline"
          >
            {action.label}
          </Link>
        )}
      </div>
    </li>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const mark = CHECK_STATUS[finding.status];
  return (
    <li className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2 text-xs">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusMark {...mark} className="text-xs" />
        <span className="text-muted-foreground">{sourceLabel(finding.source)}</span>
        <CopyableId value={finding.instance_id} label="instance ID" />
      </span>
      <span className="[overflow-wrap:anywhere]">{finding.detail}</span>
      <span className="text-muted-foreground">
        Release <CopyableId value={finding.deployment_id} label="release ID" />
        {finding.observed_at ? (
          <>
            {' · '}
            {finding.source === 'node' ? 'last heartbeat' : 'recorded'}{' '}
            <Timestamp value={finding.observed_at} />
          </>
        ) : (
          ' · no observation recorded'
        )}
      </span>
    </li>
  );
}

type HistoryRead = ReturnType<typeof useAppHealthHistory>;

function History({ history, now }: { history: HistoryRead; now: number }) {
  const pages = history.data?.pages ?? [];
  const entries = pages.flatMap((page) => page.entries);
  const first = pages[0];
  // collector_fresh is the server's view when it answered; the latest
  // background assessment's own validity says whether it still holds.
  const fresh =
    first?.collector_fresh === true && (!first.latest || assessmentCurrent(first.latest, now));
  const pruned =
    history.isFetchNextPageError &&
    history.error instanceof ApiError &&
    history.error.code === 'not_found';
  const phase = queryPhase({
    error: history.isFetchNextPageError ? null : history.error,
    loading: history.isPending,
    isEmpty: entries.length === 0,
  });
  return (
    <section aria-label="Recorded changes" className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">Recorded changes</h3>
      {first && !fresh && (
        <p className="text-xs" style={{ color: 'var(--status-warning)' }}>
          Background collection is behind, so the newest entry may be old. Its time is when it was
          observed.
        </p>
      )}
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={history.error}
          loadingMessage="Reading recorded changes…"
          emptyMessage="No changes recorded yet. Recording starts with background collection; older incidents are not backfilled."
          onRetry={() => void history.refetch()}
        />
      ) : (
        <ul aria-label="Health history" className="divide-y divide-border text-sm">
          {entries.map((entry) => {
            const to = STATUS[entry.assessment.status];
            return (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 py-1.5"
              >
                <span className="flex flex-wrap items-center gap-2">
                  {entry.kind === 'gap' ? (
                    <StatusMark
                      {...STATUS.unknown}
                      label="Assessment expired"
                      className="text-xs"
                    />
                  ) : entry.kind === 'baseline' ? (
                    <>
                      <span className="text-xs text-muted-foreground">First assessment</span>
                      <StatusMark {...to} className="text-xs" />
                    </>
                  ) : (
                    <>
                      {entry.previous_status && (
                        <>
                          <StatusMark {...STATUS[entry.previous_status]} className="text-xs" />
                          <span className="text-xs text-muted-foreground"> → </span>
                        </>
                      )}
                      <StatusMark {...to} className="text-xs" />
                    </>
                  )}
                </span>
                <Timestamp
                  value={entry.observed_at}
                  mode="absolute"
                  className="text-xs text-muted-foreground"
                />
              </li>
            );
          })}
        </ul>
      )}
      {pruned ? (
        <p
          role="status"
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          Older entries are no longer retained.
          <Button size="xs" variant="ghost" onClick={() => void history.refetch()}>
            Reload newest
          </Button>
        </p>
      ) : history.isFetchNextPageError ? (
        <InlinePhase
          phase={queryPhase({ error: history.error })}
          error={history.error}
          onRetry={() => void history.fetchNextPage()}
        />
      ) : (
        history.hasNextPage && (
          <Button
            className="self-start"
            size="xs"
            variant="ghost"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Show older changes
          </Button>
        )
      )}
      <p className="text-xs text-muted-foreground">
        Times show when health was assessed or its validity ended, not when an incident began or
        ended.
      </p>
    </section>
  );
}
