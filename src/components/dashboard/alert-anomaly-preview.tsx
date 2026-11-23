import { Link } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Timestamp } from '@/components/ui/timestamp';
import { useAlertAnomalyPreview, type AlertAnomalyPreviewQuery } from '@/lib/api/alert-rules';
import type { components } from '@/lib/api/schema';
import { formatDuration } from '@/lib/invocation-options';
import { formatNumber } from '@/lib/mock-data';
import { baselineRange } from './alert-metrics';
import { AlertIncidentList } from './alert-observation';
import { InlinePhase, queryPhase } from './primitives';

type PreviewResult = components['schemas']['AlertAnomalyPreviewResponse'];
type PreviewMetric = NonNullable<AlertAnomalyPreviewQuery['metric']>;
type Breach = components['schemas']['AlertAnomalyPreviewBreach'];
type SkippedWindow = components['schemas']['AlertAnomalyPreviewSkippedWindow'];
type WeekdayBaseline = components['schemas']['AlertAnomalyWeekdayPreview'];
type ZeroBaselineFallback = components['schemas']['AlertAnomalyZeroBaselineFallback'];
type ObservedIncident = components['schemas']['AlertObservedIncident'];
type DeploymentContext = components['schemas']['AlertAnomalyDeploymentContext'];
type DeploymentPromotion = components['schemas']['AlertAnomalyDeploymentPromotion'];
type ReplayIncidentLists = Pick<
  components['schemas']['AlertAnomalyIncidentReplay'],
  'incidents' | 'candidate_incidents'
>;

const SKIP_LABEL: Record<SkippedWindow['reason'], string> = {
  telemetry_missing_or_stale: 'Missing or stale request data',
  insufficient_history: 'Insufficient baseline history',
  insufficient_traffic: 'Insufficient traffic',
};

const PREVIEW_METRIC_DISPLAY: Record<
  PreviewMetric,
  { observed: string; suffix: string; requests?: string }
> = {
  request_count: { observed: 'Observed requests', suffix: '' },
  error_rate_pct: { observed: 'Observed error rate', suffix: '%', requests: 'Eligible requests' },
  latency_p95_ms: {
    observed: 'Observed p95 latency',
    suffix: ' ms',
    requests: 'Successful requests',
  },
};

