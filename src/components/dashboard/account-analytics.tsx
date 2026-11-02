import type { Dispatch, SetStateAction } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAccountSlo, useAppsMetrics, type AppsMetrics } from '@/lib/api/queries';
import { InlinePhase, Panel, RangeSelector, Stats, StatTile, queryPhase } from './primitives';
import { PlanGated } from './plan-gated';
import { ResourceTable, type Column } from './resource-table';

/**
 * The account's traffic, and every app's, over one window. One app's detail
 * (routes, health, wakes, dependencies) is that app's Metrics section: a row
 * opens it.
 */
export type AccountAnalyticsSearch = {
  window?: '24h' | '7d';
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

export function AccountAnalytics({ search }: { search: AccountAnalyticsSearch }) {
  const window = search.window ?? '24h';
  const navigate = useNavigate();
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
  const columns: Column<AppRow>[] = [
    {
      key: 'slug',
      label: 'App',
      render: (row) => <span className="font-mono">{row.slug}</span>,
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
    <div className="flex flex-col gap-5">
      <section aria-label="Account overview" className="flex flex-col gap-3">
        <PlanGated error={account.error} feature="Account analytics">
          <InlinePhase
            phase={accountPhase}
            error={account.error}
            loadingMessage="Loading account analytics…"
            emptyMessage="No account analytics are available yet."
          />
          {accountPhase === 'ready' && accountDegraded && (
            <p role="status" className="text-sm text-muted-foreground">
              Metrics source: {data?.source}
            </p>
          )}
          <Stats columns={4}>
            <StatTile label="Requests" value={data?.requests_total} state={accountTile} />
            <StatTile
              label="Errors"
              value={
                data ? Math.round((data.requests_total * data.error_rate_pct) / 100) : undefined
              }
              state={accountTile}
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
          </Stats>
        </PlanGated>
      </section>

      <section aria-label="Apps">
        <PlanGated error={metrics.error} feature="Per-app metrics">
          <Panel
            title="Apps"
            help="Latency covers 2xx responses. Wake p95 is the fleet-wide figure, the same on every row. Open an app for its routes, health and wakes."
            padded={appsPhase === 'ready' && appsDegraded}
          >
            {appsPhase === 'ready' && appsDegraded ? (
              <p role="status" className="text-sm text-muted-foreground">
                Metrics source: {metrics.data?.source}. App metrics are unavailable for this
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
                onRowClick={(row) =>
                  void navigate({
                    to: '/dashboard/apps/$appSlug',
                    params: { appSlug: row.slug },
                    search: { tab: 'Metrics' },
                  })
                }
              />
            )}
          </Panel>
        </PlanGated>
      </section>
    </div>
  );
}
