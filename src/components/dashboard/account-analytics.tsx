import type { Dispatch, SetStateAction } from 'react';
import {
  useAccountSlo,
  useAppsMetrics,
  type AnalyticsGroupBy,
  type AppAnalyticsTimeseriesOptions,
  type AppsMetrics,
} from '@/lib/api/queries';
import { InlinePhase, Panel, RangeSelector, StatTile, queryPhase } from './primitives';
import { PlanGated } from './plan-gated';
import { ResourceTable, type Column } from './resource-table';
import { AppAnalyticsBody } from './app-analytics';
import { SloPanel } from './app-core-panels';
import { WakeTimelinePanel } from './app-insights';

export type AccountAnalyticsSearch = {
  app?: string;
  window?: '24h' | '7d';
  group?: AnalyticsGroupBy;
  route?: string;
  method?: AppAnalyticsTimeseriesOptions['method'];
};

type SearchProps = {
  search: AccountAnalyticsSearch;
  setSearch: Dispatch<SetStateAction<AccountAnalyticsSearch>>;
};
type AppRow = NonNullable<AppsMetrics['apps']>[string] & { id: string; slug: string };

export function AnalyticsWindowSelector({ search, setSearch }: SearchProps) {
  return (
    <RangeSelector
      value={search.window ?? '24h'}
      options={[
        { key: '24h', label: '24h' },
        { key: '7d', label: '7d' },
      ]}
      onChange={(window) => setSearch((previous) => ({ ...previous, window }))}
    />
  );
}

