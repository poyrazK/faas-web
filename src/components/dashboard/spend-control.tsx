import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useBillingForecast, useOverageCap, useSpendCapHistory } from '@/lib/api/queries';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { SpendCapEditor } from './spend-cap';

const METER_NAMES: Record<string, string> = {
  gb_hours: 'compute',
  egress_gb: 'egress',
  ingress_gb: 'ingress',
  requests: 'requests',
  storage_gb_months: 'storage',
};
const meterName = (meter: string) => METER_NAMES[meter] ?? meter.replace(/_/g, ' ');

const eur = (cents: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(cents / 100);

/** How this month's overage stands against the cap. Pure, so every state can be tested. */
export function capStanding(overageCents: number, capCents: number | null) {
  if (capCents === null)
    return {
      tone: 'var(--status-warning)',
      label: 'No cap',
      detail: `${eur(overageCents)} of overage so far. Nothing stops overage from growing.`,
      pct: null,
    };
  if (capCents === 0)
    return {
      tone: overageCents > 0 ? 'var(--status-critical)' : 'var(--status-good)',
      label: 'Overage not allowed',
      detail:
        'Once the included allowance is used, new wakes are refused until the next period or a higher cap.',
      pct: overageCents > 0 ? 100 : 0,
    };
  const pct = Math.min(100, (overageCents / capCents) * 100);
  if (overageCents >= capCents)
    return {
      tone: 'var(--status-critical)',
      label: 'Cap reached',
      detail: `${eur(overageCents)} of ${eur(capCents)}. New wakes beyond the allowance are refused, and running apps park, until the cap is raised or the period ends.`,
      pct,
    };
  return {
    tone: pct >= 80 ? 'var(--status-warning)' : 'var(--status-good)',
    label: pct >= 80 ? 'Close to the cap' : 'Within the cap',
    detail: `${eur(overageCents)} of ${eur(capCents)} overage used.`,
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
        ? eur(value)
        : String(value);
  if (event.kind === 'overage.cap_changed')
    return `Cap changed from ${money(data.old_cents)} to ${money(data.new_cents)}`;
  if (event.kind === 'overage.cap_reached')
    return `Cap reached: ${money(data.current_overage_cents)} of ${money(data.cap_cents)}`;
  return event.kind;
}

function ForecastLine() {
  const forecast = useBillingForecast();
  if (forecast.isPending)
    return <p className="text-xs text-muted-foreground">Reading the charge forecast…</p>;
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
    <p className="text-xs text-muted-foreground">
      {/* period_end is exclusive: the last day of the period is the day before. */}
      Projected usage charges by{' '}
      {new Date(Date.parse(forecast.data.period_end) - 1).toLocaleDateString()}:{' '}
      <span className="font-medium text-foreground">{eur(projected / 1000)}</span>
      {missing.length > 0 &&
        ` (excludes ${missing.map((m) => meterName(m.meter)).join(', ')}, which cannot be forecast yet)`}
      {!forecast.data.bill_estimate_available &&
        '. Not an invoice estimate: some bill components are not covered.'}
    </p>
  );
}

function CapHistory() {
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
            {new Date(event.at).toLocaleString()}
          </time>
        </li>
      ))}
    </ul>
  );
}

/**
 * Spend control on the Usage page: where this month's overage stands against
 * the cap, what the period is projected to cost, and every cap change and
 * cap-reached notice apid has recorded. The cap itself is edited in place.
 */
export function SpendControl({ overageCents }: { overageCents: number | undefined }) {
  const cap = useOverageCap();
  const [editing, setEditing] = useState(false);
  const phase = queryPhase({ error: cap.error, loading: cap.isPending });
  return (
    <Panel
      title="Spend control"
      description="Overage is usage beyond the included allowance. The cap stops it from growing past a set amount."
      actions={
        cap.data && (
          <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
            {cap.data.overage_cap_cents === null ? 'Set a cap' : 'Change cap'}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {phase !== 'ready' || !cap.data || overageCents === undefined ? (
          <InlinePhase
            phase={phase === 'ready' ? 'loading' : phase}
            error={cap.error}
            loadingMessage="Reading spend cap…"
            onRetry={() => void cap.refetch()}
          />
        ) : (
          <Standing overageCents={overageCents} capCents={cap.data.overage_cap_cents} />
        )}
        <ForecastLine />
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">History</h3>
          <CapHistory />
        </div>
      </div>
      {editing && cap.data && (
        <Modal
          open
          onClose={() => setEditing(false)}
          title="Spend cap"
          description="Set €0 to allow no overage, or clear the cap to remove the ceiling."
          width="max-w-lg"
        >
          <div className="p-1">
            <SpendCapEditor initialCents={cap.data.overage_cap_cents} />
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function Standing({ overageCents, capCents }: { overageCents: number; capCents: number | null }) {
  const standing = capStanding(overageCents, capCents);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm font-medium">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: standing.tone }}
        />
        {standing.label}
      </p>
      {standing.pct !== null && (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-label="Overage used against the cap"
          aria-valuenow={Math.round(standing.pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${standing.pct}%`, background: standing.tone }}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">{standing.detail}</p>
    </div>
  );
}
