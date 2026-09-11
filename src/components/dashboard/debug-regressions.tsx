import { Button } from '@/components/ui/button';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useDebugRegressions, useDebugRequests } from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { DebugGate } from './debug-gate';
import {
  WINDOWS,
  regressionKey,
  matchesRegression,
  type DebugSelection,
  type Regression,
} from './debug-search';
import { InlinePhase, queryPhase } from './primitives';

/**
 * Routes the platform has decided are slower than their own baseline.
 *
 * The judgement is the API's, not ours: it ships `p95_ms`, the baseline it
 * compared against, and the ratio between them. Rendering all three keeps the
 * claim checkable — a factor with no numbers behind it asks to be trusted.
 *
 * `affected_count` is the reason a small factor can still matter, so it sits
 * next to the factor rather than behind a detail view.
 */

interface Row {
  id: string;
  route: string;
  p95: number;
  base: number;
  factor: string;
  affected: number;
  firstSeen: string;
  lastSeen: string;
}

export function DebugRegressions({ slug, search, onSelect }: { slug: string } & DebugSelection) {
  const since = search.debugWindow ?? '24h';
  const { data, isPending, error, refetch } = useDebugRegressions(slug, since);
  const selected = data?.regressions.find((item) => regressionKey(item) === search.regression);

  const rows: Row[] = (data?.regressions ?? []).map((r) => ({
    // The API keys a regression by (deployment, route), not by an id.
    id: regressionKey(r),
    route: r.route,
    p95: r.p95_ms,
    base: r.p95_base_ms,
    factor: r.regression_factor,
    affected: r.affected_count,
    firstSeen: r.first_detected_at,
    lastSeen: r.last_detected_at,
  }));

  const columns: Column<Row>[] = [
    {
      key: 'route',
      label: 'Route template',
      render: (r) => <span className="font-mono text-xs">{r.route}</span>,
    },
    {
      key: 'factor',
      label: 'Slower by',
      numeric: true,
      width: 'w-28',
      render: (r) => (
        <span
          className="[font-variant-numeric:tabular-nums] font-medium"
          style={{ color: 'var(--status-critical)' }}
        >
          {r.factor}×
        </span>
      ),
    },
    {
      key: 'p95',
      label: 'p95 now',
      numeric: true,
      width: 'w-28',
      render: (r) => <span className="[font-variant-numeric:tabular-nums]">{r.p95} ms</span>,
    },
    {
      key: 'base',
      label: 'p95 baseline',
      numeric: true,
      width: 'w-32',
      render: (r) => (
        <span className="[font-variant-numeric:tabular-nums] text-muted-foreground">
          {r.base} ms
        </span>
      ),
    },
    {
      key: 'affected',
      label: 'Requests',
      numeric: true,
      width: 'w-28',
      render: (r) => <span className="[font-variant-numeric:tabular-nums]">{r.affected}</span>,
    },
    {
      key: 'lastSeen',
      label: 'Last seen',
      numeric: true,
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatRelative(Date.parse(r.lastSeen) || 0)}
        </span>
      ),
    },
  ];

  return (
    <DebugGate error={error}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 self-start text-xs text-muted-foreground">
          Window
          <select
            aria-label="Regression window"
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
            <span>Plan retention capped this to {data.since}.</span>
          )}
        </label>

        <ResourceTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'factor', dir: 'desc' }}
          searchKeys={['route']}
          searchPlaceholder="Filter by route…"
          query={search.debugQuery ?? ''}
          onQueryChange={(debugQuery) => onSelect({ debugQuery: debugQuery || undefined })}
          emptyMessage="Nothing has regressed in this window."
          minWidth="min-w-[820px]"
          loading={isPending}
          error={error}
          onRetry={() => void refetch()}
          onRowClick={(row) => onSelect({ regression: row.id })}
        />
        {search.regression && !isPending && !error && (
          <section aria-label="Regression details" className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Regression details</h3>
              <Button size="xs" variant="ghost" onClick={() => onSelect({ regression: undefined })}>
                Close regression
              </Button>
            </div>
            {selected ? (
              <RegressionDetail
                slug={slug}
                regression={selected}
                since={since}
                onSelect={onSelect}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                The selected regression is not in this window. Widen the window or select another
                observation.
              </p>
            )}
          </section>
        )}
      </div>
    </DebugGate>
  );
}

function RegressionDetail({
  slug,
  regression,
  since,
  onSelect,
}: {
  slug: string;
  regression: Regression;
  since: string;
  onSelect: DebugSelection['onSelect'];
}) {
  const requests = useDebugRequests(slug, since);
  const matched = (requests.data?.requests ?? []).filter((request) =>
    matchesRegression(request, regression)
  );
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        {[
          ['Affected route', regression.route],
          ['Current deployment', regression.deployment_id],
          ['Current p95', `${regression.p95_ms} ms`],
          ['Baseline p95', `${regression.p95_base_ms} ms`],
          ['Change', `${regression.regression_factor}×`],
          ['Affected requests', regression.affected_count],
          ['First occurrence', regression.first_detected_at],
          ['Last occurrence', regression.last_detected_at],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        The baseline deployment ID is not returned. Choose deployment A to compare with this current
        deployment (B).
      </p>
      <Button
        className="self-start"
        size="sm"
        variant="outline"
        onClick={() =>
          onSelect({
            debugView: 'compare',
            debugSource: undefined,
            debugMirror: regression.deployment_id,
            debugRoute: regression.route,
            debugWindow: since as DebugSelection['search']['debugWindow'],
          })
        }
      >
        Compare this deployment
      </Button>
      <a
        className="text-sm underline"
        href={`/dashboard/deployments?${new URLSearchParams({ deployment: regression.deployment_id })}`}
      >
        Open affected release
      </a>
      <h4 className="text-sm font-medium">Requests on this release and route</h4>
      <p className="text-xs text-muted-foreground">
        Matching retained telemetry in the selected window; individual membership in the regression
        is confirmed in request evidence. This list may cover fewer requests than the aggregate
        count.
      </p>
      {requests.error || requests.isPending ? (
        <>
          <InlinePhase
            phase={queryPhase({ error: requests.error, loading: requests.isPending })}
            error={requests.error}
          />
          {requests.error && (
            <Button size="xs" onClick={() => void requests.refetch()}>
              Retry affected requests
            </Button>
          )}
        </>
      ) : matched.length ? (
        <ul className="flex flex-col gap-2">
          {matched.map((request) => (
            <li key={request.id}>
              <Button size="xs" variant="ghost" onClick={() => onSelect({ request: request.id })}>
                {request.id} · {request.status} · {request.latency_ms} ms
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No matching request rows are retained in this window.
        </p>
      )}
    </div>
  );
}
