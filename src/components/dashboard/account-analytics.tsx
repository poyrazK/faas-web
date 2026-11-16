import { AnalyticsBreakdown } from './analytics-breakdown';
import { AppAnalyticsPreview } from './app-analytics-preview';
import { appMetricNumber, metricValue, utcLabel } from './analytics-data';
import { useMetricInspector } from './metric-inspector';
import { METRIC_LABELS, type DetailMetric } from './metric-detail-search';
import { Select } from '@/components/ui/field';
import { useAccountSlo, useAppsMetrics, useAppsSlo, type AppsMetrics } from '@/lib/api/queries';
import { MAX_THROTTLE_APPS, projectThrottled, projectTotals } from './project-analytics';
import { inScope, useProjectScope } from '@/lib/project-scope';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { PlanGated } from './plan-gated';
import { InlinePhase, Panel, queryPhase, RangeSelector } from './primitives';
import { ResourceTable, type Column } from './resource-table';

/**
 * Account snapshots and ranked apps share a window. A row opens that app's
 * request history in the URL-backed inspector without leaving this page.
 */
export type AccountAnalyticsSearch = {
  window?: '24h' | '7d';
  trendApp?: string;
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

export function AccountAnalytics({
  search,
  onTrendChange,
}: {
  search: AccountAnalyticsSearch;
  onTrendChange?: (slug: string) => void;
}) {
  const window = search.window ?? '24h';
  const inspect = useMetricInspector();
  const [trendDraft, setTrendDraft] = useState('');
  const scope = useProjectScope();
  const scoped = Boolean(scope.project);
  // Inside a project the account summary is not read: its totals are built
  // from the project's apps instead (project-analytics.ts).
  const account = useAccountSlo(window, { enabled: !scoped });
  const metrics = useAppsMetrics(window);
  const data = account.data;
  const accountPhase = queryPhase({
    error: account.error,
    loading: account.isPending,
    isEmpty: !data,
  });
  const accountDegraded = Boolean(data && data.source !== 'prometheus');
  const appsDegraded = Boolean(metrics.data && metrics.data.source !== 'prometheus');
  const scopeLoading = Boolean(scope.project) && scope.appSlugs === null && !scope.settled;
  const appEntries = inScope(Object.entries(metrics.data?.apps ?? {}), scope, ([slug]) => slug);
  const appsPhase = queryPhase({
    error: metrics.error,
    loading: metrics.isPending || scopeLoading,
    isEmpty: !appsDegraded && appEntries.length === 0,
  });
  // Failed/degraded telemetry must not leave stale rows looking current.
  const rows: AppRow[] =
    appsPhase === 'ready' && !appsDegraded
      ? appEntries.map(([slug, value]) => ({
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
      render: (row) =>
        row.source === 'prometheus' && row.request_count > 0
          ? `${row.error_rate_pct.toFixed(2)}%`
          : '—',
    },
    {
      key: 'cold_start_pct',
      label: 'Cold boots',
      numeric: true,
      render: (row) =>
        row.source === 'prometheus' && row.request_count > 0
          ? `${row.cold_start_pct.toFixed(2)}%`
          : '—',
    },
    {
      key: 'latency_p50_ms',
      label: 'p50',
      numeric: true,
      render: (row) =>
        row.source === 'prometheus' && row.request_count > 0 ? `${row.latency_p50_ms} ms` : '—',
    },
    {
      key: 'latency_p95_ms',
      label: 'p95',
      numeric: true,
      render: (row) =>
        row.source === 'prometheus' && row.request_count > 0 ? `${row.latency_p95_ms} ms` : '—',
    },
    {
      key: 'latency_p99_ms',
      label: 'p99',
      numeric: true,
      render: (row) =>
        row.source === 'prometheus' && row.request_count > 0 ? `${row.latency_p99_ms} ms` : '—',
    },
    {
      key: 'wake_p95_ms',
      label: 'Wake p95 (fleet)',
      numeric: true,
      render: (row) =>
        row.source === 'prometheus' &&
        row.wake_p95_ms > 0 &&
        (row.wake_samples === undefined || row.wake_samples >= 20)
          ? `${row.wake_p95_ms} ms`
          : '—',
    },
  ];

  // A project's totals: counts added across its apps, rates weighted by
  // traffic, the slowest app instead of a combined percentile.
  const totals = projectTotals(appEntries);
  const throttleSlugs =
    scoped && appEntries.length <= MAX_THROTTLE_APPS ? appEntries.map(([slug]) => slug) : [];
  const throttle = projectThrottled(appEntries.length, useAppsSlo(throttleSlugs, window, scoped));
  const projectKnown = appsPhase === 'ready' && !appsDegraded && totals.known;
  const tilePhase = scoped ? appsPhase : accountPhase;
  const accountKnown = scoped ? projectKnown : accountPhase === 'ready' && !accountDegraded;
  const sorted = [...rows].sort((a, b) => b.request_count - a.request_count);
  const trend = sorted.some((row) => row.slug === (search.trendApp ?? trendDraft))
    ? (search.trendApp ?? trendDraft)
    : (sorted[0]?.slug ?? '');
  const appWord = (n: number) => `${n} ${n === 1 ? 'app' : 'apps'}`;
  const traffic: { id: DetailMetric; value: number | undefined; note: string }[] = scoped
    ? [
        {
          id: 'requests',
          value: totals.requests,
          note: `Across ${appWord(totals.apps)} in ${scope.label}`,
        },
        { id: 'errors', value: totals.errors, note: 'Estimated from each app’s 5xx rate' },
        {
          id: 'error_rate',
          value: totals.errorRatePct ?? undefined,
          note: `Share of ${scope.label}’s requests returning 5xx`,
        },
        {
          id: 'cold_rate',
          value: totals.coldRatePct ?? undefined,
          note: 'Requests that started an instance',
        },
      ]
    : [
        { id: 'requests', value: data?.requests_total, note: 'Across all apps' },
        {
          id: 'errors',
          value: data ? Math.round((data.requests_total * data.error_rate_pct) / 100) : undefined,
          note: 'Estimated from the 5xx rate',
        },
        {
          id: 'error_rate',
          value: data?.requests_total ? data.error_rate_pct : undefined,
          note: 'Share of requests returning 5xx',
        },
        {
          id: 'cold_rate',
          value: data?.requests_total ? data.cold_boot_rate_pct : undefined,
          note: 'Requests that started an instance',
        },
      ];
  const latency: typeof traffic = [
    {
      id: 'p50',
      value: data?.requests_total ? data.request_duration.p50_ms : undefined,
      note: 'Half of successful responses were faster',
    },
    {
      id: 'p95',
      value: data?.requests_total ? data.request_duration.p95_ms : undefined,
      note: '95% of successful responses were faster',
    },
    {
      id: 'p99',
      value: data?.requests_total ? data.request_duration.p99_ms : undefined,
      note: '99% of successful responses were faster',
    },
    { id: 'throttled', value: data?.throttled_total, note: 'Requests limited by the platform' },
  ];
  const tiles = (items: typeof traffic) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={`View ${METRIC_LABELS[item.id]} details`}
          onClick={() =>
            inspect({ metric: item.id, since: window, source: scoped ? 'rollup' : 'slo' })
          }
          className="group surface rounded-[1.25rem] bg-card p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand"
        >
          <p className="text-xs font-medium text-muted-foreground">{METRIC_LABELS[item.id]}</p>
          <p className="mt-3 text-[26px] font-semibold tracking-tight tabular-nums">
            {tilePhase === 'loading'
              ? 'Loading…'
              : accountKnown
                ? metricValue(item.id, item.value, true)
                : '—'}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{item.note}</p>
        </button>
      ))}
    </div>
  );
  const projectLimits = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <button
        type="button"
        aria-label="View response time details by app"
        onClick={() => inspect({ metric: 'p95', since: window, source: 'rollup' })}
        className="group surface rounded-[1.25rem] bg-card p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand"
      >
        <p className="text-xs font-medium text-muted-foreground">Slowest app · p95</p>
        <p className="mt-3 text-[26px] font-semibold tracking-tight tabular-nums">
          {tilePhase === 'loading'
            ? 'Loading…'
            : projectKnown && totals.slowest
              ? `${totals.slowest.p95Ms} ms`
              : '—'}
        </p>
        <p className="mt-3 truncate text-xs leading-relaxed text-muted-foreground">
          {projectKnown && totals.slowest
            ? `${totals.slowest.slug}, the slowest of ${appWord(totals.apps)}`
            : 'Response times need traffic'}
        </p>
      </button>
      <div className="surface rounded-[1.25rem] bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">{METRIC_LABELS.throttled}</p>
        <p className="mt-3 text-[26px] font-semibold tracking-tight tabular-nums">
          {throttle.kind === 'loading'
            ? 'Loading…'
            : throttle.kind === 'known'
              ? metricValue('throttled', throttle.total, true)
              : '—'}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {throttle.kind === 'unknown' && throttle.reason === 'too-many'
            ? `Not totalled for more than ${MAX_THROTTLE_APPS} apps`
            : throttle.kind === 'unknown'
              ? 'Some apps’ limits couldn’t be read'
              : 'Requests limited by the platform'}
        </p>
      </div>
    </div>
  );
  const ranked = (metric: DetailMetric) =>
    sorted
      .filter((row) => row.source === 'prometheus')
      .map((row) => ({
        id: row.slug,
        label: row.slug,
        value: appMetricNumber(metric, row) ?? 0,
        formatted: metricValue(metric, appMetricNumber(metric, row), true),
        onSelect: () => inspect({ metric, app: row.slug, since: window }),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Account overview" className="flex flex-col gap-5">
        <PlanGated
          error={scoped ? metrics.error : account.error}
          feature={scoped ? 'Per-app metrics' : 'Account analytics'}
        >
          {scoped ? (
            <>
              {appsPhase !== 'ready' && (
                <InlinePhase
                  phase={appsPhase}
                  error={metrics.error}
                  loadingMessage={`Loading ${scope.label} analytics…`}
                  emptyMessage={`No ${scope.label} apps in this window.`}
                  onRetry={() => void metrics.refetch()}
                />
              )}
              {appsPhase === 'ready' && (appsDegraded || !totals.known) && (
                <p role="status" className="text-sm text-muted-foreground">
                  {appsDegraded
                    ? `Metrics source: ${metrics.data?.source}. ${scope.label}’s figures are unavailable.`
                    : `${appWord(totals.unavailable)}’s figures are unavailable, so ${scope.label}’s totals aren’t shown.`}
                </p>
              )}
            </>
          ) : (
            <InlinePhase
              phase={accountPhase}
              error={account.error}
              loadingMessage="Loading account analytics…"
              emptyMessage="No account analytics are available yet."
              onRetry={() => void account.refetch()}
            />
          )}
          {!scoped && accountPhase === 'ready' && accountDegraded && (
            <p role="status" className="text-sm text-muted-foreground">
              Metrics source: {data?.source}. Account figures are unavailable.
            </p>
          )}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Traffic</h2>
            {tiles(traffic)}
          </div>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Response times and limits</h2>
            {scoped ? projectLimits : tiles(latency)}
          </div>
          {scoped ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {scope.label}’s totals for the last {window}, added up from its {appWord(totals.apps)}
              ’ figures. Response times can’t be combined across apps, so the slowest app is shown;
              each app’s are in the table below.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Account totals for the last {window}. Response times cover successful (2xx) requests.{' '}
              {data?.as_of ? `Updated ${utcLabel(data.as_of, true)} UTC. ` : ''}Account history and
              previous-period comparisons are not available.
            </p>
          )}
          {scoped && projectKnown && totals.requests === 0 && (
            <p className="text-sm text-muted-foreground">
              No requests to {scope.label} in this window. Rates and response times need traffic
              before they can be measured.
            </p>
          )}
          {!scoped && accountKnown && data?.requests_total === 0 && (
            <p className="text-sm text-muted-foreground">
              No requests in this window. Response times and rates need traffic before they can be
              measured.
            </p>
          )}
        </PlanGated>
      </section>
      {appsPhase === 'ready' && !appsDegraded && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <section
              aria-label="Top apps by requests"
              className="surface rounded-[1.25rem] bg-card p-4"
            >
              <h2 className="text-sm font-semibold">Top apps by requests</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Request totals in this window. Select an app to explore.
              </p>
              <AnalyticsBreakdown rows={ranked('requests')} label="Apps ranked by requests" />
            </section>
            <section aria-label="Errors by app" className="surface rounded-[1.25rem] bg-card p-4">
              <h2 className="text-sm font-semibold">Errors by app</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Estimated from each app’s request count and 5xx rate.
              </p>
              <AnalyticsBreakdown
                rows={ranked('errors')}
                label="Apps ranked by errors"
                color="red"
              />
            </section>
          </div>
          {trend && (
            <section aria-label="App history" className="space-y-4 well rounded-xl bg-muted/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">App history</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Explore one app’s real hourly history for the selected window.
                  </p>
                </div>
                <Select
                  aria-label="App history scope"
                  value={trend}
                  onChange={(event) => {
                    setTrendDraft(event.target.value);
                    onTrendChange?.(event.target.value);
                  }}
                  className="max-w-56"
                >
                  {sorted.map((row) => (
                    <option key={row.slug} value={row.slug}>
                      {row.slug}
                    </option>
                  ))}
                </Select>
              </div>
              <AppAnalyticsPreview
                slug={trend}
                since={window}
                storageKey="gregale.analytics.account-history.order"
              />
            </section>
          )}
        </>
      )}
      <section aria-label="Apps">
        <PlanGated error={metrics.error} feature="Per-app metrics">
          <Panel
            title="Apps"
            help="Latency covers 2xx responses. Wake p95 is fleet-wide. Select an app to inspect its requests here."
            padded={appsPhase === 'ready' && appsDegraded}
          >
            {appsPhase === 'ready' && appsDegraded ? (
              <p role="status" className="text-sm text-muted-foreground">
                Metrics source: {metrics.data?.source}. App metrics are unavailable for this window.
              </p>
            ) : (
              <ResourceTable
                rows={rows}
                columns={columns}
                initialSort={{ key: 'request_count', dir: 'desc' }}
                searchKeys={['slug']}
                searchPlaceholder="Filter apps…"
                emptyMessage={
                  scope.project
                    ? `No ${scope.label} apps in this window.`
                    : 'No apps in this window.'
                }
                loading={appsPhase === 'loading'}
                error={metrics.error}
                onRetry={() => void metrics.refetch()}
                onRowClick={(row) => inspect({ metric: 'requests', app: row.slug, since: window })}
              />
            )}
          </Panel>
        </PlanGated>
      </section>
    </div>
  );
}
