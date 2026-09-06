import { useState } from 'react';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useDebugRegressions } from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { DebugGate } from './debug-gate';
import { WINDOWS } from './debug-requests';

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

export function DebugRegressions({ slug }: { slug: string }) {
  const [since, setSince] = useState<string>('24h');
  const { data, isPending, error, refetch } = useDebugRegressions(slug, since);

  const rows: Row[] = (data?.regressions ?? []).map((r, i) => ({
    // The API keys a regression by (deployment, route), not by an id.
    id: `${r.deployment_id}:${r.route}:${i}`,
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
            onChange={(e) => setSince(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>

        <ResourceTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'factor', dir: 'desc' }}
          searchKeys={['route']}
          searchPlaceholder="Filter by route…"
          emptyMessage="Nothing has regressed in this window."
          minWidth="min-w-[820px]"
          loading={isPending}
          error={error}
          onRetry={() => void refetch()}
        />
      </div>
    </DebugGate>
  );
}
