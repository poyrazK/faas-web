import { useState } from 'react';
import {
  useAccountSlo,
  useAppAnalytics,
  useAppAnalyticsTimeseries,
  useAppsMetrics,
  useInstances,
  type MetricsRange,
} from '@/lib/api/queries';
import { useWorkspaceUsageSummary } from '@/lib/api/org-billing';
import { Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { InlinePhase, queryPhase } from './primitives';
import { PlanGated } from './plan-gated';
import { ANALYTICS_GROUPS } from './app-analytics-search';
import { TimeChart } from './kit/chart';
import { AnalyticsBreakdown } from './analytics-breakdown';
import {
  compareRequestHalves,
  appMetricNumber,
  incompleteTelemetry,
  metricNumber,
  metricValue,
  METRIC_SERIES,
  REQUEST_METRICS,
  utcLabel,
} from './analytics-data';
import { METRIC_LABELS, type MetricDetailRequest, type DetailMetric } from './metric-detail-search';
import type { AnalyticsPoint } from './analytics-grid';

export function AnalyticsWindowNote({
  from,
  until,
  clamped,
  incomplete,
}: {
  from?: string;
  until?: string;
  clamped?: boolean;
  incomplete?: boolean;
}) {
  return (
    <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
      {from && until && (
        <p>
          {utcLabel(from, true)} – {utcLabel(until, true)} UTC{' '}
          <span className="text-muted-foreground">(end exclusive)</span>
        </p>
      )}
      {clamped && <p role="status">This window is limited to the history your plan retains.</p>}
      {incomplete && (
        <p role="status" className="text-status-warning">
          Some request records are still missing. Totals and charts may be incomplete.
        </p>
      )}
    </div>
  );
}

export default function MetricDetail({
  request,
  onChange,
}: {
  request: MetricDetailRequest;
  onChange: (next: MetricDetailRequest) => void;
}) {
  if (['memory', 'allowance', 'cpu'].includes(request.metric))
    return <ResourceDetail metric={request.metric} />;
  return request.app ? (
    <AppDetail request={request} onChange={onChange} />
  ) : (
    <AccountDetail request={request} onChange={onChange} />
  );
}

function AppDetail({
  request,
  onChange,
}: {
  request: MetricDetailRequest;
  onChange: (next: MetricDetailRequest) => void;
}) {
  const { metric, app = '', since, until, route, method } = request;
  const group = route ? 'route' : (request.group ?? 'route');
  const series = useAppAnalyticsTimeseries(app, since, { until, route, method, groupBy: group });
  const summary = useAppAnalytics(app, since, group, until);
  const seriesPhase = queryPhase({ error: series.error, loading: series.isPending });
  const summaryPhase = queryPhase({ error: summary.error, loading: summary.isPending });
  const data = summaryPhase === 'ready' ? summary.data : undefined;
  const points = (seriesPhase === 'ready' ? (series.data?.points ?? []) : []) as AnalyticsPoint[];
  const aggregate = route
    ? data?.groups.find((row) => row.value === route && row.method === method)
    : data;
  const key = METRIC_SERIES[metric];
  const count = aggregate?.requests;
  const value =
    aggregate && (count || metric === 'requests' || metric === 'errors' || metric === 'cold_boots')
      ? metric === 'cold_rate'
        ? aggregate.requests
          ? (aggregate.cold_boots / aggregate.requests) * 100
          : null
        : key
          ? Number(aggregate[key as keyof typeof aggregate])
          : null
      : null;
  const chart = points.map((point) => ({
    at: utcLabel(point.start),
    value: metricNumber(metric, point),
  }));
  const comparison =
    incompleteTelemetry(series.data) || incompleteTelemetry(data)
      ? null
      : compareRequestHalves(points, metric, series.data?.from, series.data?.until);
  const hasSample =
    chart.some((point) => point.value !== null) && points.some((point) => point.requests > 0);
  const groups = (data?.groups ?? [])
    .filter((row) => !route || (row.value === route && row.method === method))
    .map((row, index) => {
      const value = metricNumber(metric, { ...row, start: '' });
      return {
        id: `${row.value}-${row.method}-${index}`,
        label: `${row.method ? row.method + ' ' : ''}${row.value === '__other__' ? 'Other groups' : row.value}`,
        value: value ?? 0,
        formatted: metricValue(metric, value),
        ...(group === 'route' && row.method && !route
          ? { onSelect: () => onChange({ ...request, route: row.value, method: row.method }) }
          : {}),
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  return (
    <PlanGated error={summary.error ?? series.error} feature="Request analytics">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">
              {METRIC_LABELS[metric]} for {app}
            </p>
            <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
              {summaryPhase === 'loading' ? 'Loading…' : metricValue(metric, value)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {metric.startsWith('p') && metric !== 'requests'
                ? 'Window percentile of recorded responses. Hourly percentiles are not averaged.'
                : 'Recorded requests in the selected window.'}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void summary.refetch();
              void series.refetch();
            }}
          >
            Refresh
          </Button>
        </div>
        <AnalyticsWindowNote
          from={series.data?.from ?? data?.from}
          until={series.data?.until ?? data?.until}
          clamped={series.data?.window_clamped || data?.window_clamped}
          incomplete={incompleteTelemetry(series.data) || incompleteTelemetry(data)}
        />
        {route && (
          <p className="flex flex-wrap items-center gap-3 well rounded-xl bg-muted/40 p-3 text-xs">
            <span className="break-all font-mono">
              {method} {route}
            </span>
            <button
              className="text-brand underline"
              onClick={() => onChange({ ...request, route: undefined, method: undefined })}
            >
              Show all routes
            </button>
          </p>
        )}
        <section aria-label="Metric history" className="well rounded-xl bg-muted/40 p-4">
          <h3 className="mb-5 text-sm font-medium">
            {METRIC_LABELS[metric]} over time{' '}
            <span className="ml-2 text-xs font-normal text-muted-foreground">Hourly · UTC</span>
          </h3>
          {seriesPhase !== 'ready' ? (
            <InlinePhase
              phase={seriesPhase}
              error={series.error}
              onRetry={() => void series.refetch()}
            />
          ) : !hasSample ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              No requests in this window. Try another time range.
            </div>
          ) : (
            <TimeChart
              data={chart}
              x="at"
              series={{
                value: {
                  label: METRIC_LABELS[metric],
                  color: metric === 'errors' || metric === 'error_rate' ? 'red' : 'blue',
                },
              }}
              format={(value) => metricValue(metric, value, true)}
              className="h-64 sm:h-80"
            />
          )}
        </section>
        {comparison && (
          <div className="grid gap-3 well rounded-xl bg-muted/40 p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">
                First {comparison.hours} complete hours
              </p>
              <p className="mt-1 text-lg font-medium tabular-nums">
                {metricValue(metric, comparison.before)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {utcLabel(comparison.firstFrom)} – {utcLabel(comparison.firstUntil)} UTC
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Last {comparison.hours} complete hours
              </p>
              <p className="mt-1 text-lg font-medium tabular-nums">
                {metricValue(metric, comparison.after)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {utcLabel(comparison.lastFrom)} – {utcLabel(comparison.lastUntil)} UTC
              </p>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {comparison.delta === null
                ? 'No percentage comparison: the earlier period had no requests for this metric.'
                : `${comparison.delta > 0 ? '+' : ''}${comparison.delta.toFixed(1)}% compared with the earlier hours.`}{' '}
              These are two portions of the selected window, not the previous full period.
            </p>
          </div>
        )}
        <section className="well rounded-xl bg-muted/40 p-4" aria-label="Metric breakdown">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Leading contributors</h3>
            <Select
              aria-label="Break down metric by"
              value={group}
              disabled={Boolean(route)}
              onChange={(event) =>
                onChange({ ...request, group: event.target.value as MetricDetailRequest['group'] })
              }
              className="w-40"
            >
              {ANALYTICS_GROUPS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {metric === 'error_rate' || metric === 'cold_rate'
              ? 'Rates are calculated separately within each group.'
              : 'Ranked by this metric in the same time window.'}
            {group === 'route' && !route ? ' Select a route to focus the chart.' : ''}
          </p>
          {summaryPhase !== 'ready' ? (
            <InlinePhase
              phase={summaryPhase}
              error={summary.error}
              onRetry={() => void summary.refetch()}
            />
          ) : (
            <AnalyticsBreakdown rows={groups} label="Leading contributors" />
          )}
          {data?.groups_truncated && (
            <p className="mt-3 text-xs text-muted-foreground">
              The API returns the top {data.groups_limit} groups; other groups are combined. Showing
              up to 10 here.
            </p>
          )}
          {route && !aggregate && summaryPhase === 'ready' && (
            <p className="text-xs text-muted-foreground">
              This route is outside the returned top groups. Its hourly history is shown, but a
              window percentile is unavailable.
            </p>
          )}
        </section>
        {points.length > 0 && <ChartData points={points} metric={metric} />}
      </div>
    </PlanGated>
  );
}

function ChartData({ points, metric }: { points: AnalyticsPoint[]; metric: DetailMetric }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="well rounded-xl bg-muted/40 p-4"
    >
      <summary
        tabIndex={0}
        className="cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-brand"
      >
        View hourly data
      </summary>
      {open && (
        <div
          className="mt-4 max-h-72 overflow-auto"
          tabIndex={0}
          role="region"
          aria-label="Hourly metric data"
        >
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{METRIC_LABELS[metric]} by UTC hour</caption>
            <thead>
              <tr>
                <th className="py-2 font-medium">Hour starting (UTC)</th>
                <th className="py-2 text-right font-medium">{METRIC_LABELS[metric]}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.start} className="border-t border-border">
                  <td className="py-2">{utcLabel(point.start, true)}</td>
                  <td className="text-right tabular-nums">
                    {metricValue(metric, metricNumber(metric, point))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function AccountDetail({
  request,
  onChange,
}: {
  request: MetricDetailRequest;
  onChange: (request: MetricDetailRequest) => void;
}) {
  const { metric, since } = request;
  const range = ['5m', '15m', '1h', '6h', '24h', '7d', '15d'].includes(since)
    ? (since as MetricsRange)
    : '24h';
  const sloWindow = since === '7d' ? '7d' : since === '1h' ? '1h' : '24h';
  const slo = useAccountSlo(sloWindow, { enabled: request.source === 'slo' });
  const rollup = useAppsMetrics(range);
  const query = request.source === 'slo' ? slo : rollup;
  const phase = queryPhase({ error: query.error, loading: query.isPending });
  const known =
    phase === 'ready' &&
    query.data?.source === 'prometheus' &&
    (request.source === 'slo' ||
      Object.values(rollup.data?.apps ?? {}).every((row) => row.source === 'prometheus'));
  const rows =
    !rollup.error && !rollup.isPending && rollup.data?.source === 'prometheus'
      ? Object.entries(rollup.data.apps ?? {}).filter(([, row]) => row.source === 'prometheus')
      : [];
  const requests = rows.reduce((n, [, row]) => n + row.request_count, 0);
  const errors = rows.reduce((n, [, row]) => n + (row.request_count * row.error_rate_pct) / 100, 0);
  const totals: Partial<Record<DetailMetric, number | null>> =
    request.source === 'slo' && slo.data
      ? {
          requests: slo.data.requests_total,
          errors: Math.round((slo.data.requests_total * slo.data.error_rate_pct) / 100),
          error_rate: slo.data.requests_total ? slo.data.error_rate_pct : null,
          cold_rate: slo.data.requests_total ? slo.data.cold_boot_rate_pct : null,
          p50: slo.data.requests_total ? slo.data.request_duration.p50_ms : null,
          p95: slo.data.requests_total ? slo.data.request_duration.p95_ms : null,
          p99: slo.data.requests_total ? slo.data.request_duration.p99_ms : null,
          throttled: slo.data.throttled_total,
        }
      : {
          requests,
          errors: Math.round(errors),
          error_rate: requests ? (errors / requests) * 100 : null,
          wake_p95: rows.find(
            ([, row]) =>
              row.wake_p95_ms > 0 && (row.wake_samples === undefined || row.wake_samples >= 20)
          )?.[1].wake_p95_ms,
        };
  const supported = metric !== 'wake_p95' && metric !== 'throttled';
  const breakdown = rows
    .map(([slug, row]) => ({
      id: slug,
      label: slug,
      value: appMetricNumber(metric, row) ?? 0,
      formatted: metricValue(metric, appMetricNumber(metric, row), true),
      ...(REQUEST_METRICS.includes(metric as (typeof REQUEST_METRICS)[number])
        ? { onSelect: () => onChange({ ...request, app: slug, source: undefined }) }
        : {}),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  return (
    <PlanGated error={query.error} feature="Account analytics">
      <div className="space-y-5">
        <div>
          <p className="text-xs text-muted-foreground">All apps · Last {range}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {known ? metricValue(metric, totals[metric]) : '—'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {metric === 'errors'
              ? 'Estimated from request totals and error rates.'
              : metric === 'wake_p95'
                ? 'Fleet-wide cold-start latency. Not attributable to one app; fewer than 20 reported samples is unavailable.'
                : ['p50', 'p95', 'p99'].includes(metric)
                  ? 'Percentile across successful (2xx) responses. App percentiles are not averaged.'
                  : 'Aggregate for the selected time window.'}
          </p>
          {query.data?.as_of && (
            <p className="mt-2 text-xs text-muted-foreground">
              Updated {utcLabel(query.data.as_of, true)} UTC
            </p>
          )}
        </div>
        {phase !== 'ready' && (
          <InlinePhase phase={phase} error={query.error} onRetry={() => void query.refetch()} />
        )}
        {phase === 'ready' && !known && (
          <p role="status" className="text-sm text-muted-foreground">
            Metrics are unavailable. Retry when the metrics service recovers.
          </p>
        )}
        <section className="well rounded-xl bg-muted/40 p-4">
          <h3 className="text-sm font-medium">
            {supported ? 'Apps in this window' : 'About this metric'}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {supported
              ? 'App summaries use platform metrics; response times cover successful (2xx) responses. Select an app to explore its request records, including all response statuses, in this panel. Account hourly history is unavailable.'
              : 'An app breakdown and hourly history are not available for this metric.'}
          </p>
          {supported &&
            (rollup.error || rollup.isPending ? (
              <InlinePhase
                phase={queryPhase({ error: rollup.error, loading: rollup.isPending })}
                error={rollup.error}
                onRetry={() => void rollup.refetch()}
              />
            ) : rollup.data?.source !== 'prometheus' ? (
              <p role="status" className="mt-4 text-xs text-muted-foreground">
                App metrics are unavailable.
              </p>
            ) : (
              <AnalyticsBreakdown rows={breakdown} label="Apps by selected metric" />
            ))}
        </section>
      </div>
    </PlanGated>
  );
}

function ResourceDetail({ metric }: { metric: DetailMetric }) {
  const usage = useWorkspaceUsageSummary();
  const instances = useInstances();
  const query = metric === 'memory' ? instances : usage;
  const phase = queryPhase({ error: query.error, loading: query.isPending });
  const resident = (instances.data?.instances ?? []).filter(
    (row) => row.state.toLowerCase() !== 'parked'
  );
  const data = usage.data;
  const value =
    metric === 'memory'
      ? instances.data?.next_before
        ? null
        : resident.reduce((n, row) => n + row.ram_mb, 0)
      : metric === 'cpu'
        ? data?.used_cpu_hours
        : data?.included_gb_hours == null
          ? data?.used_gb_hours
          : Math.max(0, data.included_gb_hours - data.used_gb_hours);
  return (
    <div className="space-y-4">
      <p className="text-3xl font-semibold tabular-nums">
        {phase === 'ready' && value != null
          ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : '—'}{' '}
        <span className="text-sm font-normal text-muted-foreground">
          {metric === 'memory' ? 'MB' : metric === 'cpu' ? 'CPU hours' : 'GB-hours'}
        </span>
      </p>
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        {metric === 'memory'
          ? 'Memory currently held by resident instances. Parked instances use no resident memory. This is a snapshot, not the selected request window.'
          : metric === 'cpu'
            ? 'Measured CPU time in the current billing period. This is informational and is not billed as CPU time.'
            : data?.included_gb_hours == null
              ? 'Compute used in the current billing period. An included allowance has not been reported.'
              : 'Included compute remaining in the current billing period. Request time ranges do not change your allowance.'}
      </p>
      {phase !== 'ready' && (
        <InlinePhase phase={phase} error={query.error} onRetry={() => void query.refetch()} />
      )}
      {metric === 'memory' && instances.data?.next_before && (
        <p className="text-sm text-muted-foreground">
          Only part of the instance inventory was returned; a full total is unavailable.
        </p>
      )}
      <p className="well rounded-xl bg-muted/40 p-4 text-xs text-muted-foreground">
        Hourly history is not available from this snapshot.
      </p>
    </div>
  );
}
