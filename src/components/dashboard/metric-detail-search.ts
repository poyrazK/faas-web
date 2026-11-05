/** Lightweight URL contract, shared by all analytics entry points. */
export const METRIC_LABELS = {
  requests: 'Requests',
  errors: 'Errors',
  error_rate: 'Error rate',
  p50: 'Response time p50',
  p95: 'Response time p95',
  p99: 'Response time p99',
  cold_boots: 'Cold boots',
  cold_rate: 'Cold start rate',
  wake_p95: 'Fleet wake p95',
  throttled: 'Throttled requests',
  memory: 'Memory now',
  allowance: 'GB-hours allowance',
  cpu: 'CPU hours',
} as const;
export type DetailMetric = keyof typeof METRIC_LABELS;
export const DETAIL_WINDOWS = ['5m', '15m', '1h', '6h', '12h', '24h', '3d', '7d', '14d', '15d'];
export type DetailMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type DetailGroup =
  'route' | 'country' | 'referrer_host' | 'ua_family' | 'status' | 'consumer_id';
export interface MetricDetailRequest {
  metric: DetailMetric;
  app?: string;
  since: string;
  until?: string;
  route?: string;
  method?: DetailMethod;
  group?: DetailGroup;
  source?: 'rollup' | 'slo';
}
export type MetricDetailSearch = {
  inspect?: DetailMetric;
  inspectApp?: string;
  inspectSince?: string;
  inspectUntil?: string;
  inspectRoute?: string;
  inspectMethod?: DetailMethod;
  inspectGroup?: DetailGroup;
  inspectSource?: 'rollup' | 'slo';
};
export function isDetailMetric(value: unknown): value is DetailMetric {
  return typeof value === 'string' && Object.hasOwn(METRIC_LABELS, value);
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
export function validateMetricDetailSearch(search: Record<string, unknown>): MetricDetailSearch {
  if (!isDetailMetric(search.inspect)) return {};
  const since =
    typeof search.inspectSince === 'string' &&
    (DETAIL_WINDOWS.includes(search.inspectSince) || timestamp(search.inspectSince))
      ? search.inspectSince
      : '24h';
  const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].find(
    (m) => m === search.inspectMethod
  ) as DetailMethod | undefined;
  const group = ['route', 'country', 'referrer_host', 'ua_family', 'status', 'consumer_id'].find(
    (g) => g === search.inspectGroup
  ) as DetailGroup | undefined;
  const app =
    typeof search.inspectApp === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(search.inspectApp)
      ? search.inspectApp
      : undefined;
  const accountWindows =
    search.inspectSource === 'slo'
      ? ['1h', '24h', '7d']
      : ['5m', '15m', '1h', '6h', '24h', '7d', '15d'];
  const until =
    timestamp(search.inspectUntil) &&
    (!timestamp(since) || Date.parse(search.inspectUntil) > Date.parse(since))
      ? search.inspectUntil
      : undefined;
  const route =
    app && method && typeof search.inspectRoute === 'string' && search.inspectRoute.length <= 256
      ? search.inspectRoute
      : undefined;
  return {
    inspect: search.inspect,
    inspectSince: app || accountWindows.includes(since) ? since : '24h',
    ...(app ? { inspectApp: app } : {}),
    ...(app && until ? { inspectUntil: until } : {}),
    ...(route
      ? { inspectRoute: route, inspectMethod: method, inspectGroup: 'route' }
      : group
        ? { inspectGroup: group }
        : {}),
    inspectSource: search.inspectSource === 'slo' ? 'slo' : 'rollup',
  };
}
export function detailSearch(request: MetricDetailRequest): MetricDetailSearch {
  return {
    inspect: request.metric,
    inspectApp: request.app,
    inspectSince: request.since,
    inspectUntil: request.until,
    inspectRoute: request.route,
    inspectMethod: request.method,
    inspectGroup: request.group,
    inspectSource: request.source,
  };
}
export function clearDetailSearch<T extends Record<string, unknown>>(search: T) {
  const keys = Object.keys(detailSearch({ metric: 'requests', since: '24h' }));
  return Object.fromEntries(Object.entries(search).filter(([key]) => !keys.includes(key))) as Omit<
    T,
    keyof MetricDetailSearch
  >;
}
export function detailRequest(search: MetricDetailSearch): MetricDetailRequest | undefined {
  return search.inspect
    ? {
        metric: search.inspect,
        app: search.inspectApp,
        since: search.inspectSince ?? '24h',
        until: search.inspectUntil,
        route: search.inspectRoute,
        method: search.inspectMethod,
        group: search.inspectGroup,
        source: search.inspectSource,
      }
    : undefined;
}
