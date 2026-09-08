import { useState } from 'react';
import { Area, AreaChart, Grid, Tooltip, XAxis, YAxis } from '@/components/dither-kit';
import { Select } from '@/components/ui/field';
import { Panel, StatTile } from '@/components/dashboard/primitives';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { Pill } from '@/components/dashboard/resource-table';
import { errorMessage } from '@/lib/api/errors';
import {
  useAppAnalytics,
  useAppAnalyticsTimeseries,
  type AnalyticsGroupBy,
} from '@/lib/api/queries';

/**
 * Request analytics (`/analytics`, `/analytics/timeseries`): who called the
 * app, from where, and how it answered.
 *
 * The timeseries endpoint returns zero-filled hourly buckets — a real series —
 * so it is drawn as one. Everything else the API returns is a scalar or a
 * bounded top-N table, and stays a tile or a row: the grouping dimension is
 * the API's own enum (route, country, referrer host, UA family, status), and
 * `groups_truncated` is stated rather than hidden.
 *
 * `402` on Free is the same per-app-metrics gate the wake timeline uses.
 */

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

function hourLabel(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms)
    ? iso
    : new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AppAnalyticsPanel({ slug }: { slug: string }) {
  const [since, setSince] = useState<string>('24h');
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>('route');
  const analytics = useAppAnalytics(slug, since, groupBy);
  const series = useAppAnalyticsTimeseries(slug, since);
  const data = analytics.data;
  const state = analytics.isPending ? 'loading' : analytics.error ? 'unavailable' : 'ready';
  const points = (series.data?.points ?? []).map((p) => ({
    at: hourLabel(p.start),
    requests: p.requests,
    error_requests: p.error_requests,
  }));

  return (
    <PlanGated error={analytics.error} feature="Request analytics">
      <Panel
        title="Request analytics"
        description="Aggregated at the edge from route templates, hostname-only referrers and country codes — never full URLs."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={since}
              onChange={(e) => setSince(e.target.value)}
              aria-label="Analytics window"
              className="h-8 text-xs"
            >
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </Select>
            <Select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as AnalyticsGroupBy)}
              aria-label="Group by"
              className="h-8 text-xs"
            >
              {GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {analytics.error ? (
          <p className="text-sm text-muted-foreground">{errorMessage(analytics.error)}</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="Requests" value={data?.requests} state={state} />
              <StatTile label="Errors" value={data?.error_requests} state={state} tone="red" />
              <StatTile
                label="Error rate"
                value={data ? data.error_rate_pct.toFixed(2) : undefined}
                unit="%"
                state={state}
                tone="orange"
              />
              <StatTile label="p50" value={data?.p50_ms} unit="ms" state={state} tone="grey" />
              <StatTile label="p95" value={data?.p95_ms} unit="ms" state={state} tone="grey" />
              <StatTile label="Cold boots" value={data?.cold_boots} state={state} tone="orange" />
            </div>

            {data?.window_clamped && (
              <p className="text-xs text-muted-foreground">
                The window was clamped to the retention this plan keeps.
              </p>
            )}

            {points.length > 1 && (
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
            )}

            {data && data.groups.length > 0 && (
              <div className="overflow-x-auto">
                <p className="label-mono mb-2 text-muted-foreground">
                  Top by {GROUPS.find((g) => g.value === data.group_by)?.label.toLowerCase()}
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
                    {data.groups.map((g) => (
                      <tr key={`${g.value}-${g.method ?? ''}`} className="border-t border-border">
                        <td className="py-1.5 pr-4 font-mono">
                          {g.method && <Pill label={g.method} />} {g.value}
                        </td>
                        <td className="py-1.5 pr-4 text-right">{g.requests}</td>
                        <td className="py-1.5 pr-4 text-right">
                          {g.error_requests}
                          {g.error_requests > 0 && (
                            <span className="ml-1 text-muted-foreground">
                              ({g.error_rate_pct.toFixed(1)}%)
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-4 text-right">{g.p95_ms} ms</td>
                        <td className="py-1.5 text-right">{g.cold_boots}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.groups_truncated && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing the top {data.groups_limit}; there are more.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Panel>
    </PlanGated>
  );
}
