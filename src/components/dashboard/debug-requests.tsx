import { useState } from 'react';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useDebugRequests } from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { DebugGate } from './debug-gate';

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
export const WINDOWS = ['1h', '6h', '24h', '72h'] as const;

function statusColor(status: number): string {
  if (status >= 500) return 'var(--status-critical)';
  if (status >= 400) return 'var(--status-warning)';
  return 'var(--status-good)';
}

export function DebugRequests({ slug }: { slug: string }) {
  const [since, setSince] = useState<string>('1h');
  const { data, isPending, error, refetch } = useDebugRequests(slug, since);

  const rows: Row[] = (data?.requests ?? []).map((r) => ({
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
    <DebugGate error={error}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 self-start text-xs text-muted-foreground">
          Window
          <select
            aria-label="Window"
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
          emptyMessage="No requests recorded in this window."
          minWidth="min-w-[760px]"
          loading={isPending}
          error={error}
          onRetry={() => void refetch()}
        />
      </div>
    </DebugGate>
  );
}
