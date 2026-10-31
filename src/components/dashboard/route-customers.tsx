import { useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAppDeployments } from '@/lib/api/queries';
import {
  ROUTE_CUSTOMER_WINDOWS,
  useRouteCustomers,
  type RouteCustomerUsage,
  type RouteCustomerWindow,
} from '@/lib/api/request-audit';
import { Select } from '@/components/ui/field';
import { Timestamp } from './events/event-format';
import { PlanGated } from './plan-gated';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ResourceTable, type Column } from './resource-table';

const count = new Intl.NumberFormat('en-US');
const n = (value: number) => (
  <span className="[font-variant-numeric:tabular-nums]">{count.format(value)}</span>
);

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'not_found')
      return 'That deployment is no longer part of this app. Choose another.';
    if (error.code === 'capacity_unavailable')
      return 'Route customer usage is briefly unavailable. Try again in a moment.';
  }
  return errorMessage(error);
}

type Row = RouteCustomerUsage & { id: string };

// Route, requests and consumers stay in view on a phone; the identity split
// folds into the row's disclosure there.
const COLUMNS: Column<Row>[] = [
  {
    key: 'route',
    label: 'Route',
    render: (r) => (
      <span className="whitespace-nowrap font-mono text-xs">
        <span className="text-muted-foreground">{r.method}</span> {r.route}
      </span>
    ),
  },
  { key: 'requests', label: 'Requests', numeric: true, render: (r) => n(r.requests) },
  { key: 'consumer_count', label: 'Consumers', numeric: true, render: (r) => n(r.consumer_count) },
  {
    key: 'identified_requests',
    label: 'Identified',
    numeric: true,
    priority: 'secondary',
    render: (r) => n(r.identified_requests),
  },
  {
    key: 'anonymous_requests',
    label: 'Anonymous',
    numeric: true,
    priority: 'secondary',
    render: (r) => n(r.anonymous_requests),
  },
  {
    key: 'unresolved_identity_requests',
    label: 'Unresolved',
    numeric: true,
    priority: 'secondary',
    render: (r) => n(r.unresolved_identity_requests),
  },
  {
    key: 'platform_tenant_count',
    label: 'Tenants',
    numeric: true,
    priority: 'secondary',
    render: (r) => n(r.platform_tenant_count),
  },
  {
    key: 'last_observed_at',
    label: 'Last seen',
    priority: 'secondary',
    render: (r) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        <Timestamp iso={r.last_observed_at || undefined} />
      </span>
    ),
  },
];

/**
 * Which customers call each route of one deployment (faas
 * handlers_route_customers.go, docs/route-customer-impact.md). Read from the
 * retained debugger telemetry, so it carries that plan gate and retention, and
 * it is observed exposure only: never a billing total or proof a route is unused.
 */
