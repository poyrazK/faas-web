import { Timestamp } from '@/components/ui/timestamp';
import { useDebugCoverage, useDebugRunning, type DebugRunning } from '@/lib/api/debug';
import { DebugGate } from './debug-gate';
import { InlinePhase, queryPhase } from './primitives';

/*
 * Two beta debugger reads every account has (faas capability `debug`):
 *
 * - Coverage (GET .../debug/coverage, handlers_debug_telemetry.go): how much
 *   of the *retained* telemetry carries each signal. It is observed
 *   persistence coverage, not a capture rate — apid does not infer a
 *   denominator for requests dropped before persistence, and neither do we.
 * - Running (GET .../debug/running, handlers_debug_running.go): the scheduler
 *   causes observed while the app stayed resident. Evidence only — no
 *   estimated saving, no inferred protocol.
 */

const count = (value: number) => value.toLocaleString('en-US');

const SIGNALS = [
  ['trace_linked', 'Linked to a trace'],
  ['span_evidence', 'Span evidence'],
  ['wake_evidence', 'Wake evidence'],
  ['guest_evidence', 'In-guest execution'],
] as const;

export function DebugCoverage({ slug, since }: { slug: string; since: string }) {
  const coverage = useDebugCoverage(slug, since);
  const data = coverage.data;
  const phase = queryPhase({
    error: coverage.error,
    loading: coverage.isPending,
    isEmpty: data?.telemetry_rows === 0,
  });
  return (
    <DebugGate error={coverage.error}>
      {phase !== 'ready' || !data ? (
        <InlinePhase
          phase={phase}
          error={coverage.error}
          loadingMessage="Reading signal coverage…"
          emptyMessage="No request details were saved in this window."
          onRetry={() => void coverage.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            {count(data.represented_requests)} requests in {count(data.telemetry_rows)} retained
            rows, {count(data.error_requests)} of them errors.
          </p>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Signal coverage</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  Signal
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Requests
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Share
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {SIGNALS.map(([key, label]) => {
                const signal = data[key];
                return (
                  <tr key={key}>
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {label}
                    </th>
                    <td className="py-2 text-right tabular-nums">{count(signal.requests)}</td>
                    <td className="py-2 text-right tabular-nums">{signal.rate_pct.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            Window <Timestamp value={data.window_start} mode="absolute" /> to{' '}
            <Timestamp value={data.window_end} mode="absolute" /> ({data.since}); your plan keeps{' '}
            {data.plan_retention_days} days.
            {data.oldest_telemetry_at && (
              <>
                {' '}
                Oldest row <Timestamp value={data.oldest_telemetry_at} />, newest{' '}
                <Timestamp value={data.latest_telemetry_at} />.
              </>
            )}{' '}
            Shares are of retained requests only; requests dropped before they were stored are not
            counted, so this is not a capture rate.
          </p>
        </div>
      )}
    </DebugGate>
  );
}

/** apid's closed set of residency causes (DebugRunningCause.code), in words. */
const CAUSES: Record<DebugRunning['current'][number]['code'], string> = {
  request_activity: 'Requests',
  open_connection: 'Open connections',
  tail_tasks: 'Work after the response',
  min_instances: 'Minimum instances',
  prewarm_floor: 'Prewarm floor',
  scale_in_cooldown: 'Scale-in cooldown',
  workload_mode: 'Workload mode',
  startup_grace: 'Startup grace',
  activity_unknown: 'Activity unknown',
  no_blocker_observed: 'Nothing holding it',
};

function Cause({ cause }: { cause: DebugRunning['current'][number] }) {
  return (
    <li className="flex flex-col gap-1 py-2 text-sm first:pt-0">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{CAUSES[cause.code] ?? cause.code.replace(/_/g, ' ')}</span>
        <span className="text-xs text-muted-foreground">
          {cause.instance_count} {cause.instance_count === 1 ? 'instance' : 'instances'}
          {cause.open_connections !== undefined &&
            ` · ${count(cause.open_connections)} connections`}
          {cause.tail_tasks !== undefined && ` · ${cause.tail_tasks} tasks`}
        </span>
      </span>
      <span className="text-muted-foreground [overflow-wrap:anywhere]">{cause.summary}</span>
      {cause.request && (
        <span className="text-xs text-muted-foreground">
          Nearest request: <span className="font-mono">{cause.request.method}</span>{' '}
          <span className="font-mono">{cause.request.route}</span>,{' '}
          <Timestamp value={cause.request.received_at} />
          {cause.request.count > 1 && ` (one of ${cause.request.count} collapsed requests)`}
        </span>
      )}
      {(cause.last_activity_at || cause.idle_deadline) && (
        <span className="text-xs text-muted-foreground">
          {cause.last_activity_at && (
            <>
              Last activity <Timestamp value={cause.last_activity_at} />
            </>
          )}
          {cause.last_activity_at && cause.idle_deadline && ' · '}
          {cause.idle_deadline && (
            <>
              idle deadline <Timestamp value={cause.idle_deadline} />
            </>
          )}
        </span>
      )}
      {cause.flow_topology_degraded && (
        <span className="text-xs text-muted-foreground">Connection detail was unavailable.</span>
      )}
    </li>
  );
}

export function DebugRunningView({ slug, since }: { slug: string; since: string }) {
  const running = useDebugRunning(slug, since);
  const data = running.data;
  const phase = queryPhase({ error: running.error, loading: running.isPending });
  return (
    <DebugGate error={running.error}>
      {phase !== 'ready' || !data ? (
        <InlinePhase
          phase={phase}
          error={running.error}
          loadingMessage="Reading scheduler observations…"
          onRetry={() => void running.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-label="Why it is running now" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              Now
              {data.current_observed_at && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  observed <Timestamp value={data.current_observed_at} />
                </span>
              )}
            </h3>
            {data.current.length ? (
              <ul className="flex flex-col divide-y divide-border">
                {data.current.map((cause, index) => (
                  <Cause key={`${cause.code}-${index}`} cause={cause} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No scheduler observation in this window.
              </p>
            )}
          </section>
          <p className="text-xs text-muted-foreground">
            Minimum instances {data.config.configured_min_instances} configured,{' '}
            {data.config.effective_min_instances} effective
            {data.config.prewarm_min_instances !== undefined &&
              `, ${data.config.prewarm_min_instances} prewarm`}
            ; idle timeout {data.config.idle_timeout_seconds} s.
          </p>
          <section aria-label="Earlier observations" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Earlier in the window</h3>
            {data.history.length ? (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {data.history.map((obs, index) => (
                  <li
                    key={obs.event_id ?? `${obs.observed_at}-${index}`}
                    className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-1.5"
                  >
                    <span>
                      {obs.running_instances} running ·{' '}
                      {obs.causes.map((c) => CAUSES[c.code] ?? c.code).join(', ') ||
                        'no cause recorded'}
                      {obs.degraded && (
                        <span className="text-xs text-muted-foreground"> · partial signals</span>
                      )}
                    </span>
                    <Timestamp
                      value={obs.observed_at}
                      mode="absolute"
                      className="text-xs text-muted-foreground"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No earlier observations.</p>
            )}
            {data.history_truncated && (
              <p className="text-xs text-muted-foreground">
                Only the most recent observations are shown.
              </p>
            )}
          </section>
          <p className="text-xs text-muted-foreground">
            {data.retention_clamped && 'Plan retention shortened this window. '}
            Recorded scheduling decisions only: no saving is estimated and no protocol is inferred.
          </p>
        </div>
      )}
    </DebugGate>
  );
}
