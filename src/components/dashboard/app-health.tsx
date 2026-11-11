import {
  useEffect,
  useId,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react';
import { Link } from '@tanstack/react-router';
import {
  CheckCircle,
  HelpCircle,
  InfoCircle,
  NavArrowRight,
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
import { compactTime } from '@/lib/time';
import { answerFor, CHECK_NAMES, tilesFor, type Tile } from './app-health-copy';
import {
  BAND_LABEL,
  BAND_TERM,
  DAY_MS,
  healthBands,
  summarizeBands,
  type Band,
  type BandState,
} from './app-health-timeline';
import { CapabilityGate } from './capability-gate';
import { MaturityLabel } from './maturity-label';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { HelpTip } from './kit/help-tip';

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
 * Read top to bottom it follows docs/console-plain-english.md: the answer
 * (status word and one sentence), the checks as tiles, the last day as a
 * strip, and every recorded change behind a disclosure. Every figure is
 * the API's. An assessment is only good for its own `valid_for_seconds`;
 * past that the panel stops showing it rather than keep a cached "Healthy"
 * on screen, and a failed read wins over a cached answer (queryPhase puts
 * the error first).
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

/** Lifecycle phase, which apid keeps separate from confidence in health. */
const PHASES: Record<Assessment['phase'], string> = {
  serving: 'Serving',
  idle: 'Idle',
  starting: 'Starting',
  deploying: 'Deploying',
  stopped: 'Stopped',
  not_deployed: 'Not deployed',
  maintenance: 'Maintenance',
  unsupported: 'Not assessed',
  unknown: 'Phase unconfirmed',
};

/** Where apid says to look next (AppHealthCheck.action), as the app tab that answers it. */
const ACTIONS = {
  deployments: { tab: 'Deployments', label: 'Inspect release', verb: 'Open the release' },
  configuration: { tab: 'Runtime', label: 'Inspect configuration', verb: 'Open runtime settings' },
  logs: { tab: 'Logs', label: 'Inspect logs', verb: 'Open logs' },
  metrics: { tab: 'Metrics', label: 'Inspect metrics', verb: 'Open metrics' },
  errors: { tab: 'Errors', label: 'Inspect errors', verb: 'Open errors' },
} as const;

/** Diagonal stripes for "not checked": a texture, not a colour, so it never reads as a state. */
const hatch = (stripe: number) =>
  `repeating-linear-gradient(135deg, color-mix(in oklch, var(--muted-foreground) 30%, transparent) 0 ${stripe}px, color-mix(in oklch, var(--muted-foreground) 8%, transparent) ${stripe}px ${stripe * 2}px)`;

/** Band colours: brand for good, the status tokens for trouble, texture for neutral. */
const BAND_STYLE: Record<BandState, { background: string; className?: string }> = {
  healthy: { background: 'var(--status-good)' },
  degraded: { background: 'var(--status-warning)' },
  unhealthy: { background: 'var(--status-critical)' },
  unconfirmed: {
    background: 'color-mix(in oklch, var(--muted-foreground) 32%, transparent)',
  },
  unchecked: {
    background: hatch(5),
  },
  unrecorded: { background: 'transparent', className: 'border border-dashed border-border' },
};

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

/** Where a check's `action` points: the app tab, opened on the release it names. */
function actionTarget(slug: string, check: Check) {
  const action = check.action ? ACTIONS[check.action] : undefined;
  return {
    to: '/dashboard/apps/$appSlug' as const,
    params: { appSlug: slug },
    search: {
      tab: action?.tab,
      ...(action?.tab === 'Deployments' && check.deployment_id
        ? { deployment: check.deployment_id, releaseSection: 'overview' as const }
        : {}),
    },
    resetScroll: false,
  };
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

  return (
    <Panel
      title="Health"
      help={
        <>
          Observed serving health from checks Gregale already holds. Reading it never wakes or
          probes your app. It covers default-scope HTTP serving: worker and job execution are not
          assessed, and this is not a public reachability or uptime check.
        </>
      }
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
      <div className="flex flex-col gap-7">
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={health.error}
            loadingMessage="Reading health…"
            onRetry={() => void health.refetch()}
          />
        ) : (
          <>
            <Answer slug={slug} data={data} current={current} />
            {current && <Checks slug={slug} data={current} />}
          </>
        )}
        <Timeline history={history} now={now} />
      </div>
    </Panel>
  );
}

