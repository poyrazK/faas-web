import type { AppMetrics } from '@/lib/api/queries';
import type { AnalyticsPoint } from './analytics-grid';
import type { DetailMetric } from './metric-detail-search';

export const REQUEST_METRICS = [
  'requests',
  'errors',
  'error_rate',
  'p50',
  'p95',
  'p99',
  'cold_boots',
  'cold_rate',
] as const;
export const METRIC_SERIES: Partial<Record<DetailMetric, keyof AnalyticsPoint>> = {
  requests: 'requests',
  errors: 'error_requests',
  error_rate: 'error_rate_pct',
  p50: 'p50_ms',
  p95: 'p95_ms',
  p99: 'p99_ms',
  cold_boots: 'cold_boots',
};
export function metricNumber(metric: DetailMetric, point: AnalyticsPoint): number | null {
  if (
    ((metric.startsWith('p') && metric !== 'requests') ||
      metric === 'error_rate' ||
      metric === 'cold_rate') &&
    point.requests === 0
  )
    return null;
  if (metric === 'cold_rate')
    return point.requests ? (point.cold_boots / point.requests) * 100 : null;
  const key = METRIC_SERIES[metric];
  return key ? Number(point[key]) : null;
}
export function metricValue(
  metric: DetailMetric,
  value: number | null | undefined,
  compact = false
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const number = new Intl.NumberFormat('en', {
    ...(compact ? { notation: 'compact' as const } : {}),
    maximumFractionDigits: metric === 'error_rate' || metric === 'cold_rate' ? 2 : 1,
    minimumFractionDigits: metric === 'error_rate' || metric === 'cold_rate' ? 2 : 0,
  }).format(value);
  return `${number}${metric === 'error_rate' || metric === 'cold_rate' ? '%' : ['p50', 'p95', 'p99', 'wake_p95'].includes(metric) ? ' ms' : ''}`;
}
export function utcLabel(iso: string, full = false) {
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return iso;
  return value.toLocaleString('en-GB', {
    timeZone: 'UTC',
    ...(full ? { year: 'numeric' as const } : {}),
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
/** Newer servers supply this additive field; absence is not proof of completeness. */
export function incompleteTelemetry(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'telemetry_complete' in value &&
    value.telemetry_complete === false
  );
}

/** Compare equal counts of complete UTC hours. Partial edge buckets never enter a delta. */
export function compareRequestHalves(
  points: Pick<AnalyticsPoint, 'start' | 'requests' | 'error_requests' | 'cold_boots'>[],
  metric: string,
  from?: string,
  until?: string
) {
  if (!['requests', 'errors', 'cold_boots'].includes(metric) || !from || !until) return null;
  const key = metric === 'errors' ? 'error_requests' : (metric as 'requests' | 'cold_boots');
  const full = points.filter(
    (point) =>
      Date.parse(point.start) >= Date.parse(from) &&
      Date.parse(point.start) + 3_600_000 <= Date.parse(until)
  );
  if (full.length < 4) return null;
  const hours = Math.floor(full.length / 2);
  const first = full.slice(0, hours),
    last = full.slice(-hours);
  const before = first.reduce((sum, point) => sum + point[key], 0);
  const after = last.reduce((sum, point) => sum + point[key], 0);
  return {
    hours,
    before,
    after,
    delta: before === 0 ? null : ((after - before) / before) * 100,
    firstFrom: first[0].start,
    firstUntil: new Date(Date.parse(first.at(-1)!.start) + 3_600_000).toISOString(),
    lastFrom: last[0].start,
    lastUntil: new Date(Date.parse(last.at(-1)!.start) + 3_600_000).toISOString(),
  };
}

export function appMetricNumber(metric: DetailMetric, row: AppMetrics): number | null {
  if (metric === 'requests') return row.request_count;
  if (metric === 'errors') return Math.round((row.request_count * row.error_rate_pct) / 100);
  if (metric === 'error_rate') return row.request_count ? row.error_rate_pct : null;
  if (metric === 'cold_rate') return row.request_count ? row.cold_start_pct : null;
  if (metric === 'p50') return row.request_count ? row.latency_p50_ms : null;
  if (metric === 'p95') return row.request_count ? row.latency_p95_ms : null;
  if (metric === 'p99') return row.request_count ? row.latency_p99_ms : null;
  return null;
}
