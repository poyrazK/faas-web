import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import {
  DEBUG_REQUEST_SAMPLE_LIMIT,
  useDebugRequests,
  useDebugRegressions,
} from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { DebugGate } from './debug-gate';
import {
  WINDOWS,
  QUICK_FILTERS,
  SLOW_MS,
  matchesRegression,
  type DebugSelection,
} from './debug-search';

/**
 * One row per gateway-served request (ADR-127 PR-A).
 *
 * `route` is the template, not the expanded URL, so two requests to
 * /orders/1 and /orders/2 aggregate rather than filling the table — that is
 * the API's choice and the column header says so.
 *
 * `cold_boot` gets its own column because it is the platform's signature
 * cost: a slow request that woke the app is a different problem from a slow
 * request that did not, and the number alone cannot tell them apart.
 */

interface Row {
  id: string;
  route: string;
  method: string;
  status: number;
  latency: number;
  cold: boolean;
  received: string;
  deployment: string;
  trace: string;
}

/** Only windows the plan actually retains — the server clamps silently. */
export { WINDOWS } from './debug-search';

function statusColor(status: number): string {
  if (status >= 500) return 'var(--status-critical)';
  if (status >= 400) return 'var(--status-warning)';
  return 'var(--status-good)';
}

export function DebugRequests({ slug, search, onSelect }: { slug: string } & DebugSelection) {
  const since = search.debugWindow ?? '1h';
  const filter = search.debugFilter ?? 'all';
  const { data, isPending, error, refetch } = useDebugRequests(slug, since);
  const regressions = useDebugRegressions(filter === 'regressions' ? slug : '', since);
  const regressionError = filter === 'regressions' ? regressions.error : null;

  const rows: Row[] = (data?.requests ?? [])
    .filter((r) => {
      if (filter === 'failed') return r.status >= 400 && r.status < 600;
      if (filter === 'slow') return r.latency_ms >= SLOW_MS;
      if (filter === 'cold') return r.cold_boot === true;
      if (filter === 'regressions')
        return regressions.data?.regressions.some((item) => matchesRegression(r, item));
      return true;
    })
    .map((r) => ({
      id: r.id,
      route: r.route,
      method: r.method,
      status: r.status,
      latency: r.latency_ms,
      cold: r.cold_boot,
      received: r.received_at,
      deployment: r.deployment_id,
      trace: r.trace_id ?? '',
    }));

  const columns: Column<Row>[] = [
    {
      key: 'method',
      label: 'Method',
      width: 'w-24',
      render: (r) => <span className="font-mono text-xs">{r.method}</span>,
    },
    {
      key: 'route',
      label: 'Route template',
      render: (r) => <span className="font-mono text-xs">{r.route}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      width: 'w-24',
      render: (r) => <Pill label={String(r.status)} color={statusColor(r.status)} />,
    },
    {
      key: 'latency',
      label: 'Latency',
      numeric: true,
      width: 'w-28',
      render: (r) => <span className="[font-variant-numeric:tabular-nums]">{r.latency} ms</span>,
    },
    {
      key: 'cold',
      label: 'Cold',
      width: 'w-20',
      render: (r) =>
        r.cold ? (
          <Pill label="wake" color="var(--status-serious)" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'received',
      label: 'When',
      numeric: true,
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatRelative(Date.parse(r.received) || 0)}
        </span>
      ),
    },
  ];

  return (
    <DebugGate error={error ?? regressionError}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Quick filter
          <select
            aria-label="Quick filter"
            value={filter}
            onChange={(e) => onSelect({ debugFilter: e.target.value as typeof filter })}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            {QUICK_FILTERS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Failed: HTTP 4xx / 5xx. Slow: latency ≥ 1,000 ms. Cold start: recorded cold boot only.
          Regressions: matching release and route observations in this window.
        </p>
        <p className="text-xs text-muted-foreground">
          Sample: up to {DEBUG_REQUEST_SAMPLE_LIMIT} recent telemetry rows in the selected window
          across all routes. Quick and text filters apply only to this loaded sample; other matching
          requests may exist.
        </p>
        <label className="flex items-center gap-2 self-start text-xs text-muted-foreground">
          Window
          <select
            aria-label="Window"
            value={since}
            onChange={(e) => onSelect({ debugWindow: e.target.value as typeof since })}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          {data?.since && data.since !== since && (
            // The server clamps to the plan's retention. Say so rather than
            // labelling the table with a window it did not use.
            <span className="text-[color:var(--status-warning)]">
              plan retention capped this to {data.since}
            </span>
          )}
        </label>

        <ResourceTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'received', dir: 'desc' }}
          searchKeys={['route', 'method']}
          searchPlaceholder="Filter by route or method…"
          query={search.debugQuery ?? ''}
          onQueryChange={(debugQuery) => onSelect({ debugQuery: debugQuery || undefined })}
          emptyMessage={
            data?.requests.length
              ? `No requests match these filters in the loaded sample (up to ${DEBUG_REQUEST_SAMPLE_LIMIT} recent rows).`
              : 'No request rows were returned in this bounded sample.'
          }
          minWidth="min-w-[760px]"
          loading={isPending || (filter === 'regressions' && regressions.isPending)}
          error={error ?? regressionError}
          onRetry={() => {
            void refetch();
            if (filter === 'regressions') void regressions.refetch();
          }}
          onRowClick={(r) => onSelect({ request: r.id })}
        />
      </div>
    </DebugGate>
  );
}