/** Rule 1: the status word, large, and one sentence that says whether anything needs doing. */
function Answer({
  slug,
  data,
  current,
}: {
  slug: string;
  data: Assessment;
  current: Assessment | undefined;
}) {
  const status = STATUS[current?.status ?? 'unknown'];
  const Glyph = status.icon;
  const answer = current ? answerFor(current, slug) : undefined;
  const verb = answer?.next?.action ? ACTIONS[answer.next.action].verb : undefined;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 items-start gap-4">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-full"
          style={{
            background: `color-mix(in oklch, ${status.color} 14%, transparent)`,
            color: status.color,
          }}
        >
          <Glyph className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p
            role="status"
            aria-label="Health status"
            aria-live="polite"
            className="text-2xl leading-8 font-bold tracking-[-0.02em]"
          >
            {status.label}
          </p>
          {answer ? (
            <p className="text-[15px] leading-6 text-foreground/75 [overflow-wrap:anywhere]">
              {answer.text}
            </p>
          ) : (
            <p className="text-[15px] leading-6 text-foreground/75">
              The last check expired{' '}
              <Timestamp value={Date.parse(data.evaluated_at) + data.valid_for_seconds * 1000} />,
              so health is unconfirmed until it is read again. It refreshes every 30 seconds while
              this page is open.
            </p>
          )}
          {(answer?.plans || (answer?.next && verb)) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {answer.plans && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/dashboard/plans">View plans</Link>
                </Button>
              )}
              {answer.next && verb && !answer.plans && (
                <Button asChild size="sm" variant="outline">
                  <Link {...actionTarget(slug, answer.next)}>{verb}</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="flex shrink-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground sm:pt-2 sm:whitespace-nowrap">
        {current && <span>{PHASES[current.phase]}</span>}
        {current && <span aria-hidden>·</span>}
        <span>
          Checked <Timestamp value={data.evaluated_at} />
        </span>
      </p>
    </div>
  );
}

/** Rule 4 applied to the checks: a value per tile, the API's wording in its tip. */
function Checks({ slug, data }: { slug: string; data: Assessment }) {
  const tiles = tilesFor(data);
  const readiness = data.checks.find((check) => check.code === 'readiness');
  return (
    <div className="flex flex-col gap-3">
      <ul
        aria-label="Health checks"
        className={`grid grid-cols-1 gap-3 ${tiles.length >= 3 ? 'md:grid-cols-3' : 'sm:grid-cols-2'} ${tiles.length >= 4 ? 'xl:grid-cols-4' : ''}`}
      >
        {tiles.map((tile) => (
          <CheckTile key={tile.key} slug={slug} tile={tile} data={data} />
        ))}
      </ul>
      {readiness && <Findings check={readiness} />}
    </div>
  );
}

function CheckTile({ slug, tile, data }: { slug: string; tile: Tile; data: Assessment }) {
  const mark = CHECK_STATUS[tile.status];
  const Glyph = mark.icon;
  const restricted = tile.checks.some((check) => check.reason === 'request_plan_restricted');
  const action = tile.link?.action ? ACTIONS[tile.link.action] : undefined;
  const requests = tile.key === 'requests' ? data.requests : undefined;
  return (
    <li
      aria-label={`${tile.label} check`}
      className="well flex min-w-0 flex-col gap-1.5 rounded-2xl bg-muted/40 px-4 py-3.5"
    >
      <span className="flex items-center gap-1">
        <span className="bento-label">{tile.label}</span>
        <HelpTip label={`About ${tile.label}`}>
          <span className="flex flex-col gap-2">
            {tile.checks.map((check) => (
              <span key={check.code}>
                <span className="text-foreground">
                  {CHECK_NAMES[check.code] ?? check.code} · {CHECK_STATUS[check.status].label}
                </span>
                <br />
                {check.detail}
              </span>
            ))}
            {requests && <Thresholds requests={requests} asOf={data.metrics_as_of} />}
          </span>
        </HelpTip>
      </span>
      <span className="flex items-center gap-2 text-xl leading-7 tabular-nums">
        <Glyph aria-hidden className="size-4 shrink-0" style={{ color: mark.color }} />
        <span className="sr-only">{mark.label}:</span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{tile.value}</span>
      </span>
      {(tile.note || restricted || action) && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
          {tile.note && <span>{tile.note}</span>}
          {tile.note && (restricted || action) && <span aria-hidden>·</span>}
          {restricted && (
            <Link to="/dashboard/plans" className="text-brand underline-offset-2 hover:underline">
              View plans
            </Link>
          )}
          {action && tile.link && !restricted && (
            <Link
              {...actionTarget(slug, tile.link)}
              className="text-brand underline-offset-2 hover:underline"
            >
              {action.label}
            </Link>
          )}
        </span>
      )}
    </li>
  );
}