export function RouteCustomersPanel({ slug }: { slug: string }) {
  const deployments = useAppDeployments(slug);
  const own = deployments.data?.pages.flatMap((page) => page.items) ?? [];
  const [chosen, setChosen] = useState('');
  const [since, setSince] = useState<RouteCustomerWindow>('24h');
  const [selected, setSelected] = useState('');
  // Derived, so a choice outside this app's list never reaches the query.
  const deploymentId = own.some((d) => d.id === chosen)
    ? chosen
    : (own.find((d) => d.status === 'live') ?? own[0])?.id;
  const usage = useRouteCustomers(slug, deploymentId ?? '', since);
  const listError = own.length === 0 ? deployments.error : undefined;
  const listPhase = queryPhase({
    error: listError,
    loading: deployments.isPending,
    isEmpty: own.length === 0,
  });
  const data = usage.data;
  const rows: Row[] = (data?.routes ?? []).map((r) => ({ ...r, id: `${r.method} ${r.route}` }));
  const phase = queryPhase({
    error: usage.error,
    loading: usage.isPending,
    isEmpty: rows.length === 0,
  });
  const detail = rows.find((r) => r.id === selected);

  return (
    <Panel
      title="Customers by route"
      description="Which API consumers and platform tenants called each route of one deployment, from retained request telemetry."
      actions={
        own.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Deployment"
              value={deploymentId}
              onChange={(e) => {
                setChosen(e.target.value);
                setSelected('');
              }}
              className="h-8 text-xs"
            >
              {own.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id.slice(0, 8)} · {d.status}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Lookback"
              value={since}
              onChange={(e) => setSince(e.target.value as RouteCustomerWindow)}
              className="h-8 text-xs"
            >
              {ROUTE_CUSTOMER_WINDOWS.map((w) => (
                <option key={w} value={w}>
                  Last {w}
                </option>
              ))}
            </Select>
          </div>
        ) : undefined
      }
    >
      {listPhase !== 'ready' ? (
        <InlinePhase
          phase={listPhase}
          error={listError}
          loadingMessage="Looking for deployments…"
          emptyMessage="No deployments to read yet."
          onRetry={() => void deployments.refetch()}
        />
      ) : (
        <PlanGated error={usage.error} feature="Customers by route">
          <div className="flex flex-col gap-3 text-sm">
            {phase === 'empty' ? (
              <p className="font-medium">
                No requests observed for this deployment in this window.
              </p>
            ) : phase !== 'ready' ? (
              <InlinePhase
                phase={phase}
                // The explained sentence replaces the API's for the codes above.
                error={usage.error ? new Error(explain(usage.error)) : undefined}
                loadingMessage="Loading route customers…"
                onRetry={() => void usage.refetch()}
              />
            ) : (
              <>
                <ResourceTable
                  rows={rows}
                  columns={COLUMNS}
                  initialSort={{ key: 'requests', dir: 'desc' }}
                  onRowClick={(r) => setSelected(r.id === selected ? '' : r.id)}
                  desktopMinWidth="md:min-w-[860px]"
                />
                {data?.routes_truncated && (
                  <p className="text-xs text-muted-foreground">
                    Showing the top {data.routes_limit} routes by requests; the rest were left out.
                  </p>
                )}
                {detail && <RouteDetail route={detail} limit={data?.customers_limit ?? 20} />}
              </>
            )}
            {(phase === 'ready' || phase === 'empty') && (
              <div className="space-y-1 text-xs text-muted-foreground">
                {data?.window_clamped && <p>The window was shortened to what your plan retains.</p>}
                <p>
                  Observed only: sampled, dropped and expired telemetry is not counted, so a route
                  with no observations is not proof it is unused. Consumer and tenant counts
                  overlap, so do not add them.
                  {phase === 'ready' && ' Select a route to see its customers.'}
                </p>
              </div>
            )}
          </div>
        </PlanGated>
      )}
    </Panel>
  );
}

function RouteDetail({ route, limit }: { route: Row; limit: number }) {
  const label = `Customers on ${route.method} ${route.route}`;
  return (
    <section aria-label={label} className="rounded-lg border border-border">
      <h3 className="border-b border-border px-4 py-2.5 font-mono text-xs">{label}</h3>
      {route.customers.length === 0 ? (
        <p className="px-4 py-3 text-muted-foreground">No identified customers on this route.</p>
      ) : (
        <ul className="divide-y divide-border">
          {route.customers.map((c) => (
            <li
              key={`${c.consumer_id ?? ''}/${c.platform_tenant_id ?? ''}`}
              className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5"
            >
              <span className="min-w-0 basis-full space-y-0.5 sm:flex-1 sm:basis-auto">
                <span className="block text-xs text-muted-foreground">
                  Consumer{' '}
                  <span className="break-all font-mono text-foreground">
                    {c.consumer_id ?? '—'}
                  </span>
                </span>
                <span className="block text-xs text-muted-foreground">
                  Tenant{' '}
                  <span className="break-all font-mono text-foreground">
                    {c.platform_tenant_id ?? '—'}
                  </span>
                </span>
              </span>
              <span>{n(c.requests)} requests</span>
              <span className="text-xs text-muted-foreground">
                <Timestamp iso={c.last_observed_at || undefined} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {route.customers_truncated && (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          {count.format(route.other_customer_requests)} requests from customers not listed (the top{' '}
          {limit} are shown).
        </p>
      )}
    </section>
  );
}
