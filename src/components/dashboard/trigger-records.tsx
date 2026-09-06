import { useState } from 'react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useTriggerRecords, type TriggerRecordState } from '@/lib/api/queries';
import { TriggerRecordActions } from './trigger-record-actions';
import { formatRelative } from '@/lib/mock-data';

/**
 * The records a trigger has taken off its broker, and what happened to each.
 *
 * `payload`, `headers` and `metadata` arrive as raw JSON strings — the API is
 * explicit that they are decoded lazily by the client — so they are pretty
 * printed behind a disclosure rather than flattened into columns. A record's
 * shape is the customer's, not ours, and inventing columns for it would be
 * guessing.
 *
 * Filtering goes through the query rather than the rendered rows: the endpoint
 * takes `state`, and filtering client-side would silently only ever search the
 * page the server happened to return.
 */

const STATES: (TriggerRecordState | '')[] = [
  '',
  'pending',
  'claimed',
  'succeeded',
  'retry',
  'dead_letter',
];

const STATE_COLOR: Record<string, string> = {
  pending: 'var(--status-warning)',
  claimed: 'var(--status-warning)',
  succeeded: 'var(--status-good)',
  retry: 'var(--status-serious)',
  dead_letter: 'var(--status-critical)',
};

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // The API does not promise valid JSON — a broker can hand us anything.
    return raw;
  }
}

function when(value: string | null | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

export function TriggerRecords({ triggerId }: { triggerId: string }) {
  const [state, setState] = useState<TriggerRecordState | ''>('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, isPending, error } = useTriggerRecords(triggerId, state);

  const records = data?.records ?? [];
  const phase = queryPhase({ error, loading: isPending, isEmpty: records.length === 0 });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 self-start text-xs text-muted-foreground">
        State
        <select
          aria-label="State"
          value={state}
          onChange={(e) => setState(e.target.value as TriggerRecordState | '')}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
        >
          {STATES.map((s) => (
            <option key={s || 'all'} value={s}>
              {s || 'All states'}
            </option>
          ))}
        </select>
      </label>

      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={error}
          loadingMessage="Reading records…"
          emptyMessage="No records for this trigger yet."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {records.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill label={r.state} color={STATE_COLOR[r.state]} />
                <button
                  type="button"
                  onClick={() => setOpen((cur) => (cur === r.id ? null : r.id))}
                  className="font-mono text-xs underline-offset-2 hover:underline"
                >
                  {r.item_identifier}
                </button>
                <span className="text-xs text-muted-foreground">{when(r.received_at)}</span>
                {r.attempts > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {r.attempts} attempt{r.attempts === 1 ? '' : 's'}
                  </span>
                )}
                <span className="ml-auto">
                  {/* The API accepts a re-drive only from these two states, so
                      the button is offered only from them. */}
                  <TriggerRecordActions
                    triggerId={triggerId}
                    recordId={r.id}
                    retryable={r.state === 'retry' || r.state === 'dead_letter'}
                  />
                </span>
              </div>

              {r.last_error && (
                <p className="text-xs text-[color:var(--status-critical)]">{r.last_error}</p>
              )}

              {open === r.id && (
                <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                  {prettyJson(r.payload)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
