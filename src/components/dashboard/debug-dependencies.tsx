import { WarningTriangle } from 'iconoir-react';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { useDependencyLatency } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import { DebugGate } from './debug-gate';
import { InlinePhase, queryPhase } from './primitives';

/*
 * The dependency view (faas capability `debug-dependencies`, beta):
 * GET .../debug/dependencies compares the newer and older halves of the
 * window per dependency, with database query patterns, parent-to-child
 * impact edges and up to three representative requests per edge
 * (handlers_debug_dependency*.go). Destinations and raw span attributes are
 * never returned, so names are the API's redacted labels.
 */

type Dependency = components['schemas']['DebugDependencyLatencyItem'];
type Edge = components['schemas']['DebugDependencyImpactEdge'];

const count = (value: number) => value.toLocaleString('en-US');

function Delta({
  item,
}: {
  item: Pick<
    Dependency,
    | 'regression'
    | 'failure_regression'
    | 'p95_delta_ms'
    | 'current_error_rate_pct'
    | 'baseline_error_rate_pct'
  >;
}) {
  if (item.regression || item.failure_regression)
    return (
      <span className="inline-flex items-center gap-1" style={{ color: 'var(--status-critical)' }}>
        <WarningTriangle aria-hidden className="h-3.5 w-3.5" />
        {item.regression && item.p95_delta_ms !== undefined
          ? `Slower +${count(item.p95_delta_ms)} ms`
          : `More errors ${item.baseline_error_rate_pct?.toFixed(1) ?? '—'}% → ${item.current_error_rate_pct?.toFixed(1) ?? '—'}%`}
      </span>
    );
  if (item.p95_delta_ms === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="text-muted-foreground">
      {item.p95_delta_ms >= 0 ? '+' : ''}
      {count(item.p95_delta_ms)} ms
    </span>
  );
}

