import { type ReactNode, useId } from 'react';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import type { AlertRule } from '@/lib/api/alert-rules';
import type { components } from '@/lib/api/schema';
import { alertWindowLabel, formatAnomalyValue } from './alert-language';
import { metricLabel } from './alert-metrics';

type ObservationCoverage = components['schemas']['AlertObservationCoverage'];

const SKIP_LABEL: Record<components['schemas']['AlertObservationSkipCount']['reason'], string> = {
  insufficient_traffic: 'too few eligible requests',
  insufficient_history: 'insufficient baseline history',
  telemetry_missing_or_stale: 'missing or stale telemetry',
  telemetry_unavailable: 'telemetry unavailable',
};

export function describeObservationCoverage(coverage: ObservationCoverage | undefined): string {
  if (!coverage) return 'Live evaluation coverage is unavailable.';
  if (coverage.attempted === 0) return 'No checks recorded in the last 24 hours.';
  const summary = `${coverage.completed} of ${coverage.attempted} attempted checks completed in the last 24 hours.`;
  const skipped = coverage.attempted - coverage.completed;
  if (skipped === 0) return summary;
  const reasons = coverage.skipped?.map(
    ({ reason, count }) => `${count} with ${SKIP_LABEL[reason]}`
  );
  return reasons?.length
    ? `${summary} Skipped ${skipped}, including ${reasons.join(', ')}.`
    : `${summary} Skipped ${skipped}.`;
}

export function AlertObservationCoverage({ rule }: { rule: AlertRule }) {
  if (!rule.observe_only) return null;
  const coverage = rule.observation_coverage;
  return (
    <section aria-label="Evaluation coverage" className="flex flex-col gap-2">
      <h3 className="label-mono text-muted-foreground">Evaluation coverage</h3>
      <p className="text-sm">{describeObservationCoverage(coverage)}</p>
      {coverage?.last_checked_at && (
        <p className="text-xs text-muted-foreground">
          Last check at <Timestamp value={coverage.last_checked_at} mode="absolute" />.
        </p>
      )}
    </section>
  );
}

export function AlertRecoveryChecks({
  value,
  onChange,
}: {
  value: 1 | 2;
  onChange: (value: 1 | 2) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Healthy checks to recover</span>
      <select
        className={FIELD}
        value={value}
        onChange={(event) => onChange(event.target.value === '2' ? 2 : 1)}
      >
        <option value={1}>One healthy check</option>
        <option value={2}>Two consecutive healthy checks</option>
      </select>
    </label>
  );
}

export function AlertRuleMode({
  observeOnly,
  onChange,
  error,
  environmentScope,
  onClearEnvironment,
}: {
  observeOnly: boolean;
  onChange: (observeOnly: boolean) => void;
  error?: string;
  environmentScope?: string;
  onClearEnvironment?: () => void;
}) {
  const errorId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Mode</span>
        <select
          name="mode"
          className={FIELD}
          value={observeOnly ? 'observe_only' : 'notify'}
          onChange={(event) => onChange(event.target.value === 'observe_only')}
          {...fieldErrorProps(error, errorId)}
        >
          <option value="notify">Notify</option>
          <option value="observe_only">Observe only</option>
        </select>
        {error && <FieldError id={errorId}>{error}</FieldError>}
        {observeOnly && (
          <span className="text-xs text-muted-foreground">
            Record incidents from live traffic with notifications and actions off.
          </span>
        )}
      </label>
      {environmentScope && (
        <div className="flex flex-wrap items-center gap-x-3 text-sm">
          <span>
            {observeOnly ? 'Observing' : 'Notifying for'} {environmentScope}
          </span>
          <button
            type="button"
            className="text-xs underline underline-offset-2"
            onClick={onClearEnvironment}
          >
            Use all environments
          </button>
        </div>
      )}
    </div>
  );
}

export function AlertObservationHistory({ rule }: { rule: AlertRule }) {
  const incidents = rule.observed_incidents ?? [];
  if (!rule.observe_only && incidents.length === 0) return null;

  return (
    <section aria-label="Observed incidents" className="flex flex-col gap-2">
      <h3 className="label-mono text-muted-foreground">Observed incidents</h3>
      <AlertIncidentList
        incidents={incidents}
        emptyMessage="No observed incidents yet."
        openMessage="Open at the last check"
        showEnvironments={incidents.some(
          (incident) => (incident.environment_scope ?? '') !== (rule.environment_scope ?? '')
        )}
      />
    </section>
  );
}

export function AlertIncidentList({
  incidents,
  emptyMessage,
  openMessage,
  replayStart,
  openingThresholds,
  openingContext,
  showEnvironments,
}: {
  incidents: components['schemas']['AlertObservedIncident'][];
  emptyMessage: string;
  openMessage: string;
  replayStart?: string;
  openingThresholds?: ReadonlyMap<string, string>;
  openingContext?: (openedAt: string) => ReactNode;
  showEnvironments?: boolean;
}) {
  if (incidents.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border text-sm">
      {incidents.map((incident) => (
        <li key={incident.opened_at} className="flex flex-wrap gap-x-4 gap-y-1 py-2">
          {showEnvironments && (
            <span className="text-muted-foreground">
              {incident.environment_scope ?? 'All environments'}
            </span>
          )}
          <span>
            {incident.opened_at === replayStart ? 'Breaching at start' : 'Opened'}{' '}
            <Timestamp value={incident.opened_at} mode="absolute" />
          </span>
          {openingThresholds?.has(incident.opened_at) && (
            <span className="text-muted-foreground">
              {openingThresholds.get(incident.opened_at)}
            </span>
          )}
          {openingContext?.(incident.opened_at)}
          {incident.ended_at ? (
            <span className="text-muted-foreground">
              {incident.outcome === 'recovered' ? 'Recovered' : 'Observation ended'}{' '}
              <Timestamp value={incident.ended_at} mode="absolute" />
            </span>
          ) : (
            <span className="text-muted-foreground">{openMessage}</span>
          )}
          <span className="text-muted-foreground">
            {incident.eligible_notifications} eligible{' '}
            {incident.eligible_notifications === 1 ? 'notification' : 'notifications'}
          </span>
          {incident.opening_evidence && (
            <IncidentOpeningEvidence evidence={incident.opening_evidence} />
          )}
        </li>
      ))}
    </ul>
  );
}

function IncidentOpeningEvidence({
  evidence,
}: {
  evidence: components['schemas']['AlertObservedIncidentOpeningEvidence'];
}) {
  const { metric, window, comparison, observed, baseline, trigger_value, baseline_days } = evidence;
  const triggerBound = comparison === 'below_baseline' ? 'at most' : 'at least';
  return (
    <p className="basis-full text-muted-foreground">
      {metricLabel(metric)} at opening was {formatAnomalyValue(metric, observed)} over{' '}
      {alertWindowLabel(window)}. Baseline {formatAnomalyValue(metric, baseline)}
      {baseline_days !== undefined &&
        ` (${baseline_days} qualifying ${baseline_days === 1 ? 'day' : 'days'})`}
      . Trigger {triggerBound} {formatAnomalyValue(metric, trigger_value)}.
    </p>
  );
}
