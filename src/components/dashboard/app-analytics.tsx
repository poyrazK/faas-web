import { useMetricInspector } from './metric-inspector';
import { isDetailMetric } from './metric-detail-search';
import { utcLabel, incompleteTelemetry } from './analytics-data';
import { AnalyticsGrid, chosenCards, scalarCards, type AnalyticsPoint } from './analytics-grid';
import { rangeHalfLabel } from './range-picker';
import { useState, type KeyboardEvent } from 'react';
import { TimeChart } from './kit/chart';
import { SegmentedControl } from './tabs';
import { Select } from '@/components/ui/field';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { isPlanGate, PlanGated } from '@/components/dashboard/plan-gated';
import { Pill } from '@/components/dashboard/resource-table';
import {
  useAppAnalytics,
  useAppAnalyticsTimeseries,
  type AnalyticsGroupBy,
} from '@/lib/api/queries';
import {
  ANALYTICS_GROUPS,
  WINDOWS,
  type AnalyticsMethod,
  type AppAnalyticsSearch,
} from './app-analytics-search';
import { HelpTip } from './kit/help-tip';

export { ANALYTICS_GROUPS, validateAppAnalyticsSearch } from './app-analytics-search';
export type { AppAnalyticsSearch } from './app-analytics-search';

/**
 * What the hourly chart plots. Every series comes from the same zero-filled
 * hourly buckets. Latency leaves out hours with no requests: a zero-filled
 * bucket has no latency, and plotting 0 ms would invent a fast hour.
 */
const CHART_METRICS = {
  traffic: {
    label: 'Traffic',
    config: {
      requests: { label: 'Requests', color: 'green' as const },
      error_requests: { label: 'Errors', color: 'red' as const },
    },
  },
  latency: {
    label: 'Latency',
    config: {
      p50_ms: { label: 'p50 ms', color: 'green' as const },
      p95_ms: { label: 'p95 ms', color: 'orange' as const },
      p99_ms: { label: 'p99 ms', color: 'red' as const },
    },
  },
  cold: {
    label: 'Cold starts',
    config: { cold_boots: { label: 'Cold starts', color: 'blue' as const } },
  },
} as const;
type ChartMetric = keyof typeof CHART_METRICS;

export type AppAnalyticsBodyProps = {
  slug: string;
  since: string;
  groupBy: AnalyticsGroupBy;
  route?: string;
  method?: AnalyticsMethod;
  /** Account analytics owns the shared window in its page header. */
  showWindowSelector?: boolean;
  onSinceChange: (since: string) => void;
  onGroupByChange: (groupBy: AnalyticsGroupBy) => void;
  onRouteChange: (route: string | undefined, method: AnalyticsMethod | undefined) => void;
};

const hourLabel = utcLabel;

