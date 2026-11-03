import { useDependencyLatency, useRouteAwake } from '@/lib/api/queries';
import { WarningTriangle } from 'iconoir-react';
import { PlanGated } from './plan-gated';
import { InlinePhase, Panel, queryPhase } from './primitives';

/* ------------------------------------------------------------------ *
 * Observability panels for one app, each over an endpoint apid already
 * serves. Every figure is what the API returned; when an endpoint cannot
 * answer (plan, retention, no evidence) the panel says so instead.
 * ------------------------------------------------------------------ */

const pct = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
const ms = (value: number | undefined) => (value === undefined ? '—' : `${value} ms`);

/**
 * Which routes keep the app awake. On scale-to-zero this is the cost and
 * cold-start story: a health check every minute holds an app awake around the
 * clock, and each route's share says what removing it would save.
 */
export function AwakeRoutesPanel({ slug, since }: { slug: string; since: string }) {
  const awake = useRouteAwake(slug, since);
  const phase = queryPhase({
    error: awake.error,
    loading: awake.isPending,
    isEmpty: !awake.data?.routes.length,
  });
  const data = awake.data;
  return (
    <Panel title="What keeps it awake">
      <PlanGated error={awake.error} feature="Awake-time analysis">
        {data && (
          <p className="mb-3 text-sm text-muted-foreground">
            Awake <span className="font-medium text-foreground">{pct(data.awake_share)}</span> of
            the window · {data.gb_hours.toFixed(2)} GB-h · {data.wakes} cold starts
            {data.window_clamped && ' · window shortened by plan retention'}
          </p>
        )}
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={awake.error}
            loadingMessage="Reading awake time…"
            emptyMessage="No requests kept this app awake in the window."
            onRetry={() => void awake.refetch()}
          />
        ) : (
          <div
            className="overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-brand"
            role="region"
            aria-label="Routes keeping this app awake"
            tabIndex={0}
          >
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">
                    Route
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Awake share
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Requests
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Cold starts
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    GB-h
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.routes.map((route) => (
                  <tr key={`${route.method} ${route.route}`}>
                    <th scope="row" className="w-2/5 py-2 pr-4 font-normal">
                      <span className="font-mono text-xs">
                        {route.method} {route.route}
                      </span>
                      {route.pattern === 'periodic' && route.interval_seconds ? (
                        <span className="block text-xs text-muted-foreground">
                          every ~{route.interval_seconds} s
                        </span>
                      ) : null}
                      {route.suggestion && (
                        <span className="block text-xs text-muted-foreground">
                          {route.suggestion.message}
                        </span>
                      )}
                    </th>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
                        >
                          <span
                            className="block h-full rounded-full bg-brand"
                            style={{ width: pct(Math.min(1, route.awake_share)) }}
                          />
                        </span>
                        <span className="text-xs tabular-nums">{pct(route.awake_share)}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{route.requests}</td>
                    <td className="py-2 text-right tabular-nums">{route.wakes}</td>
                    <td className="py-2 text-right tabular-nums">{route.gb_hours.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PlanGated>
    </Panel>
  );
}

/** Downstream calls by p95 and error rate, flagging regressions against the baseline. */
export function DependencyLatencyPanel({ slug, since }: { slug: string; since: string }) {
  const deps = useDependencyLatency(slug, since);
  const phase = queryPhase({
    error: deps.error,
    loading: deps.isPending,
    isEmpty: !deps.data?.dependencies.length,
  });
  const data = deps.data;
  return (
    <Panel title="Dependencies">
      <PlanGated error={deps.error} feature="Dependency latency">
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={deps.error}
            loadingMessage="Reading dependency latency…"
            emptyMessage="No traced dependency calls in this window."
            onRetry={() => void deps.refetch()}
          />
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">
                    Dependency
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Calls
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Errors
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    p95
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    vs baseline
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.dependencies.map((dep) => (
                  <tr key={`${dep.type}:${dep.name}`}>
                    <th scope="row" className="py-2 pr-3 font-normal">
                      <span className="block truncate">{dep.name}</span>
                      <span className="text-xs text-muted-foreground">{dep.kind ?? dep.type}</span>
                    </th>
                    <td className="py-2 text-right tabular-nums">{dep.calls}</td>
                    <td className="py-2 text-right tabular-nums">
                      {dep.error_rate_pct.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right tabular-nums">{ms(dep.p95_ms)}</td>
                    <td className="py-2 text-right text-xs">
                      {dep.regression || dep.failure_regression ? (
                        <span
                          className="inline-flex items-center gap-1"
                          style={{ color: 'var(--status-critical)' }}
                        >
                          <WarningTriangle aria-hidden className="h-3.5 w-3.5" />
                          {dep.regression && dep.p95_delta_ms !== undefined
                            ? `+${dep.p95_delta_ms} ms`
                            : 'more errors'}
                        </span>
                      ) : dep.p95_delta_ms !== undefined ? (
                        <span className="text-muted-foreground">
                          {dep.p95_delta_ms >= 0 ? '+' : ''}
                          {dep.p95_delta_ms} ms
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.complete && (
              <p className="mt-2 text-xs text-muted-foreground">
                Sampled: trace caps were reached, so rare dependencies may be missing.
              </p>
            )}
          </>
        )}
      </PlanGated>
    </Panel>
  );
}
