import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import {
  useAccountSlo,
  useAppAnalytics,
  useAppAnalyticsTimeseries,
  useApps,
  useAppsMetrics,
  useInstances,
  type MetricsRange,
} from '@/lib/api/queries';
import { useWorkspaceUsageSummary } from '@/lib/api/org-billing';
import { Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { InlinePhase, queryPhase } from './primitives';
import { PlanGated } from './plan-gated';
import { SegmentedControl } from './tabs';
import { TimeChart } from './kit/chart';
import { AnalyticsBreakdown, type BreakdownRow } from './analytics-breakdown';
import { inScope, useProjectScope } from '@/lib/project-scope';
import {
  analyticsGroupWords,
  compareRequestHalves,
  appMetricNumber,
  incompleteTelemetry,
  metricNumber,
  metricValue,
  METRIC_SERIES,
  REQUEST_METRICS,
  utcLabel,
} from './analytics-data';
import {
  METRIC_LABELS,
  type DetailGroup,
  type MetricDetailRequest,
  type DetailMetric,
} from './metric-detail-search';
import {
  busiestHour,
  countVerdict,
  debuggerLabel,
  debuggerSearch,
  rateVerdict,
  windowLabel,
  windowOptions,
  type Verdict,
} from './metric-story';
import type { AnalyticsPoint } from './analytics-grid';

/**
 * The metric popup. Each view answers in the same order: the figure and
 * whether it's normal, when it changed (only where a real hourly series
 * exists), what caused it, and one place to look next. Exact bounds and raw
 * hours stay behind "Exact window and hourly numbers".
 */

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
          From {utcLabel(from, true)} to {utcLabel(until, true)} UTC. The last hour may still be
          filling in.
        </p>
      )}
      {clamped && <p role="status">Your plan keeps a limited history, so this starts later.</p>}
      {incomplete && (
        <p role="status" className="text-status-warning">
          Some recent requests are still being counted, so these numbers may rise.
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

const TONE: Record<NonNullable<Verdict>['tone'], string> = {
  good: 'bg-status-good/10 text-status-good',
  warning: 'bg-status-warning/10 text-status-warning',
  critical: 'bg-status-critical/10 text-status-critical',
  neutral: 'bg-muted text-muted-foreground',
};

/** Where the popup is looking, and the window choices. Picking one runs up to now. */
function WindowBar({
  scope,
  since,
  onSince,
}: {
  scope: string;
  since: string;
  onSince?: (since: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {scope} · {windowLabel(since)}
      </p>
      {onSince && (
        <SegmentedControl
          label="Time window"
          value={since}
          options={windowOptions(since).map((key) => ({ key, label: key }))}
          onChange={onSince}
        />
      )}
    </div>
  );
}

/** The figure, whether it's normal, and the sentence that says why. */
function Answer({
  value,
  verdict,
  loading,
  children,
}: {
  value: ReactNode;
  verdict?: Verdict;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {loading ? 'Loading…' : value}
        </p>
        {!loading && verdict && (
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', TONE[verdict.tone])}>
            {verdict.label}
          </span>
        )}
      </div>
      {children && <p className="mt-2 max-w-xl text-sm leading-relaxed">{children}</p>}
    </div>
  );
}

const count = (n: number) => Math.round(n).toLocaleString('en');
const share = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
const COUNT_METRICS: DetailMetric[] = ['requests', 'errors', 'cold_boots'];
const LATENCY_METRICS: DetailMetric[] = ['p50', 'p95', 'p99'];

/** What the busiest hour is called on the chart and in the sentence. */
const PEAK: Partial<Record<DetailMetric, string>> = {
  requests: 'Busiest',
  errors: 'Most failures',
  error_rate: 'Worst hour',
  p50: 'Slowest',
  p95: 'Slowest',
  p99: 'Slowest',
  cold_boots: 'Most cold boots',
  cold_rate: 'Most cold boots',
};

const SOURCES_TITLE: Partial<Record<DetailMetric, string>> = {
  requests: 'Where they came from',
  errors: 'Where requests fail',
  error_rate: 'Where requests fail',
  p50: 'Where it’s slowest',
  p95: 'Where it’s slowest',
  p99: 'Where it’s slowest',
  cold_boots: 'Where apps woke up',
  cold_rate: 'Where apps woke up',
};

const MAIN_GROUPS: { key: DetailGroup; label: string }[] = [
  { key: 'route', label: 'Routes' },
  { key: 'status', label: 'Status codes' },
  { key: 'country', label: 'Countries' },
];
const MORE_GROUPS: { key: DetailGroup; label: string }[] = [
  { key: 'referrer_host', label: 'Referrers' },
  { key: 'ua_family', label: 'Browsers and clients' },
  { key: 'consumer_id', label: 'API consumers' },
];

const LATENCY_SENTENCE: Record<string, string> = {
  p50: 'Half of the responses were faster than this.',
  p95: 'The slowest 5% of responses took longer than this.',
  p99: 'The slowest 1% of responses took longer than this.',
};

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
  const [picked, setPicked] = useState<{ window: string; start: string } | null>(null);
  const seriesPhase = queryPhase({ error: series.error, loading: series.isPending });
  const summaryPhase = queryPhase({ error: summary.error, loading: summary.isPending });
  const data = summaryPhase === 'ready' ? summary.data : undefined;
  const points = (seriesPhase === 'ready' ? (series.data?.points ?? []) : []) as AnalyticsPoint[];
  const aggregate = route
    ? data?.groups.find((row) => row.value === route && row.method === method)
    : data;
  const key = METRIC_SERIES[metric];
  const requests = aggregate?.requests ?? 0;
  const value =
    aggregate && (requests || COUNT_METRICS.includes(metric))
      ? metric === 'cold_rate'
        ? requests
          ? (aggregate.cold_boots / requests) * 100
          : null
        : key
          ? Number(aggregate[key as keyof typeof aggregate])
          : null
      : null;
  const incomplete = incompleteTelemetry(series.data) || incompleteTelemetry(data);
  const comparison = incomplete
    ? null
    : compareRequestHalves(points, metric, series.data?.from, series.data?.until);
  const verdict =
    metric === 'error_rate'
      ? rateVerdict(requests ? value : null)
      : COUNT_METRICS.includes(metric)
        ? countVerdict(metric, comparison, value)
        : null;
  const peak = busiestHour(metric, points);
  const hasSample = points.some((point) => point.requests > 0);
  // A pick belongs to the window it was made in.
  // Stored by hour, not index: a live window shifts its points as hours roll over.
  const windowKey = `${since}|${until ?? ''}|${method ?? ''} ${route ?? ''}`;
  const pickedIndex =
    picked?.window === windowKey ? points.findIndex((point) => point.start === picked.start) : -1;
  const pickedPoint = pickedIndex < 0 ? undefined : points[pickedIndex];

  const sentence: ReactNode[] = [];
  // A focused route outside the top groups has no window total: unknown, not zero.
  if (summaryPhase === 'ready' && aggregate && !requests)
    sentence.push('No requests in this window.');
  else if (metric === 'error_rate' && aggregate)
    sentence.push(`${count(aggregate.error_requests)} of ${count(requests)} requests failed.`);
  else if (metric === 'cold_rate' && aggregate)
    sentence.push(`${count(aggregate.cold_boots)} of ${count(requests)} requests woke the app.`);
  else if (LATENCY_METRICS.includes(metric)) sentence.push(LATENCY_SENTENCE[metric]);
  else if (comparison)
    sentence.push(
      comparison.delta === null
        ? `${count(comparison.after)} in the last ${comparison.hours} hours, none before.`
        : `${count(comparison.after)} in the last ${comparison.hours} hours, ${
            Math.abs(comparison.delta) < 15
              ? 'about the same as'
              : comparison.delta > 0
                ? 'up from'
                : 'down from'
          } ${count(comparison.before)} before.`
    );
  if (peak)
    sentence.push(
      ` ${PEAK[metric]}: ${utcLabel(peak.start)} UTC, ${metricValue(metric, peak.value)}${
        COUNT_METRICS.includes(metric) ? ' that hour' : ''
      }.`
    );

  const total =
    COUNT_METRICS.includes(metric) && key && data ? Number(data[key as keyof typeof data]) : 0;
  const groups: BreakdownRow[] = (data?.groups ?? [])
    .filter((row) => !route || (row.value === route && row.method === method))
    .map((row, index) => {
      const rowValue = metricNumber(metric, { ...row, start: '' });
      return {
        id: `${row.value}-${row.method}-${index}`,
        label: analyticsGroupWords(group, row.value, row.method).label,
        value: rowValue ?? 0,
        formatted:
          total > 0 && rowValue != null
            ? `${count(rowValue)} · ${share(rowValue, total)}`
            : metricValue(metric, rowValue),
        ...(group === 'route' && row.method && !route
          ? { onSelect: () => onChange({ ...request, route: row.value, method: row.method }) }
          : {}),
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const failures = metric === 'errors' || metric === 'error_rate';
  const routeLabel = route ? analyticsGroupWords('route', route, method).label : undefined;

  return (
    <PlanGated error={summary.error ?? series.error} feature="Request analytics">
      <div className="flex flex-col gap-5">
        <WindowBar
          scope={routeLabel ?? 'All routes'}
          since={since}
          onSince={(next) => onChange({ ...request, since: next, until: undefined })}
        />
        <Answer
          value={metricValue(metric, value)}
          verdict={verdict}
          loading={summaryPhase === 'loading'}
        >
          {sentence}
        </Answer>
        {(series.data?.window_clamped || data?.window_clamped || incomplete) && (
          <AnalyticsWindowNote
            clamped={series.data?.window_clamped || data?.window_clamped}
            incomplete={incomplete}
          />
        )}
        {routeLabel && (
          <p className="flex flex-wrap items-center gap-3 text-xs">
            <span className="rounded-full bg-muted px-2.5 py-1 font-mono break-all">
              Only {routeLabel}
            </span>
            <button
              type="button"
              className="text-brand underline"
              onClick={() => onChange({ ...request, route: undefined, method: undefined })}
            >
              Show all routes
            </button>
          </p>
        )}

        <section aria-label="Metric history" className="pt-5">
          {seriesPhase !== 'ready' ? (
            <InlinePhase
              phase={seriesPhase}
              error={series.error}
              onRetry={() => void series.refetch()}
            />
          ) : !hasSample ? (
            <div className="well flex min-h-40 items-center justify-center rounded-xl bg-muted/40 px-4 text-center text-sm text-muted-foreground">
              No requests in the {windowLabel(since).toLowerCase()}. Try a longer window above.
            </div>
          ) : (
            <>
              <TimeChart
                data={points.map((point) => ({
                  at: utcLabel(point.start),
                  value: metricNumber(metric, point),
                }))}
                x="at"
                series={{
                  value: { label: METRIC_LABELS[metric], color: failures ? 'red' : 'blue' },
                }}
                format={(n) => metricValue(metric, n, true)}
                marked={peak ? { index: peak.index, label: PEAK[metric] ?? 'Peak' } : undefined}
                picked={pickedIndex < 0 ? null : pickedIndex}
                onPick={(index) =>
                  points[index] && setPicked({ window: windowKey, start: points[index].start })
                }
                className="h-56 sm:h-64"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Hours in UTC. Pick an hour to see it.</span>
              </div>
              {pickedPoint && (
                <div className="well mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs">
                  <p role="status">
                    {utcLabel(pickedPoint.start)} UTC · {count(pickedPoint.requests)} requests ·{' '}
                    {count(pickedPoint.error_requests)} failed
                    {pickedPoint.requests
                      ? ` · 95% answered within ${metricValue('p95', pickedPoint.p95_ms)}`
                      : ''}
                  </p>
                  <button
                    type="button"
                    className="text-muted-foreground underline hover:text-foreground"
                    onClick={() => setPicked(null)}
                  >
                    Clear
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section aria-label="Metric breakdown">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium">{SOURCES_TITLE[metric] ?? 'Breakdown'}</h3>
            {!route && (
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  label="Split by"
                  value={MAIN_GROUPS.some((g) => g.key === group) ? group : ('' as DetailGroup)}
                  options={MAIN_GROUPS}
                  onChange={(next) => onChange({ ...request, group: next })}
                />
                <Select
                  aria-label="More ways to split"
                  value={MORE_GROUPS.some((g) => g.key === group) ? group : ''}
                  onChange={(event) =>
                    event.target.value &&
                    onChange({ ...request, group: event.target.value as DetailGroup })
                  }
                  className="h-8 w-32 text-xs"
                >
                  <option value="">More</option>
                  {MORE_GROUPS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          {summaryPhase !== 'ready' ? (
            <InlinePhase
              phase={summaryPhase}
              error={summary.error}
              onRetry={() => void summary.refetch()}
            />
          ) : route && !aggregate ? null : (
            <AnalyticsBreakdown
              rows={groups}
              label={SOURCES_TITLE[metric] ?? 'Breakdown'}
              color={failures ? 'red' : 'blue'}
            />
          )}
          {group === 'route' && !route && groups.some((row) => row.onSelect) && (
            <p className="mt-2 text-xs text-muted-foreground">
              Pick a route to see only its hours.
            </p>
          )}
          {route && !aggregate && summaryPhase === 'ready' && (
            <p className="mt-2 text-xs text-muted-foreground">
              This route isn’t among the busiest, so its window total isn’t available. Its hours are
              shown above.
            </p>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {points.length > 0 ? (
            <Details
              points={points}
              metric={metric}
              from={series.data?.from ?? data?.from}
              until={series.data?.until ?? data?.until}
              comparison={comparison}
              truncated={data?.groups_truncated ? data.groups_limit : undefined}
            />
          ) : (
            <span />
          )}
          <Button asChild size="sm">
            <Link
              to="/dashboard/apps/$appSlug"
              params={{ appSlug: app }}
              search={debuggerSearch(metric, since, route)}
            >
              {debuggerLabel(metric)}
              <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </PlanGated>
  );
}

/** The exact window, how the comparison was made, and every hour as a table. */
function Details({
  points,
  metric,
  from,
  until,
  comparison,
  truncated,
}: {
  points: AnalyticsPoint[];
  metric: DetailMetric;
  from?: string;
  until?: string;
  comparison: ReturnType<typeof compareRequestHalves>;
  truncated?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="min-w-0 flex-1 text-xs"
    >
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand">
        Exact window and hourly numbers
      </summary>
      {open && (
        <div className="well mt-3 space-y-3 rounded-xl bg-muted/40 p-4">
          <AnalyticsWindowNote from={from} until={until} />
          {comparison && (
            <p className="text-muted-foreground">
              “Before” is {utcLabel(comparison.firstFrom)} – {utcLabel(comparison.firstUntil)} UTC
              and “last” is {utcLabel(comparison.lastFrom)} – {utcLabel(comparison.lastUntil)} UTC:
              two equal groups of complete hours in this window.
            </p>
          )}
          {truncated != null && (
            <p className="text-muted-foreground">
              Only the top {truncated} groups come back; the rest are in “Everything else”.
            </p>
          )}
          <div
            className="max-h-72 overflow-auto"
            tabIndex={0}
            role="region"
            aria-label="Hourly metric data"
          >
            <table className="w-full text-left">
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
        </div>
      )}
    </details>
  );
}

const ACCOUNT_SENTENCE: Partial<Record<DetailMetric, string>> = {
  p50: 'Half of the successful responses were faster than this. Each app’s figure is below.',
  p95: 'The slowest 5% of successful responses took longer than this. Each app’s figure is below.',
  p99: 'The slowest 1% of successful responses took longer than this. Each app’s figure is below.',
  wake_p95: 'How long a sleeping app takes to answer its first request, across your apps.',
  throttled: 'Requests turned away for going over a limit.',
};

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
  // Inside a project the add-up view covers only its apps.
  const scope = useProjectScope();
  const rows =
    !rollup.error && !rollup.isPending && rollup.data?.source === 'prometheus'
      ? inScope(Object.entries(rollup.data.apps ?? {}), scope, ([slug]) => slug).filter(
          ([, row]) => row.source === 'prometheus'
        )
      : [];
  const requests = rows.reduce((n, [, row]) => n + row.request_count, 0);
  const errors = rows.reduce((n, [, row]) => n + (row.request_count * row.error_rate_pct) / 100, 0);
  const cold = rows.reduce((n, [, row]) => n + (row.request_count * row.cold_start_pct) / 100, 0);
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
          cold_rate: requests ? (cold / requests) * 100 : null,
          wake_p95: rows.find(
            ([, row]) =>
              row.wake_p95_ms > 0 && (row.wake_samples === undefined || row.wake_samples >= 20)
          )?.[1].wake_p95_ms,
        };
  const supported = metric !== 'wake_p95' && metric !== 'throttled';
  const failures = metric === 'errors' || metric === 'error_rate';
  const errorsOf = (row: (typeof rows)[number][1]) =>
    Math.round((row.request_count * row.error_rate_pct) / 100);
  const ranked = rows
    .map(([slug, row]) => {
      const rowValue = metric === 'error_rate' ? errorsOf(row) : appMetricNumber(metric, row);
      return {
        id: slug,
        label:
          metric === 'error_rate' && row.request_count
            ? `${slug} · ${metricValue('error_rate', row.error_rate_pct)}`
            : slug,
        value: rowValue ?? 0,
        formatted:
          metric === 'error_rate'
            ? rowValue
              ? `${count(rowValue)} failed`
              : 'none failed'
            : metricValue(metric, rowValue, true),
        ...(REQUEST_METRICS.includes(metric as (typeof REQUEST_METRICS)[number])
          ? { onSelect: () => onChange({ ...request, app: slug, source: undefined }) }
          : {}),
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const top = ranked[0]?.value ? ranked[0] : undefined;
  const value = totals[metric];
  // A healthy fleet can hide one app that fails often; the verdict says so.
  const failing = rows.filter(([, row]) => row.request_count >= 20 && row.error_rate_pct >= 5);
  const fleet = known && metric === 'error_rate' ? rateVerdict(value) : null;
  const verdict =
    fleet && fleet.tone !== 'critical' && failing.length
      ? {
          tone: 'warning' as const,
          label:
            failing.length === 1 ? 'One app needs a look' : `${failing.length} apps need a look`,
        }
      : fleet;
  const topShare = (whole: number, noun: string) =>
    top && whole > 0 && rows.length > 1
      ? ` ${top.id} had ${share(top.value, whole)} of ${noun}.`
      : '';
  const sentence = !known
    ? null
    : metric === 'requests'
      ? `Across ${rows.length} ${rows.length === 1 ? 'app' : 'apps'}.${topShare(requests, 'them')}`
      : metric === 'errors'
        ? `Worked out from each app’s error rate.${topShare(errors, 'them')}`
        : metric === 'error_rate'
          ? `${count(totals.errors ?? 0)} of ${count(totals.requests ?? 0)} requests failed.${topShare(errors, 'the failures')}`
          : metric === 'cold_rate'
            ? `${count(cold)} of ${count(requests)} requests woke a sleeping app.`
            : (ACCOUNT_SENTENCE[metric] ?? null);

  return (
    <PlanGated error={query.error} feature="Account analytics">
      <div className="flex flex-col gap-5">
        <WindowBar
          scope={scope.project && request.source !== 'slo' ? scope.label : 'All apps'}
          since={range}
          onSince={(next) => onChange({ ...request, since: next })}
        />
        <Answer value={known ? metricValue(metric, value) : '—'} verdict={verdict}>
          {sentence}
        </Answer>
        {phase !== 'ready' && (
          <InlinePhase phase={phase} error={query.error} onRetry={() => void query.refetch()} />
        )}
        {phase === 'ready' && !known && (
          <p role="status" className="text-sm text-muted-foreground">
            Metrics are unavailable right now. Try again in a minute.
          </p>
        )}
        {supported && (
          <section aria-label="Apps">
            <h3 className="text-sm font-medium">
              {failures
                ? 'Apps, most failures first'
                : metric === 'requests'
                  ? 'Apps, busiest first'
                  : 'Apps'}
            </h3>
            {rollup.error || rollup.isPending ? (
              <InlinePhase
                phase={queryPhase({ error: rollup.error, loading: rollup.isPending })}
                error={rollup.error}
                onRetry={() => void rollup.refetch()}
              />
            ) : rollup.data?.source !== 'prometheus' ? (
              <p role="status" className="mt-3 text-xs text-muted-foreground">
                App figures are unavailable right now.
              </p>
            ) : (
              <>
                <AnalyticsBreakdown
                  rows={ranked}
                  label="Apps by selected metric"
                  color={failures ? 'red' : 'blue'}
                />
                {ranked.some((row) => row.onSelect) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Pick an app to see its hours and routes here.
                  </p>
                )}
              </>
            )}
          </section>
        )}
        {top && (failures || LATENCY_METRICS.includes(metric) || metric === 'cold_rate') && (
          <div className="flex justify-end">
            <Button asChild size="sm">
              <Link
                to="/dashboard/apps/$appSlug"
                params={{ appSlug: top.id }}
                search={debuggerSearch(metric, range)}
              >
                {debuggerLabel(metric)} in {top.id}
                <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        )}
      </div>
    </PlanGated>
  );
}

function ResourceDetail({ metric }: { metric: DetailMetric }) {
  const usage = useWorkspaceUsageSummary();
  const instances = useInstances();
  const apps = useApps({ enabled: metric === 'memory' });
  const query = metric === 'memory' ? instances : usage;
  const phase = queryPhase({ error: query.error, loading: query.isPending });
  const resident = (instances.data?.instances ?? []).filter(
    (row) => row.state.toLowerCase() !== 'parked'
  );
  const partial = Boolean(instances.data?.next_before);
  const data = usage.data;
  const over = (data?.overage_gb_hours ?? 0) > 0;
  const left =
    data?.included_gb_hours == null
      ? null
      : Math.max(0, data.included_gb_hours - data.used_gb_hours);
  const value =
    metric === 'memory'
      ? partial
        ? null
        : resident.reduce((n, row) => n + row.ram_mb, 0)
      : metric === 'cpu'
        ? data?.used_cpu_hours
        : over
          ? data?.overage_gb_hours
          : (left ?? data?.used_gb_hours);
  const unit =
    metric === 'memory'
      ? 'MB'
      : metric === 'cpu'
        ? 'CPU hours'
        : over
          ? 'GB-hours over'
          : left != null
            ? 'GB-hours left'
            : 'GB-hours used';
  const gbh = (n: number) => n.toLocaleString('en', { maximumFractionDigits: 2 });
  const slugOf = new Map((apps.data ?? []).map((row) => [row.id, row.slug]));
  const byApp = new Map<string, number>();
  for (const row of resident) {
    const slug = slugOf.get(row.app_id) ?? 'Other apps';
    byApp.set(slug, (byApp.get(slug) ?? 0) + row.ram_mb);
  }
  const memoryRows: BreakdownRow[] = [...byApp]
    .map(([slug, mb]) => ({ id: slug, label: slug, value: mb, formatted: `${count(mb)} MB` }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const sentence =
    metric === 'memory'
      ? partial
        ? 'You have more instances than one page holds, so the full total isn’t available here.'
        : `Held by ${resident.length} running ${resident.length === 1 ? 'instance' : 'instances'} right now. Sleeping apps hold none.`
      : metric === 'cpu'
        ? 'CPU time your apps used this billing period. It’s measured, not billed.'
        : !data
          ? null
          : over
            ? `You’ve used ${gbh(data.used_gb_hours)} GB-hours this billing period, past the ${gbh(data.included_gb_hours ?? 0)} included.`
            : left != null
              ? `${gbh(data.used_gb_hours)} of ${gbh(data.included_gb_hours!)} GB-hours used this billing period. A GB-hour is 1 GB of memory running for an hour.`
              : 'GB-hours used this billing period. A GB-hour is 1 GB of memory running for an hour.';
  return (
    <div className="flex flex-col gap-5">
      <Answer
        value={
          <>
            {phase === 'ready' && value != null ? gbh(value) : '—'}{' '}
            <span className="text-sm font-normal text-muted-foreground">{unit}</span>
          </>
        }
      >
        {phase === 'ready' ? sentence : null}
      </Answer>
      {phase !== 'ready' && (
        <InlinePhase phase={phase} error={query.error} onRetry={() => void query.refetch()} />
      )}
      {metric === 'memory' &&
        phase === 'ready' &&
        apps.isSuccess &&
        !partial &&
        memoryRows.length > 0 && (
          <section aria-label="Apps using the most memory">
            <h3 className="text-sm font-medium">Apps using the most memory</h3>
            <AnalyticsBreakdown rows={memoryRows} label="Apps using the most memory" />
          </section>
        )}
      <div className="flex justify-end">
        <Button asChild size="sm" variant="outline">
          {metric === 'memory' ? (
            <Link to="/dashboard/instances">
              See instances
              <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <Link to="/dashboard/usage">
              See usage
              <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          )}
        </Button>
      </div>
    </div>
  );
}