function Thresholds({
  requests,
  asOf,
}: {
  requests: NonNullable<Assessment['requests']>;
  asOf?: string;
}) {
  return (
    <>
      {requests.known && (
        <span>
          Counted on{' '}
          {requests.deployment_ids.length === 1
            ? 'the serving release'
            : `${requests.deployment_ids.length} serving releases`}
          {asOf && (
            <>
              , as of <Timestamp value={asOf} />
            </>
          )}
          .
        </span>
      )}
      <span>
        Default thresholds, not your SLO: a warning at {requests.policy.warning_error_rate_pct}%
        server errors and a failure at {requests.policy.unhealthy_error_rate_pct}%, once there are
        at least {number(requests.policy.minimum_requests)} requests and{' '}
        {number(requests.policy.minimum_server_errors)} server errors.
      </span>
    </>
  );
}

/** What each copy reported, one click away from the Replicas tile's verdict. */
function Findings({ check }: { check: Check }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const findings = check.findings ?? [];
  if (findings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <Disclosure open={open} onToggle={() => setOpen(!open)} controls={id}>
        Show what each copy reported ({findings.length}
        {check.findings_truncated ? '+' : ''})
      </Disclosure>
      {open && (
        <div id={id} className="flex flex-col gap-2">
          <ul aria-label="Replica findings" className="flex flex-col gap-1.5">
            {findings.map((finding) => (
              <FindingRow
                key={`${finding.deployment_id}:${finding.instance_id}:${finding.source}:${finding.reason}`}
                finding={finding}
              />
            ))}
          </ul>
          {check.findings_truncated && (
            <p className="text-xs text-muted-foreground">
              More findings were left out; the replica counts still cover every copy checked.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const mark = CHECK_STATUS[finding.status];
  return (
    <li className="flex flex-col gap-0.5 well rounded-xl bg-muted/40 px-3 py-2 text-xs">
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

function Disclosure({
  open,
  onToggle,
  controls,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="pressable inline-flex items-center gap-2 self-start rounded text-sm text-foreground/75 hover:text-foreground"
    >
      <NavArrowRight
        aria-hidden
        className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
      />
      {children}
    </button>
  );
}

type HistoryRead = ReturnType<typeof useAppHealthHistory>;

/** Rule 5: the last day as colour bands, with every recorded change behind a disclosure. */
function Timeline({ history, now }: { history: HistoryRead; now: number }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const pages = history.data?.pages ?? [];
  const entries = pages.flatMap((page) => page.entries);
  const first = pages[0];
  // collector_fresh is the server's view when it answered; the latest
  // background assessment's own validity says whether it still holds.
  const fresh =
    first?.collector_fresh === true && (!first.latest || assessmentCurrent(first.latest, now));
  const phase = queryPhase({
    error: history.isFetchNextPageError ? null : history.error,
    loading: history.isPending,
    isEmpty: entries.length === 0,
  });

  // The strip needs a whole day; pages hold ten changes, so read older pages
  // until the oldest loaded change is past the window or history ends. The
  // API keeps at most a hundred, so this is bounded.
  const oldest = entries.at(-1);
  const oldestAt = oldest ? Date.parse(oldest.observed_at) : undefined;
  const needsOlder =
    oldestAt !== undefined &&
    oldestAt > now - DAY_MS &&
    history.hasNextPage &&
    !history.isFetchingNextPage &&
    !history.isFetchNextPageError;
  const { fetchNextPage } = history;
  useEffect(() => {
    if (needsOlder) void fetchNextPage();
  }, [needsOlder, fetchNextPage]);

  const latest = first?.latest ?? entries[0]?.assessment;
  const evidenceUntil = latest
    ? Date.parse(latest.evaluated_at) + latest.valid_for_seconds * 1000
    : undefined;
  const bands =
    phase === 'ready'
      ? healthBands({ entries, now, evidenceUntil, complete: !history.hasNextPage })
      : [];
  const summary = summarizeBands(bands);

  return (
    <section aria-labelledby={`${listId}-title`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={`${listId}-title`} className="flex items-center gap-1 text-base font-semibold">
          Last 24 hours
          <HelpTip label="About these times">
            Times show when health was assessed or its validity ended, not when an incident began or
            ended. Not checked means no assessment was collected; unconfirmed means one was, but it
            could not confirm health. Neither is an outage.
          </HelpTip>
        </h3>
        {phase === 'ready' && (
          <p className="text-sm text-foreground/75 tabular-nums">{summary.sentence}</p>
        )}
      </div>
      {first && !fresh && (
        <p className="text-xs" style={{ color: 'var(--status-warning)' }}>
          Background checks are running behind, so the newest change may be old. Its time is when it
          was observed.
        </p>
      )}
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={history.error}
          loadingMessage="Reading the last 24 hours…"
          emptyMessage="Nothing recorded yet. Recording starts with background checks; earlier history is not filled in."
          onRetry={() => void history.refetch()}
        />
      ) : (
        <>
          <Strip bands={bands} now={now} label={summary.ariaLabel} />
          <Legend states={bands.map((band) => band.state)} />
          <Disclosure open={open} onToggle={() => setOpen(!open)} controls={listId}>
            Show every change ({entries.length}
            {history.hasNextPage ? '+' : ''})
          </Disclosure>
          {open && <Changes id={listId} history={history} entries={entries} />}
        </>
      )}
    </section>
  );
}

function bandTitle(band: Band, now: number): string {
  const from = compactTime(band.start, { now });
  const to = band.end >= now ? 'now' : compactTime(band.end, { now });
  const term = BAND_TERM[band.state];
  return `${from} – ${to} · ${BAND_LABEL[band.state]}${term ? ` (${term})` : ''}`;
}

function Strip({ bands, now, label }: { bands: Band[]; now: number; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label={label} className="flex h-9 gap-[3px]">
        {bands.map((band, i) => {
          const style = BAND_STYLE[band.state];
          const first = i === 0;
          const last = i === bands.length - 1;
          return (
            <span
              key={band.start}
              title={bandTitle(band, now)}
              className={`min-w-[3px] ${style.className ?? ''} ${first ? 'rounded-l-lg' : 'rounded-l'} ${last ? 'rounded-r-lg' : 'rounded-r'}`}
              style={{ flex: `${band.end - band.start} 1 0`, background: style.background }}
            />
          );
        })}
      </div>
      <div aria-hidden className="flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>24 hours ago</span>
        <span>12 hours ago</span>
        <span>Now</span>
      </div>
    </div>
  );
}

const LEGEND_ORDER: BandState[] = [
  'healthy',
  'degraded',
  'unhealthy',
  'unconfirmed',
  'unchecked',
  'unrecorded',
];

/** Only the states the strip shows, plain word first and the API's term after. */
function Legend({ states }: { states: BandState[] }) {
  const shown = LEGEND_ORDER.filter((state) => states.includes(state));
  return (
    <ul
      aria-label="Legend"
      className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-foreground/75"
    >
      {shown.map((state) => {
        const style = BAND_STYLE[state];
        const term = BAND_TERM[state];
        return (
          <li key={state} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`size-2.5 rounded-[3px] ${style.className ?? ''}`}
              style={{ background: state === 'unchecked' ? hatch(2) : style.background }}
            />
            {BAND_LABEL[state]}
            {term && <span className="text-muted-foreground">({term})</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Changes({
  id,
  history,
  entries,
}: {
  id: string;
  history: HistoryRead;
  entries: components['schemas']['AppHealthHistoryEntry'][];
}) {
  const pruned =
    history.isFetchNextPageError &&
    history.error instanceof ApiError &&
    history.error.code === 'not_found';
  return (
    <section id={id} aria-label="Recorded changes" className="flex flex-col gap-2">
      <ul aria-label="Health history" className="divide-y divide-border text-sm">
        {entries.map((entry) => {
          const to = STATUS[entry.assessment.status];
          return (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="flex flex-wrap items-center gap-2">
                {entry.kind === 'gap' ? (
                  <StatusMark {...STATUS.unknown} label="Assessment expired" className="text-xs" />
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
    </section>
  );
}
