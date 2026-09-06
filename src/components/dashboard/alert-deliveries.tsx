import { useState } from 'react';
import { Pill } from '@/components/dashboard/resource-table';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { useAlertDeliveries } from '@/lib/api/queries';

/**
 * Did this rule actually reach its webhook?
 *
 * A rule could be created and left firing into a dead URL with nothing in the
 * console to say so. `last_status_code` and `last_error` are the fields that
 * answer it, so a failed delivery leads with them rather than with a status
 * word that only says "no".
 *
 * Test rows are hidden by default, matching the API. The test button writes
 * delivery rows too, and someone asking "did this fire in production?" does not
 * want their own clicks in the answer.
 */

const STATUS_COLOR: Record<string, string> = {
  delivered: 'var(--status-good)',
  failed: 'var(--status-critical)',
  pending: 'var(--status-warning)',
};

function formatWhen(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : new Date(ms).toLocaleString();
}

export function AlertDeliveries({ slug, ruleId }: { slug: string; ruleId: string }) {
  const [includeTest, setIncludeTest] = useState(false);
  const { data, isPending, error } = useAlertDeliveries(slug, ruleId, includeTest);

  const phase = queryPhase({
    error,
    loading: isPending,
    isEmpty: (data ?? []).length === 0,
  });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 self-start text-xs text-muted-foreground">
        <input
          type="checkbox"
          aria-label="Include test deliveries"
          checked={includeTest}
          onChange={(e) => setIncludeTest(e.target.checked)}
          className="h-3.5 w-3.5 accent-[color:var(--brand)]"
        />
        Include test deliveries
      </label>

      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={error}
          loadingMessage="Reading deliveries…"
          emptyMessage="This rule has never fired."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {(data ?? []).map((d) => (
            <li key={d.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill label={d.status} color={STATUS_COLOR[d.status]} />
                {d.is_test && <span className="label-mono text-muted-foreground">test</span>}
                <span className="text-xs text-muted-foreground">{formatWhen(d.fired_at)}</span>
                <span className="font-mono text-xs">observed {d.observed_value}</span>
                {d.attempt_count > 1 && (
                  <span className="text-xs text-muted-foreground">{d.attempt_count} attempts</span>
                )}
              </div>

              {d.status === 'failed' && (
                <p className="text-xs text-[color:var(--status-critical)]">
                  {d.last_status_code ? `HTTP ${d.last_status_code}` : 'Never reached the wire'}
                  {d.last_error ? ` — ${d.last_error}` : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