function DependencyRow({ dep }: { dep: Dependency }) {
  return (
    <>
      <tr>
        <th scope="row" className="py-2 pr-3 font-normal">
          <span className="block [overflow-wrap:anywhere]">{dep.name}</span>
          <span className="text-xs text-muted-foreground">
            {(dep.kind ?? dep.type).replace(/_/g, ' ')}
            {dep.top_error_type && ` · ${dep.top_error_type}`}
          </span>
        </th>
        <td className="py-2 text-right tabular-nums">{count(dep.calls)}</td>
        <td className="py-2 text-right tabular-nums">{dep.error_rate_pct.toFixed(1)}%</td>
        <td className="py-2 text-right tabular-nums">
          {count(dep.p95_ms)} ms
          {dep.exclusive_p95_ms !== undefined && (
            <span className="block text-xs text-muted-foreground">
              {count(dep.exclusive_p95_ms)} ms own
            </span>
          )}
        </td>
        <td className="py-2 pl-3 text-right text-xs">
          <Delta item={dep} />
        </td>
      </tr>
      {dep.queries?.map((query) => (
        <tr key={query.pattern} className="text-xs">
          <th scope="row" className="py-1.5 pl-4 pr-3 font-normal">
            <code className="block truncate font-mono text-muted-foreground" title={query.pattern}>
              {query.pattern}
            </code>
          </th>
          <td className="py-1.5 text-right tabular-nums">{count(query.calls)}</td>
          <td className="py-1.5 text-right tabular-nums">
            {query.calls ? ((query.error_calls / query.calls) * 100).toFixed(1) : '0.0'}%
          </td>
          <td className="py-1.5 text-right tabular-nums">{count(query.p95_ms)} ms</td>
          <td className="py-1.5 pl-3 text-right">
            {query.regression || query.failure_regression ? (
              <span style={{ color: 'var(--status-critical)' }}>
                {query.regression ? 'slower' : 'more errors'}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </td>
        </tr>
      ))}
      {dep.queries_truncated && (
        <tr className="text-xs text-muted-foreground">
          <td colSpan={5} className="py-1.5 pl-4">
            More query patterns were seen than are shown.
          </td>
        </tr>
      )}
    </>
  );
}

function EdgeRow({ edge, onOpenRequest }: { edge: Edge; onOpenRequest?: (id: string) => void }) {
  return (
    <li className="flex flex-col gap-1 py-2 text-sm first:pt-0">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="[overflow-wrap:anywhere]">{edge.from.name}</span>
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <span className="sr-only">calls</span>
        <span className="[overflow-wrap:anywhere]">{edge.to.name}</span>
        {edge.regression && (
          <span
            className="inline-flex items-center gap-1 text-xs"
            style={{ color: 'var(--status-critical)' }}
          >
            <WarningTriangle aria-hidden className="h-3.5 w-3.5" />
            Regressed
          </span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {count(edge.calls)} calls · {edge.error_rate_pct.toFixed(1)}% errors · p95{' '}
        {count(edge.p95_ms)} ms ({count(edge.exclusive_p95_ms)} ms own)
        {edge.p95_delta_ms !== undefined &&
          ` · ${edge.p95_delta_ms >= 0 ? '+' : ''}${count(edge.p95_delta_ms)} ms vs earlier`}
      </span>
      {edge.exemplars.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {edge.exemplars.map((ex) => (
            <li key={`${ex.window}-${ex.request_id}`} className="flex items-center gap-1.5">
              <span className="text-muted-foreground">
                {ex.error ? 'Error' : ex.window === 'current' ? 'Slowest now' : 'Slowest before'} ·{' '}
                {count(ex.duration_ms)} ms · {ex.http_status} · <Timestamp value={ex.received_at} />
              </span>
              {onOpenRequest ? (
                <button
                  type="button"
                  onClick={() => onOpenRequest(ex.request_id)}
                  className="pressable rounded text-brand underline-offset-2 hover:underline"
                >
                  Open request
                </button>
              ) : (
                <CopyableId value={ex.request_id} label="request ID" />
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function DebugDependencies({
  slug,
  since,
  onOpenRequest,
}: {
  slug: string;
  since: string;
  /** Present when request evidence is available (the production-debugger preview). */
  onOpenRequest?: (id: string) => void;
}) {
  const deps = useDependencyLatency(slug, since);
  const data = deps.data;
  const phase = queryPhase({
    error: deps.error,
    loading: deps.isPending,
    isEmpty: !data?.dependencies.length,
  });
  const comparison = data?.deployment_comparison;
  const comparisonRegressions =
    comparison?.dependencies.filter((d) => d.regression || d.failure_regression) ?? [];

  return (
    <DebugGate error={deps.error}>
      {phase !== 'ready' || !data ? (
        <InlinePhase
          phase={phase}
          error={deps.error}
          loadingMessage="Reading dependency latency…"
          emptyMessage="No traced dependency calls in this window. Request tracing records them."
          onRetry={() => void deps.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-xs text-muted-foreground">
            {count(data.represented_requests)} requests, {count(data.span_samples)} sampled spans;
            the newer half of the window is compared with the older half.
            {data.retention_clamped && ' Plan retention shortened the window.'}
            {!data.complete && ' Sampled: caps were reached, so rare dependencies may be missing.'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Dependencies</caption>
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
                  <th scope="col" className="py-2 pl-3 text-right font-medium">
                    vs earlier
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.dependencies.map((dep) => (
                  <DependencyRow key={`${dep.type}:${dep.name}`} dep={dep} />
                ))}
              </tbody>
            </table>
          </div>

          {comparison && (
            <section aria-label="By release" className="flex flex-col gap-1 text-xs">
              <h3 className="text-sm font-semibold">By release</h3>
              <p className="text-muted-foreground">
                Release <CopyableId value={comparison.current_deployment_id} label="release ID" />{' '}
                against <CopyableId value={comparison.previous_deployment_id} label="release ID" />
                {comparison.route && (
                  <>
                    {' '}
                    on <span className="font-mono">{comparison.route}</span>
                  </>
                )}
                :{' '}
                {comparisonRegressions.length
                  ? `${comparisonRegressions.map((d) => d.name).join(', ')} regressed.`
                  : 'no dependency regressed.'}
              </p>
            </section>
          )}

          {data.edges.length > 0 && (
            <section aria-label="Impact edges" className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Who calls what</h3>
              <ul className="flex flex-col divide-y divide-border">
                {data.edges.map((edge) => (
                  <EdgeRow
                    key={`${edge.from.type}:${edge.from.name}->${edge.to.type}:${edge.to.name}`}
                    edge={edge}
                    onOpenRequest={onOpenRequest}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </DebugGate>
  );
}