export function AccountAnalytics({ search, setSearch }: SearchProps) {
  const window = search.window ?? '24h';
  const account = useAccountSlo(window);
  const metrics = useAppsMetrics(window);
  const data = account.data;
  const accountPhase = queryPhase({
    error: account.error,
    loading: account.isPending,
    isEmpty: !data,
  });
  const accountDegraded = Boolean(data && data.source !== 'prometheus');
  const accountTile =
    accountPhase === 'loading'
      ? 'loading'
      : accountPhase === 'ready' && !accountDegraded
        ? 'ready'
        : 'unavailable';
  const appsDegraded = Boolean(metrics.data && metrics.data.source !== 'prometheus');
  const appsPhase = queryPhase({
    error: metrics.error,
    loading: metrics.isPending,
    isEmpty: !appsDegraded && Object.keys(metrics.data?.apps ?? {}).length === 0,
  });
  // Failed/degraded telemetry must not leave stale rows looking current.
  const rows: AppRow[] =
    appsPhase === 'ready' && !appsDegraded
      ? Object.entries(metrics.data?.apps ?? {}).map(([slug, value]) => ({
          ...value,
          id: slug,
          slug,
        }))
      : [];
  const slug = rows.find((row) => row.slug === search.app)?.slug ?? rows[0]?.slug;
  const group = search.group ?? 'route';
  const columns: Column<AppRow>[] = [
    {
      key: 'slug',
      label: 'App',
      render: (row) => (
        <span className="inline-flex items-center gap-2 font-mono">
          {row.slug}
          {row.slug === slug && (
            <span className="rounded border border-brand/30 bg-brand/10 px-1.5 py-0.5 font-sans text-xs text-brand">
              Selected
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'request_count',
      label: 'Requests',
      numeric: true,
      render: (row) => (row.source === 'prometheus' ? row.request_count.toLocaleString() : '—'),
    },
    {
      key: 'error_rate_pct',
      label: 'Error rate',
      numeric: true,
      render: (row) => (row.source === 'prometheus' ? `${row.error_rate_pct.toFixed(2)}%` : '—'),
    },
    {
      key: 'cold_start_pct',
      label: 'Cold boots',
      numeric: true,
      render: (row) => (row.source === 'prometheus' ? `${row.cold_start_pct.toFixed(2)}%` : '—'),
    },
    {
      key: 'latency_p50_ms',
      label: 'p50',
      numeric: true,
      render: (row) => (row.source === 'prometheus' ? `${row.latency_p50_ms} ms` : '—'),
    },
    {
      key: 'latency_p95_ms',
      label: 'p95',
      numeric: true,
      render: (row) => (row.source === 'prometheus' ? `${row.latency_p95_ms} ms` : '—'),
    },
    {
      key: 'latency_p99_ms',
      label: 'p99',
      numeric: true,
      render: (row) => (row.source === 'prometheus' ? `${row.latency_p99_ms} ms` : '—'),
    },
    {
      key: 'wake_p95_ms',
      label: 'Wake p95 (fleet)',
      numeric: true,
      render: (row) => (row.source === 'prometheus' ? `${row.wake_p95_ms} ms` : '—'),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Account overview" className="flex flex-col gap-4">
        <PlanGated error={account.error} feature="Account analytics">
          <InlinePhase
            phase={accountPhase}
            error={account.error}
            loadingMessage="Loading account analytics…"
            emptyMessage="No account analytics are available yet."
          />
          {accountPhase === 'ready' && accountDegraded && (
            <p role="status" className="text-sm text-muted-foreground">
              Telemetry source: {data?.source}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Requests" value={data?.requests_total} state={accountTile} />
            <StatTile
              label="Errors"
              value={
                data ? Math.round((data.requests_total * data.error_rate_pct) / 100) : undefined
              }
              state={accountTile}
              note="Derived from account requests and error rate."
            />
            <StatTile
              label="Error rate"
              value={data?.error_rate_pct.toFixed(2)}
              unit="%"
              state={accountTile}
            />
            <StatTile
              label="Cold boots"
              value={data?.cold_boot_rate_pct.toFixed(2)}
              unit="%"
              state={accountTile}
            />
            <StatTile
              label="p50"
              value={data?.request_duration.p50_ms}
              unit="ms"
              state={accountTile}
            />
            <StatTile
              label="p95"
              value={data?.request_duration.p95_ms}
              unit="ms"
              state={accountTile}
            />
            <StatTile
              label="p99"
              value={data?.request_duration.p99_ms}
              unit="ms"
              state={accountTile}
            />
            <StatTile label="Throttled" value={data?.throttled_total} state={accountTile} />
          </div>
        </PlanGated>
      </section>

      <section aria-label="Apps">
        <PlanGated error={metrics.error} feature="Per-app metrics">
          <Panel
            title="Apps"
            description="Select an app to inspect its requests and routes. Latency covers 2xx traffic; wake p95 is the fleet figure."
          >
            {appsPhase === 'ready' && appsDegraded ? (
              <p role="status" className="text-sm text-muted-foreground">
                Telemetry source: {metrics.data?.source}. App metrics are unavailable for this
                window.
              </p>
            ) : (
              <ResourceTable
                rows={rows}
                columns={columns}
                initialSort={{ key: 'request_count', dir: 'desc' }}
                searchKeys={['slug']}
                searchPlaceholder="Filter apps…"
                emptyMessage="No apps in this window."
                loading={appsPhase === 'loading'}
                error={metrics.error}
                onRetry={() => void metrics.refetch()}
                onRowClick={(row) => setSearch((previous) => ({ ...previous, app: row.slug }))}
              />
            )}
          </Panel>
        </PlanGated>
      </section>

      {slug && (
        <section aria-label={`App analytics: ${slug}`} className="flex flex-col gap-4">
          <div className="flex items-baseline gap-3 border-b border-border pb-3">
            <span className="label-mono text-muted-foreground">Selected app</span>
            <h2 className="font-mono text-lg font-medium">{slug}</h2>
          </div>
          <AppAnalyticsBody
            slug={slug}
            since={window}
            groupBy={group}
            route={search.route}
            method={search.method}
            showWindowSelector={false}
            onSinceChange={(since) => {
              if (since === '24h' || since === '7d')
                setSearch((previous) => ({ ...previous, window: since }));
            }}
            onGroupByChange={(next) => setSearch((previous) => ({ ...previous, group: next }))}
            onRouteChange={(route, method) =>
              setSearch((previous) => ({
                ...previous,
                route: route && method ? route : undefined,
                method: route && method ? method : undefined,
              }))
            }
          />
          <SloPanel key={slug} slug={slug} />
          <WakeTimelinePanel slug={slug} />
        </section>
      )}
    </div>
  );
}