export function AppAnalyticsBody({
  slug,
  since,
  groupBy,
  route,
  method,
  showWindowSelector = true,
  onSinceChange,
  onGroupByChange,
  onRouteChange,
}: AppAnalyticsBodyProps) {
  const inspect = useMetricInspector();
  const analytics = useAppAnalytics(slug, since, groupBy);
  const hasRouteFilter = groupBy === 'route' && Boolean(route && method);
  const series = useAppAnalyticsTimeseries(slug, since, {
    route: hasRouteFilter ? route : undefined,
    method: hasRouteFilter ? method : undefined,
    groupBy,
  });
  const data = analytics.data;
  const enabled = Boolean(slug);
  const planGateError = [analytics.error, series.error].find(isPlanGate);
  const [metric, setMetric] = useState<ChartMetric>('traffic');
  const [picking, setPicking] = useState(false);
  const points = (series.data?.points ?? []).map((point) => ({
    at: hourLabel(point.start),
    requests: point.requests,
    error_requests: point.error_requests,
    p50_ms: point.requests ? point.p50_ms : null,
    p95_ms: point.requests ? point.p95_ms : null,
    p99_ms: point.requests ? point.p99_ms : null,
    cold_boots: point.cold_boots,
  }));
  const inspectMetric = (selected: string) => {
    if (isDetailMetric(selected))
      inspect({
        metric: selected,
        app: slug,
        since: series.data?.from ?? since,
        until: series.data?.until,
        route: hasRouteFilter ? route : undefined,
        method: hasRouteFilter ? method : undefined,
        group: groupBy,
      });
  };
  const chart = CHART_METRICS[metric];
  const analyticsPhase = queryPhase({
    error: analytics.error,
    loading: enabled && analytics.isPending,
    isEmpty: !data,
  });
  const seriesPhase = queryPhase({
    error: series.error,
    loading: enabled && series.isPending,
    // Preserve idle buckets as gaps in latency, keeping their place on the time axis.
    isEmpty: (series.data?.points ?? []).length === 0,
  });
  const groupsPhase = queryPhase({
    error: analytics.error,
    loading: enabled && analytics.isPending,
    isEmpty: (data?.groups.length ?? 0) === 0,
  });

  const changeGroup = (next: AnalyticsGroupBy) => {
    onGroupByChange(next);
    if (next !== 'route') onRouteChange(undefined, undefined);
  };
  const selectRoute = (nextRoute: string, nextMethod: AnalyticsMethod) => {
    onRouteChange(nextRoute, nextMethod);
  };
  const selectRouteWithKeyboard = (
    event: KeyboardEvent<HTMLTableRowElement>,
    nextRoute: string,
    nextMethod: AnalyticsMethod
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectRoute(nextRoute, nextMethod);
  };

  return (
    <PlanGated error={planGateError} feature="Request analytics">
      <Panel
        title="Analytics"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Add a metric"
              onClick={() => setPicking(!picking)}
              className="pressable rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              Add metric
            </button>
            {showWindowSelector && (
              <Select
                value={since}
                onChange={(event) => onSinceChange(event.target.value)}
                aria-label="Analytics window"
                className="h-8 text-xs"
              >
                {WINDOWS.map((window) => (
                  <option key={window} value={window}>
                    {window}
                  </option>
                ))}
              </Select>
            )}
            <Select
              value={groupBy}
              onChange={(event) => changeGroup(event.target.value as AnalyticsGroupBy)}
              aria-label="Group by"
              className="h-8 text-xs"
            >
              {ANALYTICS_GROUPS.map((group) => (
                <option key={group.value} value={group.value}>
                  {group.label}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {analyticsPhase === 'error' || analyticsPhase === 'unreachable' ? (
          <InlinePhase phase={analyticsPhase} error={analytics.error} />
        ) : analyticsPhase === 'empty' ? (
          <InlinePhase
            phase={analyticsPhase}
            emptyMessage="No request analytics are available yet."
          />
        ) : (
          <div className="flex flex-col gap-5">
            <AnalyticsGrid
              onInspect={inspectMetric}
              historyState={
                seriesPhase === 'loading'
                  ? 'loading'
                  : seriesPhase === 'error' || seriesPhase === 'unreachable'
                    ? 'unavailable'
                    : 'ready'
              }
              points={
                (seriesPhase === 'ready' ? (series.data?.points ?? []) : []) as AnalyticsPoint[]
              }
              picking={picking}
              onPicking={setPicking}
              loading={seriesPhase === 'loading'}
              build={(chosen) => {
                const raw = (
                  seriesPhase === 'ready' ? (series.data?.points ?? []) : []
                ) as AnalyticsPoint[];
                const cards = chosenCards(
                  chosen,
                  raw,
                  rangeHalfLabel({ kind: 'preset', value: since }),
                  {
                    from: series.data?.from,
                    until: series.data?.until,
                    incomplete: incompleteTelemetry(series.data) || incompleteTelemetry(data),
                  }
                );
                if (hasRouteFilter)
                  return cards.map((card) =>
                    seriesPhase === 'ready' ? card : { ...card, value: '—', delta: null }
                  );
                // Aggregated percentiles come from the aggregate, never averaged hourly percentiles.
                const totals = data
                  ? scalarCards(chosen, {
                      request_count: data.requests,
                      error_rate_pct: data.error_rate_pct,
                      latency_p50_ms: data.p50_ms,
                      latency_p95_ms: data.p95_ms,
                      latency_p99_ms: data.p99_ms,
                      cold_start_pct: 0,
                    })
                  : [];
                return cards.map((card) => {
                  if (!data) return { ...card, value: '—', delta: null };
                  if (card.id === 'errors')
                    return {
                      ...card,
                      value: String(data.error_requests),
                      caption:
                        card.delta === null ? 'Errored responses in this window' : card.caption,
                    };
                  if (card.id === 'cold_boots')
                    return {
                      ...card,
                      value: String(data.cold_boots),
                      caption: card.delta === null ? 'Cold boots in this window' : card.caption,
                    };
                  const total = totals.find((item) => item.id === card.id);
                  return total
                    ? {
                        ...card,
                        value: total.value,
                        caption: card.id.startsWith('p')
                          ? 'Recorded responses in this window'
                          : card.delta !== null
                            ? card.caption
                            : total.caption,
                      }
                    : card;
                });
              }}
            />
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              Hourly · UTC
              <HelpTip label="About these changes">
                Changes compare equal groups of complete hours within this window; partial hours are
                excluded.
              </HelpTip>
            </p>
            {(incompleteTelemetry(data) || incompleteTelemetry(series.data)) && (
              <p role="status" className="text-xs text-status-warning">
                Some request records are missing. These figures may be incomplete.
              </p>
            )}
            {data?.window_clamped && (
              <p className="text-xs text-muted-foreground">
                The window was clamped to the retention this plan keeps.
              </p>
            )}

            {hasRouteFilter && route && method && (
              <div className="flex items-center gap-2 text-xs" aria-label="Active route filter">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 font-mono">
                  <Pill label={method} /> {route}
                </span>
                <button
                  type="button"
                  onClick={() => onRouteChange(undefined, undefined)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Clear route filter"
                >
                  Clear
                </button>
              </div>
            )}

            {seriesPhase === 'ready' ? (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="label-mono text-muted-foreground">Hourly</p>
                  <SegmentedControl
                    label="Chart metric"
                    value={metric}
                    options={(Object.keys(CHART_METRICS) as ChartMetric[]).map((key) => ({
                      key,
                      label: CHART_METRICS[key].label,
                    }))}
                    onChange={setMetric}
                  />
                </div>
                {points.some((point) => point.requests > 0) ? (
                  <TimeChart
                    onInspect={() =>
                      inspectMetric(
                        metric === 'traffic'
                          ? 'requests'
                          : metric === 'latency'
                            ? 'p95'
                            : 'cold_boots'
                      )
                    }
                    data={points}
                    x="at"
                    series={chart.config}
                    kind={metric === 'latency' ? 'line' : 'area'}
                    className="h-48"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {metric === 'latency'
                      ? 'No requests in this window.'
                      : 'No hourly points in this window yet.'}
                  </p>
                )}
              </div>
            ) : (
              <InlinePhase
                phase={seriesPhase}
                error={series.error}
                emptyMessage="Not enough hourly points to draw a chart yet."
              />
            )}

            {groupsPhase === 'ready' && data && (
              <div className="overflow-x-auto">
                <p className="label-mono mb-2 text-muted-foreground">
                  Top by{' '}
                  {ANALYTICS_GROUPS.find(
                    (group) => group.value === data.group_by
                  )?.label.toLowerCase()}
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="label-mono py-1 pr-4 font-normal">Value</th>
                      <th className="label-mono py-1 pr-4 text-right font-normal">Requests</th>
                      <th className="label-mono py-1 pr-4 text-right font-normal">Errors</th>
                      <th className="label-mono py-1 pr-4 text-right font-normal">p95</th>
                      <th className="label-mono py-1 text-right font-normal">Cold</th>
                    </tr>
                  </thead>
                  <tbody className="[font-variant-numeric:tabular-nums]">
                    {data.groups.map((group) => {
                      const selectable = groupBy === 'route' && Boolean(group.method);
                      return (
                        <tr
                          key={group.value + '-' + (group.method ?? '')}
                          className={
                            selectable
                              ? 'cursor-pointer border-t border-border outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50'
                              : 'border-t border-border'
                          }
                          tabIndex={selectable ? 0 : undefined}
                          role={selectable ? 'button' : undefined}
                          aria-label={
                            selectable
                              ? 'Filter chart to ' + group.method + ' ' + group.value
                              : undefined
                          }
                          onClick={
                            selectable
                              ? () => selectRoute(group.value, group.method as AnalyticsMethod)
                              : undefined
                          }
                          onKeyDown={
                            selectable
                              ? (event) =>
                                  selectRouteWithKeyboard(
                                    event,
                                    group.value,
                                    group.method as AnalyticsMethod
                                  )
                              : undefined
                          }
                        >
                          <td className="py-1.5 pr-4 font-mono">
                            {group.method && <Pill label={group.method} />} {group.value}
                          </td>
                          <td className="py-1.5 pr-4 text-right">{group.requests}</td>
                          <td className="py-1.5 pr-4 text-right">
                            {group.error_requests}
                            {group.error_requests > 0 && (
                              <span className="ml-1 text-muted-foreground">
                                ({group.error_rate_pct.toFixed(1)}%)
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-4 text-right">{group.p95_ms} ms</td>
                          <td className="py-1.5 text-right">{group.cold_boots}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {data.groups_truncated && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing the top {data.groups_limit}; there are more.
                  </p>
                )}
              </div>
            )}
            {groupsPhase === 'empty' && (
              <InlinePhase phase={groupsPhase} emptyMessage="No grouped requests in this window." />
            )}
          </div>
        )}
      </Panel>
    </PlanGated>
  );
}

/** Request analytics for one app, with its filters in the URL so a link keeps them. */
export function AppAnalyticsPanel({
  slug,
  search,
  onSearchChange,
}: {
  slug: string;
  search: AppAnalyticsSearch;
  onSearchChange: (patch: AppAnalyticsSearch) => void;
}) {
  return (
    <AppAnalyticsBody
      slug={slug}
      since={search.analyticsSince ?? '24h'}
      groupBy={search.analyticsGroup ?? 'route'}
      route={search.analyticsRoute}
      method={search.analyticsMethod}
      onSinceChange={(since) =>
        onSearchChange({ analyticsSince: WINDOWS.find((w) => w === since) })
      }
      onGroupByChange={(group) =>
        onSearchChange({
          analyticsGroup: group,
          analyticsRoute: undefined,
          analyticsMethod: undefined,
        })
      }
      onRouteChange={(route, method) =>
        onSearchChange({
          analyticsRoute: route && method ? route : undefined,
          analyticsMethod: route && method ? method : undefined,
        })
      }
    />
  );
}
