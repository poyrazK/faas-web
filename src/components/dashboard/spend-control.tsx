import { useBillingForecast, useSpendCapHistory } from '@/lib/api/queries';
import { InlinePhase, queryPhase } from './primitives';
import { formatCents, formatMillicents } from '@/lib/money';
import { Timestamp } from '@/components/ui/timestamp';
import { HelpTip } from './kit/help-tip';

const METER_NAMES: Record<string, string> = {
  gb_hours: 'compute',
  egress_gb: 'egress',
  ingress_gb: 'ingress',
  requests: 'requests',
  storage_gb_months: 'storage',
};
const meterName = (meter: string) => METER_NAMES[meter] ?? meter.replace(/_/g, ' ');

/** How this month's overage stands against the cap. Pure, so every state can be tested. */
export function capStanding(overageCents: number, capCents: number | null) {
  if (capCents === null)
    return {
      tone: 'var(--status-warning)',
      label: 'No cap',
      detail: `${formatCents(overageCents)} of overage so far. Nothing stops overage from growing.`,
      pct: null,
    };
  // apid parks once overage >= cap, so a $0 cap is reached at once: a pause
  // switch, not "no overage" (faas pkg/sched/overage.go:207, docs/billing.md:33).
  if (capCents === 0)
    return {
      tone: 'var(--status-critical)',
      label: 'Workloads paused',
      detail:
        'A $0 cap counts as reached immediately: new wakes are refused and running apps park, even within the included allowance, until the cap is raised or cleared.',
      pct: 100,
    };
  const pct = Math.min(100, (overageCents / capCents) * 100);
  if (overageCents >= capCents)
    return {
      tone: 'var(--status-critical)',
      label: 'Cap reached',
      detail: `${formatCents(overageCents)} of ${formatCents(capCents)}. New wakes beyond the allowance are refused, and running apps park, until the cap is raised or the period ends.`,
      pct,
    };
  return {
    tone: pct >= 80 ? 'var(--status-warning)' : 'var(--status-good)',
    label: pct >= 80 ? 'Close to the cap' : 'Within the cap',
    detail: `${formatCents(overageCents)} of ${formatCents(capCents)} overage used.`,
    pct,
  };
}

type HistoryEvent = { id: number | string; at: string; kind: string; data?: unknown };

/** One audit row in words. Unknown kinds are named, not guessed at. */
export function describeCapEvent(event: HistoryEvent): string {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const money = (value: unknown) =>
    value === 'null' || value === null || value === undefined
      ? 'no cap'
      : typeof value === 'number'
        ? formatCents(value)
        : String(value);
  if (event.kind === 'overage.cap_changed')
    return `Cap changed from ${money(data.old_cents)} to ${money(data.new_cents)}`;
  if (event.kind === 'overage.cap_reached')
    return `Cap reached: ${money(data.current_overage_cents)} of ${money(data.cap_cents)}`;
  return event.kind;
}

export function ForecastLine() {
  const forecast = useBillingForecast();
  if (forecast.isPending)
    return <InlinePhase phase="loading" loadingMessage="Reading the charge forecast…" />;
  if (forecast.error || !forecast.data)
    return (
      <p className="text-xs text-muted-foreground">
        The charge forecast could not be read.{' '}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => void forecast.refetch()}
        >
          Retry
        </button>
      </p>
    );
  const meters = forecast.data.meters;
  const ready = meters.filter(
    (m) => m.forecast.available && typeof m.forecast.projected_net_millicents === 'number'
  );
  const missing = meters.filter((m) => !m.forecast.available);
  if (!ready.length)
    return (
      <p className="text-xs text-muted-foreground">
        No charge forecast yet
        {missing[0]?.forecast.reason ? `: ${missing[0].forecast.reason}` : '.'}
      </p>
    );
  const projected = ready.reduce((sum, m) => sum + (m.forecast.projected_net_millicents ?? 0), 0);
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {/* period_end is exclusive: the last day of the period is the day before. */}
      Projected usage charges by{' '}
      {new Date(Date.parse(forecast.data.period_end) - 1).toLocaleDateString()}:{' '}
      <span className="font-medium text-foreground">{formatMillicents(projected)}</span>
      {missing.length > 0 && ` · excludes ${missing.map((m) => meterName(m.meter)).join(', ')}`}
      {!forecast.data.bill_estimate_available && (
        <HelpTip label="About this forecast">
          Not an invoice estimate: some bill components are not covered
          {missing.length > 0 ? ', and the excluded meters cannot be forecast yet' : ''}.
        </HelpTip>
      )}
    </p>
  );
}

export function CapHistory() {
  const history = useSpendCapHistory();
  const phase = queryPhase({
    error: history.error,
    loading: history.isPending,
    isEmpty: !history.data?.events.length,
  });
  if (phase !== 'ready')
    return (
      <InlinePhase
        phase={phase}
        error={history.error}
        loadingMessage="Reading cap history…"
        emptyMessage="No cap changes or cap-reached notices yet."
        onRetry={() => void history.refetch()}
      />
    );
  return (
    <ul aria-label="Spend cap history" className="divide-y divide-border text-sm">
      {history.data!.events.map((event) => (
        <li key={event.id} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2">
          <span>{describeCapEvent(event)}</span>
          <time dateTime={event.at} className="text-xs text-muted-foreground">
            <Timestamp value={event.at} mode="absolute" />
          </time>
        </li>
      ))}
    </ul>
  );
}
