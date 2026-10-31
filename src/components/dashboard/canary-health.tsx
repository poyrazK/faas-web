import { CheckCircle, HelpCircle, WarningTriangle } from 'iconoir-react';
import { useRouteHealthHistory, useRouteHealthReport } from '@/lib/api/route-health';
import { InlinePhase, queryPhase } from './primitives';
import { PlanGated } from './plan-gated';

function verdict(status: string | undefined) {
  const s = (status ?? '').toLowerCase();
  // Report and route verdicts (healthy / regressed / unknown / disabled) and
  // saved decisions (allowed / blocked / report_only / aborted).
  if (['healthy', 'allowed'].includes(s)) return { color: 'var(--status-good)', icon: CheckCircle };
  if (['regressed', 'aborted'].includes(s))
    return { color: 'var(--status-critical)', icon: WarningTriangle };
  if (['blocked'].includes(s)) return { color: 'var(--status-warning)', icon: WarningTriangle };
  return { color: 'var(--muted-foreground)', icon: HelpCircle };
}

function Verdict({ status }: { status: string | undefined }) {
  const { color, icon: Icon } = verdict(status);
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

const rate = (value: number) => `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;

/**
 * Canary versus stable, as apid's rollout gate sees it: each critical route's
 * error rate (and p95 when selected) for the candidate against the serving
 * release, the gate's verdict, and every saved advance / hold / abort decision
 * with its reason. Only shown for a deployment that has a canary.
 */
export function CanaryHealth({ slug, deploymentId }: { slug: string; deploymentId: string }) {
  const report = useRouteHealthReport(slug, deploymentId);
  const history = useRouteHealthHistory(slug, deploymentId);
  const phase = queryPhase({ error: report.error, loading: report.isPending });
  const data = report.data;
  return (
    <section aria-label="Canary health" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Canary vs stable</h3>
      <PlanGated error={report.error} feature="Canary route health">
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={report.error}
            loadingMessage="Comparing canary and stable…"
            onRetry={() => void report.refetch()}
          />
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Verdict status={data.status} />
              <span className="text-muted-foreground">{data.reason}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Step {data.canary_step} · mode {data.mode}
              {data.on_regression && ` · on regression: ${data.on_regression}`} · coverage{' '}
              {data.coverage}
              {!data.stable_deployment_id && ' · no single stable release to compare against'}
            </p>
            {data.routes.length > 0 && (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1.5 font-medium">
                      Route
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Verdict
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Canary errors
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Stable errors
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      p95 Δ
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.routes.map((route) => {
                    const latest = route.windows[route.windows.length - 1];
                    return (
                      <tr key={`${route.method} ${route.path}`}>
                        <th scope="row" className="py-1.5 pr-2 font-normal">
                          <span className="font-mono text-xs">
                            {route.method} {route.path}
                          </span>
                          {route.reason && (
                            <span className="block text-xs text-muted-foreground">
                              {route.reason}
                            </span>
                          )}
                        </th>
                        <td className="py-1.5">
                          <Verdict status={route.status} />
                        </td>
                        <td className="py-1.5 text-right text-xs tabular-nums">
                          {latest
                            ? `${rate(latest.candidate.error_rate)} of ${latest.candidate.requests}`
                            : '—'}
                        </td>
                        <td className="py-1.5 text-right text-xs tabular-nums">
                          {latest
                            ? `${rate(latest.stable.error_rate)} of ${latest.stable.requests}`
                            : '—'}
                        </td>
                        <td className="py-1.5 text-right text-xs tabular-nums">
                          {latest?.latency_delta_ms !== undefined
                            ? `${latest.latency_delta_ms >= 0 ? '+' : ''}${Math.round(latest.latency_delta_ms)} ms`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="text-xs text-muted-foreground">
              Verdicts need at least {data.minimum_requests} requests per route on each side.
            </p>
          </>
        )}
        {history.data?.entries.length ? (
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">Rollout decisions</h4>
            <ol aria-label="Rollout decisions" className="divide-y divide-border text-sm">
              {history.data.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5"
                >
                  <Verdict status={entry.decision.status} />
                  <span className="text-xs text-muted-foreground">
                    at {entry.traffic_percent}% traffic
                    {entry.requested_traffic_percent !== entry.traffic_percent &&
                      ` → ${entry.requested_traffic_percent}%`}
                  </span>
                  <span className="min-w-0 flex-1 text-xs">{entry.decision.reason}</span>
                  <time dateTime={entry.checked_at} className="text-xs text-muted-foreground">
                    {new Date(entry.checked_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </PlanGated>
    </section>
  );
}