export function AlertAnomalyPreview({
  slug,
  query,
  cooldownMinutes,
  recoveryConfirmationChecks = 1,
  ruleEnvironment,
  onUseEnvironment,
}: {
  slug: string;
  query: AlertAnomalyPreviewQuery;
  cooldownMinutes: number | undefined;
  recoveryConfirmationChecks?: 1 | 2;
  ruleEnvironment?: string;
  onUseEnvironment?: (scope: string) => void;
}) {
  const [candidate, setCandidate] = useState('');
  const [compareWeekday, setCompareWeekday] = useState(false);
  const [compareFallback, setCompareFallback] = useState(false);
  const candidateErrorId = useId();
  const metric = query.metric ?? 'request_count';
  const errorRate = metric === 'error_rate_pct';
  const supportsWeekday =
    metric === 'request_count' && (query.window_spec === '5m' || query.window_spec === '15m');
  const useWeekday = supportsWeekday && compareWeekday;
  const useFallback = errorRate && compareFallback;
  const candidateBaseline = useWeekday
    ? 'same_weekday'
    : useFallback
      ? 'zero_baseline_fallback'
      : undefined;
  const candidateValue = !candidateBaseline && candidate.trim() ? Number(candidate) : undefined;
  const range = baselineRange(query.comparison);
  const candidateError =
    candidateValue !== undefined &&
    range &&
    (!Number.isFinite(candidateValue) || candidateValue < range.min || candidateValue > range.max)
      ? `Enter a multiplier between ${range.min} and ${range.max}.`
      : undefined;
  const previewQuery: AlertAnomalyPreviewQuery = candidateBaseline
    ? { ...query, candidate_baseline: candidateBaseline }
    : candidateValue !== undefined && !candidateError
      ? { ...query, candidate_threshold: candidateValue }
      : query;
  const preview = useAlertAnomalyPreview(slug, previewQuery);
  const result = candidateError || preview.isFetching || preview.isError ? undefined : preview.data;
  const weekdayBaseline = result?.candidate?.weekday_baseline;
  const fallback = result?.candidate?.zero_baseline_fallback;
  const direction = query.comparison === 'below_baseline' ? 'or lower' : 'or higher';
  const canTest = !candidateError && !preview.isFetching;

  return (
    <section aria-label="Recent traffic preview" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Candidate multiplier (optional)
          <input
            className={`${FIELD} w-40 tabular-nums`}
            inputMode="decimal"
            value={candidate}
            disabled={Boolean(candidateBaseline)}
            onChange={(event) => setCandidate(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canTest) void preview.refetch();
              }
            }}
            {...fieldErrorProps(candidateError, candidateErrorId)}
          />
        </label>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="h-8"
          disabled={!canTest}
          onClick={() => void preview.refetch()}
        >
          Test on recent traffic
        </Button>
      </div>
      {candidateError && <FieldError id={candidateErrorId}>{candidateError}</FieldError>}
      {supportsWeekday && (
        <label className="flex items-center gap-2 self-start text-xs">
          <input
            type="checkbox"
            checked={useWeekday}
            onChange={(event) => setCompareWeekday(event.target.checked)}
          />
          Compare same-weekday baseline
        </label>
      )}
      {useWeekday && (
        <p className="text-xs text-muted-foreground">
          Both baselines use the rule multiplier. The candidate uses the same weekday and UTC time
          in each of the previous three weeks.
        </p>
      )}
      {errorRate && (
        <label className="flex items-center gap-2 self-start text-xs">
          <input
            type="checkbox"
            checked={useFallback}
            onChange={(event) => setCompareFallback(event.target.checked)}
          />
          Compare zero-baseline fallback
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        The weekly preview checks traffic across all environments once an hour. Short breaches may
        fall between checks.
      </p>
      {!candidateError && preview.isFetching && (
        <InlinePhase phase="loading" loadingMessage="Checking recent traffic…" />
      )}
      {!candidateError && !preview.isFetching && preview.isError && (
        <InlinePhase phase={queryPhase({ error: preview.error })} error={preview.error} />
      )}
      {result && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Checked from <Timestamp value={result.first_check_at} mode="absolute" /> to{' '}
            <Timestamp value={result.last_check_at} mode="absolute" />.
          </p>
          <dl aria-live="polite" className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">
                {weekdayBaseline ? 'Seven-day median checks' : 'Evaluated windows'}
              </dt>
              <dd>
                {result.evaluated} of {result.evaluated + result.skipped}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {weekdayBaseline
                  ? 'Seven-day median breaches'
                  : `Selected (${query.threshold}×) breaches`}
              </dt>
              <dd>{result.breaches.length}</dd>
            </div>
            {result.candidate && (
              <div>
                <dt className="text-xs text-muted-foreground">
                  {weekdayBaseline
                    ? 'Same-weekday median breaches'
                    : fallback
                      ? 'Fallback candidate breaches'
                      : `Candidate (${result.candidate.threshold}×) breaches`}
                </dt>
                <dd>{result.candidate.breaches.length}</dd>
              </div>
            )}
          </dl>
          {result.skipped_windows.length > 0 && (
            <SkippedWindows windows={result.skipped_windows} metric={metric} />
          )}
          {weekdayBaseline && <WeekdayCoverage baseline={weekdayBaseline} />}
          {fallback && (
            <p className="text-xs text-muted-foreground">
              With a qualified 0% baseline, the fallback requires at least{' '}
              {formatNumber(fallback.minimum_error_rate_pct)}% errors and{' '}
              {formatNumber(fallback.minimum_failed_requests)} failed requests.
            </p>
          )}
          {result.evaluated === 0 && (
            <p className="text-sm text-muted-foreground">
              {weekdayBaseline
                ? 'The seven-day median had no windows with enough request data or history.'
                : 'No windows had enough request data or history.'}
            </p>
          )}
          {(result.breaches.length > 0 || Boolean(result.candidate?.breaches.length)) && (
            <BreachTable result={result} direction={direction} metric={metric} />
          )}
          <IncidentReplay
            key={result.last_check_at}
            slug={slug}
            query={previewQuery}
            environments={result.environment_scopes}
            ruleEnvironment={ruleEnvironment}
            onUseEnvironment={onUseEnvironment}
            earliest={Date.parse(result.first_check_at)}
            latest={Date.parse(result.last_check_at) - INCIDENT_REPLAY_DURATION}
            cooldownMinutes={cooldownMinutes}
            recoveryConfirmationChecks={recoveryConfirmationChecks}
          />
        </div>
      )}
    </section>
  );
}

