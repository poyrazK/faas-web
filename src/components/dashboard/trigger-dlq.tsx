import { useState } from 'react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useTriggerDeadLetter, type TriggerDeadLetterReason } from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';

/**
 * Records the platform gave up on, and why.
 *
 * `reason` and `routed_to` are the two fields that decide what a customer can
 * do next — `manual_retry` means the record is still recoverable, `drop` means
 * it is gone — so they lead. `detail` is per-reason and deliberately opaque at
 * the wire level (a broker error and a poison record carry different shapes),
 * so it is pretty printed rather than given invented labels.
 */

const REASONS: (TriggerDeadLetterReason | '')[] = [
  '',
  'rate_limited',
  'poison_record',
  'max_attempts',
  'broker_error',
  'plan_quota',
  'payload_too_large',
  'customer_disabled',
];

const ROUTED_COLOR: Record<string, string> = {
  manual_retry: 'var(--status-warning)',
  customer_dlq: 'var(--status-serious)',
  drop: 'var(--status-critical)',
};

function when(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

export function TriggerDeadLetter({ triggerId }: { triggerId: string }) {
  const [reason, setReason] = useState<TriggerDeadLetterReason | ''>('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, isPending, error } = useTriggerDeadLetter(triggerId, reason);

  const rows = data?.records ?? [];
  const phase = queryPhase({ error, loading: isPending, isEmpty: rows.length === 0 });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 self-start text-xs text-muted-foreground">
        Reason
        <select
          aria-label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as TriggerDeadLetterReason | '')}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
        >
          {REASONS.map((r) => (
            <option key={r || 'all'} value={r}>
              {r || 'All reasons'}
            </option>
          ))}
        </select>
      </label>

      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={error}
          loadingMessage="Reading the dead-letter queue…"
          emptyMessage="Nothing has been dead-lettered."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((r) => (
            <li key={r.record_id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill label={r.reason} color="var(--status-critical)" />
                <span className="label-mono" style={{ color: ROUTED_COLOR[r.routed_to] }}>
                  {r.routed_to}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen((cur) => (cur === r.record_id ? null : r.record_id))}
                  className="font-mono text-xs underline-offset-2 hover:underline"
                >
                  {r.record_id}
                </button>
                <span className="text-xs text-muted-foreground">{when(r.created_at)}</span>
              </div>

              {open === r.record_id && (
                <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(r.detail, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
