import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { useAccountSlo } from '@/lib/api/queries';

const pct = (v: number) => `${v.toFixed(2)}%`;
const num = (v: number) => v.toLocaleString();

/**
 * The account-wide SLO rollup: what the platform is delivering across every
 * app the account owns, over the window the API chose. `useAccountSlo` had
 * been written and imported nowhere; the numbers were only in the CLI.
 */
export function AccountSloPanel() {
  const slo = useAccountSlo();
  const phase = queryPhase({ error: slo.error, loading: slo.isPending, isEmpty: !slo.data });
  const d = slo.data;
  return (
    <Panel
      title="Service level"
      description={
        d
          ? `Across every app · last ${d.window} · as of ${new Date(d.as_of).toLocaleString()}`
          : undefined
      }
    >
      {phase !== 'ready' || !d ? (
        <InlinePhase
          phase={phase}
          error={slo.error}
          loadingMessage="Reading the rollup…"
          emptyMessage="No SLO data yet."
        />
      ) : (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Error rate', pct(d.error_rate_pct)],
            ['Cold boots', pct(d.cold_boot_rate_pct)],
            ['Wake queue p95', `${num(d.wake_queue_p95_ms)} ms`],
            ['Requests', num(d.requests_total)],
            ['Throttled', num(d.throttled_total)],
            ['GB-hours', d.gb_hours.toFixed(2)],
          ].map(([k, v]) => (
            <div key={k} className="flex min-w-0 flex-col gap-0.5">
              <dt className="label-mono text-muted-foreground">{k}</dt>
              <dd className="truncate font-mono text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