const INCIDENT_REPLAY_DURATION = 2 * 60 * 60 * 1000;

function localMinuteValue(ms: number) {
  const offset = new Date(ms).getTimezoneOffset() * 60_000;
  return new Date(ms - offset).toISOString().slice(0, 16);
}

function IncidentReplay({
  slug,
  query,
  environments,
  ruleEnvironment,
  onUseEnvironment,
  earliest,
  latest,
  cooldownMinutes,
  recoveryConfirmationChecks,
}: {
  slug: string;
  query: AlertAnomalyPreviewQuery;
  environments?: string[];
  ruleEnvironment?: string;
  onUseEnvironment?: (scope: string) => void;
  earliest: number;
  latest: number;
  cooldownMinutes: number | undefined;
  recoveryConfirmationChecks: 1 | 2;
}) {
  const [draftStart, setDraftStart] = useState<string>();
  const [recoveryComparison, setCompareRecovery] = useState<boolean>();
  const compareRecovery = recoveryComparison ?? recoveryConfirmationChecks === 2;
  const [environment, setEnvironment] = useState(
    ruleEnvironment && environments?.includes(ruleEnvironment) ? ruleEnvironment : ''
  );
  const startErrorId = useId();
  const start = draftStart === undefined ? latest : Date.parse(draftStart);
  const startError =
    Number.isFinite(start) && start % 60_000 === 0 && start >= earliest && start <= latest
      ? undefined
      : 'Choose a start minute that leaves two hours within the weekly preview.';
  const ready = !startError && cooldownMinutes !== undefined;
  const detail = useAlertAnomalyPreview(slug, {
    ...query,
    incident_replay_start: ready ? new Date(start).toISOString() : undefined,
    cooldown_minutes: cooldownMinutes,
    ...(environment ? { environment_scope: environment } : {}),
    ...(compareRecovery ? { recovery_confirmation_checks: 2 as const } : {}),
  });
  const data = ready && !detail.isFetching && !detail.isError ? detail.data : undefined;
  const wrongEnvironment = Boolean(data && environment && data.environment_scope !== environment);
  const result = wrongEnvironment ? undefined : data;
  const replay = result?.incident_replay;
  const confirmation = replay?.recovery_confirmation;
  const metric = query.metric ?? 'request_count';
  const weekdayBaseline = result?.candidate?.weekday_baseline;
  const openingContext = (openedAt: string) => {
    const time = Date.parse(openedAt);
    const promotion = replay?.deployment_context?.promotions.find(
      (entry) => Date.parse(entry.promoted_at) < time
    );
    if (!promotion) return null;
    const minutes = Math.floor((time - Date.parse(promotion.promoted_at)) / 60_000);
    const elapsed = minutes === 0 ? 'Less than a minute' : formatDuration(minutes * 60);
    return (
      <span className="text-muted-foreground">
        <span>{elapsed} after promotion</span> of <ReplayDeploymentLink promotion={promotion} />
      </span>
    );
  };

  return (
    <section
      aria-label="Two-hour incident replay"
      className="mt-2 flex flex-col gap-2 border-t border-border pt-3"
    >
      <h4 className="text-sm font-medium">Two-hour incident replay</h4>
      <div className="flex flex-wrap items-end gap-2">
        {environments && environments.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Replay environment
            <select
              className={FIELD}
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
            >
              <option value="">All environments</option>
              {environments.map((scope) => (
                <option key={scope} value={scope}>
                  {scope === 'default' ? 'Default' : scope}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Replay start (local time)
          <Input
            className="w-auto"
            type="datetime-local"
            min={localMinuteValue(earliest)}
            max={localMinuteValue(latest)}
            value={draftStart ?? localMinuteValue(latest)}
            onChange={(event) => setDraftStart(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (ready && !detail.isFetching) void detail.refetch();
              }
            }}
            {...fieldErrorProps(startError, startErrorId)}
          />
        </label>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="h-8"
          disabled={!ready || detail.isFetching}
          onClick={() => void detail.refetch()}
        >
          Replay two hours
        </Button>
        {onUseEnvironment && environment && environment !== ruleEnvironment && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-8"
            onClick={() => onUseEnvironment(environment)}
          >
            Use environment for Observe only
          </Button>
        )}
      </div>
      <label className="flex items-center gap-2 self-start text-xs">
        <input
          type="checkbox"
          checked={compareRecovery}
          onChange={(event) => setCompareRecovery(event.target.checked)}
        />
        Compare two-check recovery
      </label>
      {compareRecovery && (
        <p className="text-xs text-muted-foreground">
          A skipped check clears the confirmation streak and keeps the incident open.
        </p>
      )}
      {startError && <FieldError id={startErrorId}>{startError}</FieldError>}
      {cooldownMinutes === undefined && (
        <p className="text-xs text-muted-foreground">
          Set a valid rule cooldown to replay incidents.
        </p>
      )}
      {ready && detail.isFetching && (
        <InlinePhase phase="loading" loadingMessage="Replaying minute checks…" />
      )}
      {ready && !detail.isFetching && detail.isError && (
        <InlinePhase phase={queryPhase({ error: detail.error })} error={detail.error} />
      )}
      {wrongEnvironment && (
        <p className="text-xs text-muted-foreground">Replay for this environment is unavailable.</p>
      )}
      {result && replay && (
        <div aria-label="Incident replay results" role="region" className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Checked from <Timestamp value={result.first_check_at} mode="absolute" /> to{' '}
            <Timestamp value={result.last_check_at} mode="absolute" />.
          </p>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {result.evaluated} of {result.evaluated + result.skipped} minute checks evaluated. The
            replay shows which notifications would be eligible with a {replay.cooldown_minutes}
            -minute cooldown.
          </p>
          {result.environment_scope &&
            result.evaluated === 0 &&
            result.skipped_windows.some((check) => check.reason === 'insufficient_history') && (
              <p className="text-xs text-muted-foreground">
                Insufficient history for this environment.
              </p>
            )}
          {result.skipped_windows.length > 0 && (
            <SkippedWindows windows={result.skipped_windows} metric={metric} />
          )}
          {weekdayBaseline && <WeekdayCoverage baseline={weekdayBaseline} />}
          {metric !== 'request_count' &&
            (result.breaches.length > 0 || Boolean(result.candidate?.breaches.length)) && (
              <BreachTable result={result} direction="or higher" metric={metric} />
            )}
          <ReplayDeploymentPromotions
            history={replay.deployment_context}
            start={result.first_check_at}
            appWide={!result.environment_scope}
          />
          {confirmation ? (
            <div className="grid gap-4 md:grid-cols-2">
              <section aria-label="One healthy check to recover">
                <h5 className="mb-2 text-sm font-medium">One healthy check to recover</h5>
                <ReplayIncidentGroup
                  lists={replay}
                  result={result}
                  threshold={query.threshold}
                  openingContext={openingContext}
                  grouped
                />
              </section>
              <section aria-label="Two healthy checks to recover">
                <h5 className="mb-2 text-sm font-medium">Two healthy checks to recover</h5>
                <ReplayIncidentGroup
                  lists={confirmation}
                  result={result}
                  threshold={query.threshold}
                  openingContext={openingContext}
                  grouped
                />
              </section>
            </div>
          ) : (
            <ReplayIncidentGroup
              lists={replay}
              result={result}
              threshold={query.threshold}
              openingContext={openingContext}
            />
          )}
        </div>
      )}
    </section>
  );
}

function ReplayDeploymentPromotions({
  history,
  start,
  appWide,
}: {
  history?: DeploymentContext;
  start: string;
  appWide: boolean;
}) {
  if (!history) {
    return <p className="text-xs text-muted-foreground">Deployment history unavailable.</p>;
  }
  const startTime = Date.parse(start);
  const inWindow = history.promotions.filter(
    (promotion) => Date.parse(promotion.promoted_at) >= startTime
  );
  return (
    <section aria-label="Deployment promotions" className="flex flex-col gap-1">
      <h5 className="text-xs font-medium">Deployment promotions</h5>
      <p className="text-xs text-muted-foreground">
        Recorded promotions to 100% traffic in the {history.scope} environment.
        {appWide ? ' Replay metrics cover the app.' : ''}
      </p>
      {history.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the latest 100 promotions. Earlier incident checks may lack deployment context.
        </p>
      )}
      {inWindow.length === 0 ? (
        <p className="text-xs text-muted-foreground">No recorded promotions in this window.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border text-xs">
          {inWindow.map((promotion) => (
            <li key={promotion.deployment_id} className="flex flex-wrap gap-x-2 py-1">
              <Timestamp value={promotion.promoted_at} mode="absolute" />
              <ReplayDeploymentLink promotion={promotion} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReplayDeploymentLink({ promotion }: { promotion: DeploymentPromotion }) {
  return (
    <Link
      to="/dashboard/releases"
      search={{ deployment: promotion.deployment_id }}
      className="text-foreground underline underline-offset-2"
    >
      Deployment {promotion.deployment_id.slice(0, 8)}
      {promotion.commit_sha && (
        <>
          {' '}
          · <code title={promotion.commit_sha}>{promotion.commit_sha.slice(0, 7)}</code>
        </>
      )}
    </Link>
  );
}

function ReplayIncidentGroup({
  lists,
  result,
  threshold,
  openingContext,
  grouped = false,
}: {
  lists: ReplayIncidentLists;
  result: PreviewResult;
  threshold: number;
  openingContext: (openedAt: string) => ReactNode;
  grouped?: boolean;
}) {
  const weekday = result.candidate?.weekday_baseline;
  const fallback = result.candidate?.zero_baseline_fallback;
  return (
    <div className={grouped ? 'grid gap-3' : 'grid gap-3 md:grid-cols-2'}>
      <ReplayIncidentList
        label={weekday ? 'Seven-day incidents' : 'Selected incidents'}
        title={weekday ? 'Seven-day median' : `Selected (${threshold}×)`}
        incidents={lists.incidents}
        start={result.first_check_at}
        grouped={grouped}
        openingThresholds={fallback && replayOpeningThresholds(result.breaches, fallback)}
        openingContext={openingContext}
      />
      {result.candidate && (
        <ReplayIncidentList
          label={weekday ? 'Same-weekday incidents' : 'Candidate incidents'}
          title={
            weekday
              ? 'Same-weekday median'
              : fallback
                ? 'Candidate with fallback'
                : `Candidate (${result.candidate.threshold}×)`
          }
          incidents={lists.candidate_incidents ?? []}
          start={result.first_check_at}
          grouped={grouped}
          openingContext={openingContext}
          openingThresholds={
            fallback && replayOpeningThresholds(result.candidate.breaches, fallback)
          }
        />
      )}
    </div>
  );
}

function ReplayIncidentList({
  label,
  title,
  incidents,
  start,
  grouped,
  openingThresholds,
  openingContext,
}: {
  label: string;
  title: string;
  incidents: ObservedIncident[];
  start: string;
  grouped: boolean;
  openingThresholds?: ReadonlyMap<string, string>;
  openingContext: (openedAt: string) => ReactNode;
}) {
  const Heading = grouped ? 'h6' : 'h5';
  const eligible = incidents.reduce(
    (count, incident) => count + incident.eligible_notifications,
    0
  );
  return (
    <section aria-label={label}>
      <Heading className="text-xs font-medium">{title}</Heading>
      {grouped && (
        <p className="text-xs text-muted-foreground">
          {incidents.length} {incidents.length === 1 ? 'incident' : 'incidents'} · {eligible}{' '}
          eligible {eligible === 1 ? 'notification' : 'notifications'}
        </p>
      )}
      <AlertIncidentList
        incidents={incidents}
        replayStart={start}
        emptyMessage="No incidents in the evaluated minutes."
        openMessage="Open at the end of this replay"
        openingThresholds={openingThresholds}
        openingContext={openingContext}
      />
    </section>
  );
}

function replayOpeningThresholds(breaches: Breach[], fallback: ZeroBaselineFallback) {
  return new Map(
    breaches.map((breach) => [
      breach.evaluated_at,
      breach.zero_baseline_fallback
        ? `Zero-baseline fallback · ${formatPreviewValue(breach.trigger_value, 'error_rate_pct')} or higher and at least ${formatNumber(fallback.minimum_failed_requests)} failures`
        : `Baseline multiplier · ${formatPreviewValue(breach.trigger_value, 'error_rate_pct')} or higher`,
    ])
  );
}

function WeekdayCoverage({ baseline }: { baseline: WeekdayBaseline }) {
  const fallback = baseline.fallback_at;
  return (
    <div aria-label="Same-weekday baseline coverage" role="region" className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        Same-weekday comparison evaluated {baseline.evaluated} of{' '}
        {baseline.evaluated + baseline.skipped_windows.length} checks.
      </p>
      {fallback.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Seven-day fallback at {fallback.length} {fallback.length === 1 ? 'check' : 'checks'}
          </summary>
          <ul className="mt-1 max-h-36 overflow-auto" aria-label="Seven-day fallback check times">
            {fallback.map((at) => (
              <li key={at} className="py-0.5">
                <Timestamp value={at} mode="absolute" />
              </li>
            ))}
          </ul>
        </details>
      )}
      {baseline.skipped_windows.length > 0 && (
        <SkippedWindows windows={baseline.skipped_windows} label="Same-weekday skipped windows" />
      )}
    </div>
  );
}

function SkippedWindows({
  windows,
  label,
  metric = 'request_count',
}: {
  windows: SkippedWindow[];
  label?: string;
  metric?: PreviewMetric;
}) {
  const missing = windows.filter((window) => window.reason === 'telemetry_missing_or_stale').length;
  const lowTraffic = windows.filter((window) => window.reason === 'insufficient_traffic').length;
  const requests = PREVIEW_METRIC_DISPLAY[metric].requests?.toLowerCase() ?? 'eligible requests';

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {label && <span>{label} · </span>}
        {windows.length} skipped ({missing} with missing or stale request data,{' '}
        {windows.length - missing - lowTraffic} with insufficient baseline history
        {lowTraffic > 0 && `, ${lowTraffic} with insufficient traffic`})
      </summary>
      <div className="mt-2 max-h-48 overflow-auto">
        <table className="w-full text-left">
          <caption className="sr-only">{label ?? 'Skipped windows'}</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-medium">
                Window end
              </th>
              <th scope="col" className="py-1 font-medium">
                Reason
              </th>
            </tr>
          </thead>
          <tbody>
            {windows.map((window) => (
              <tr key={window.evaluated_at} className="border-t border-border">
                <td className="whitespace-nowrap py-1 pr-3">
                  <Timestamp value={window.evaluated_at} mode="absolute" />
                </td>
                <td className="py-1">
                  {SKIP_LABEL[window.reason]}
                  {window.eligible_requests !== undefined && (
                    <span className="block text-muted-foreground">
                      {formatNumber(window.eligible_requests)} {requests}
                      {window.required_requests !== undefined &&
                        ` (minimum ${formatNumber(window.required_requests)})`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function formatPreviewValue(value: number, metric: PreviewMetric) {
  return `${formatNumber(value)}${PREVIEW_METRIC_DISPLAY[metric].suffix}`;
}

function BreachTable({
  result,
  direction,
  metric,
}: {
  result: PreviewResult;
  direction: string;
  metric: PreviewMetric;
}) {
  const display = PREVIEW_METRIC_DISPLAY[metric];
  const weekday = result.candidate?.weekday_baseline;
  const selectedSkipped = new Set(result.skipped_windows.map((window) => window.evaluated_at));
  const candidateSkipped = new Set(weekday?.skipped_windows.map((window) => window.evaluated_at));
  const rows = new Map<string, { breach: Breach; selected?: Breach; candidate?: Breach }>();
  for (const breach of result.breaches) {
    rows.set(breach.evaluated_at, { breach, selected: breach });
  }
  for (const breach of result.candidate?.breaches ?? []) {
    rows.set(breach.evaluated_at, {
      breach,
      selected: rows.get(breach.evaluated_at)?.selected,
      candidate: breach,
    });
  }
  const checkpoints = [...rows.values()].sort((a, b) =>
    a.breach.evaluated_at.localeCompare(b.breach.evaluated_at)
  );

  return (
    <>
      <p className="text-xs text-muted-foreground">Several breaches can belong to one incident.</p>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Threshold breaches</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-medium">
                Window end
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                {display.observed}
              </th>
              {display.requests && (
                <th scope="col" className="py-1 pr-3 font-medium">
                  {display.requests}
                </th>
              )}
              {!weekday && (
                <th scope="col" className="py-1 pr-3 font-medium">
                  Baseline
                </th>
              )}
              <th scope="col" className="py-1 pr-3 font-medium">
                {weekday ? 'Seven-day trigger' : result.candidate ? 'Selected trigger' : 'Trigger'}
              </th>
              {result.candidate && (
                <th scope="col" className="py-1 font-medium">
                  {weekday ? 'Same-weekday trigger' : 'Candidate trigger'}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {checkpoints.map((row) => (
              <tr key={row.breach.evaluated_at} className="border-t border-border">
                <td className="whitespace-nowrap py-1 pr-3">
                  <Timestamp value={row.breach.evaluated_at} mode="absolute" />
                </td>
                <td className="py-1 pr-3 tabular-nums">
                  {formatPreviewValue(row.breach.observed, metric)}
                </td>
                {display.requests && (
                  <td className="py-1 pr-3 tabular-nums">
                    {row.breach.eligible_requests === undefined
                      ? '—'
                      : formatNumber(row.breach.eligible_requests)}
                    {row.breach.failed_requests !== undefined && (
                      <span className="block text-muted-foreground">
                        {formatNumber(row.breach.failed_requests)} failed
                      </span>
                    )}
                  </td>
                )}
                {!weekday && (
                  <td className="py-1 pr-3 tabular-nums">
                    {formatPreviewValue(row.breach.baseline, metric)}
                  </td>
                )}
                <td className="whitespace-nowrap py-1 pr-3 tabular-nums">
                  <BreachTrigger
                    breach={row.selected}
                    direction={direction}
                    skipped={selectedSkipped.has(row.breach.evaluated_at)}
                    showBaseline={Boolean(weekday)}
                    metric={metric}
                  />
                </td>
                {result.candidate && (
                  <td className="whitespace-nowrap py-1 tabular-nums">
                    <BreachTrigger
                      breach={row.candidate}
                      direction={direction}
                      skipped={candidateSkipped.has(row.breach.evaluated_at)}
                      showBaseline={Boolean(weekday)}
                      metric={metric}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BreachTrigger({
  breach,
  direction,
  skipped,
  showBaseline,
  metric,
}: {
  breach?: Breach;
  direction: string;
  skipped: boolean;
  showBaseline: boolean;
  metric: PreviewMetric;
}) {
  if (!breach) return skipped ? 'Skipped' : 'No breach';
  return (
    <>
      {formatPreviewValue(breach.trigger_value, metric)} {direction}
      {breach.zero_baseline_fallback && (
        <span className="block text-muted-foreground">Zero-baseline fallback</span>
      )}
      {showBaseline && (
        <span className="block text-muted-foreground">
          Baseline {formatPreviewValue(breach.baseline, metric)}
        </span>
      )}
    </>
  );
}
