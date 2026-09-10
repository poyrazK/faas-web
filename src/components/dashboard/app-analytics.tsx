import { useState, type KeyboardEvent } from 'react';
import { Area, AreaChart, Grid, Tooltip, XAxis, YAxis } from '@/components/dither-kit';
import { Select } from '@/components/ui/field';
import { InlinePhase, Panel, StatTile, queryPhase } from '@/components/dashboard/primitives';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { Pill } from '@/components/dashboard/resource-table';
import {
  useAppAnalytics,
  useAppAnalyticsTimeseries,
  type AnalyticsGroupBy,
  type AppAnalyticsTimeseriesOptions,
} from '@/lib/api/queries';

const WINDOWS = ['24h', '3d', '7d'] as const;
const GROUPS: { value: AnalyticsGroupBy; label: string }[] = [
  { value: 'route', label: 'Route' },
  { value: 'country', label: 'Country' },
  { value: 'referrer_host', label: 'Referrer' },
  { value: 'ua_family', label: 'Client' },
  { value: 'status', label: 'Status' },
];
const CHART_CONFIG = {
  requests: { label: 'Requests', color: 'green' as const },
  error_requests: { label: 'Errors', color: 'red' as const },
};

type AnalyticsMethod = NonNullable<AppAnalyticsTimeseriesOptions['method']>;

export type AppAnalyticsBodyProps = {
  slug: string;
  since: string;
  groupBy: AnalyticsGroupBy;
  route?: string;
  method?: AnalyticsMethod;
  onSinceChange: (since: string) => void;
  onGroupByChange: (groupBy: AnalyticsGroupBy) => void;
  onRouteChange: (route: string | undefined, method: AnalyticsMethod | undefined) => void;
};

function hourLabel(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms)
    ? iso
    : new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AppAnalyticsBody({
  slug,
  since,
  groupBy,
  route,
  method,
  onSinceChange,
  onGroupByChange,
  onRouteChange,
}: AppAnalyticsBodyProps) {
  const analytics = useAppAnalytics(slug, since, groupBy);
  const hasRouteFilter = groupBy === 'route' && Boolean(route && method);
  const series = useAppAnalyticsTimeseries(slug, since, {
    route: hasRouteFilter ? route : undefined,
    method: hasRouteFilter ? method : undefined,
    groupBy,
  });
  const data = analytics.data;
  const points = (series.data?.points ?? []).map((point) => ({
    at: hourLabel(point.start),
    requests: point.requests,
    error_requests: point.error_requests,
  }));
  const analyticsPhase = queryPhase({
    error: analytics.error,
    loading: analytics.isPending,
    isEmpty: !data,
  });
  const seriesPhase = queryPhase({
    error: series.error,
    loading: series.isPending,
    isEmpty: points.length < 2,
  });
  const groupsPhase = queryPhase({
    error: analytics.error,
    loading: analytics.isPending,
    isEmpty: (data?.groups.length ?? 0) === 0,
  });
  const tileState =
    analyticsPhase === 'loading' ? 'loading' : analyticsPhase === 'ready' ? 'ready' : 'unavailable';

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
    <PlanGated error={analytics.error ?? series.error} feature="Request analytics">
      <Panel
        title="Request analytics"
        description="Aggregated at the edge from route templates, hostname-only referrers and country codes — never full URLs."
        actions={
          <div className="flex items-center gap-2">
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
            <Select
              value={groupBy}
              onChange={(event) => changeGroup(event.target.value as AnalyticsGroupBy)}
              aria-label="Group by"
              className="h-8 text-xs"
            >
              {GROUPS.map((group) => (
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
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="Requests" value={data?.requests} state={tileState} />
              <StatTile label="Errors" value={data?.error_requests} state={tileState} tone="red" />
              <StatTile
                label="Error rate"
                value={data ? data.error_rate_pct.toFixed(2) : undefined}
                unit="%"
                state={tileState}
                tone="orange"
              />
              <StatTile label="p50" value={data?.p50_ms} unit="ms" state={tileState} tone="grey" />
              <StatTile label="p95" value={data?.p95_ms} unit="ms" state={tileState} tone="grey" />
              <StatTile
                label="Cold boots"
                value={data?.cold_boots}
                state={tileState}
                tone="orange"
              />
            </div>

            {data?.window_clamped && (
              <p className="text-xs text-muted-foreground">
                The window was clamped to the retention this plan keeps.
              </p>
            )}

            {hasRouteFilter && route && method && (
              <div className="flex items-center gap-2 text-xs" aria-label="Active route filter">
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 font-mono">
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
                <p className="label-mono mb-2 text-muted-foreground">Hourly</p>
                <AreaChart data={points} config={CHART_CONFIG} className="h-48 w-full">
                  <Grid />
                  <XAxis dataKey="at" />
                  <YAxis />
                  <Tooltip />
                  <Area dataKey="requests" />
                  <Area dataKey="error_requests" />
                </AreaChart>
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
                  {GROUPS.find((group) => group.value === data.group_by)?.label.toLowerCase()}
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

export function AppAnalyticsPanel({ slug }: { slug: string }) {
  const [since, setSince] = useState<string>('24h');
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>('route');
  const [route, setRoute] = useState<string>();
  const [method, setMethod] = useState<AnalyticsMethod>();

  return (
    <AppAnalyticsBody
      slug={slug}
      since={since}
      groupBy={groupBy}
      route={route}
      method={method}
      onSinceChange={setSince}
      onGroupByChange={setGroupBy}
      onRouteChange={(nextRoute, nextMethod) => {
        setRoute(nextRoute);
        setMethod(nextMethod);
      }}
    />
  );
}
