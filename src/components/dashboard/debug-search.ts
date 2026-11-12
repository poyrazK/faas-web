import type { components } from '@/lib/api/schema';

export const WINDOWS = ['1h', '6h', '24h', '72h'] as const;
export const DEBUG_VIEWS = [
  'requests',
  'regressions',
  'dependencies',
  'coverage',
  'running',
  'compare',
] as const;
export type DebugView = (typeof DEBUG_VIEWS)[number];
/**
 * Views over production-debugger routes (faas catalog: /debug/requests and
 * everything under it, /debug/compare, /debug/status). The rest belong to the
 * beta `debug` family every account has.
 */
export const PREVIEW_DEBUG_VIEWS: ReadonlySet<DebugView> = new Set(['requests', 'compare']);
export const DEBUG_VIEW_LABELS: Record<DebugView, string> = {
  requests: 'Requests',
  regressions: 'Regressions',
  dependencies: 'Dependencies',
  coverage: 'Coverage',
  running: 'Running',
  compare: 'Compare',
};
export const QUICK_FILTERS = [
  ['all', 'All requests'],
  ['failed', 'Failed requests'],
  ['slow', 'Slow requests'],
  ['cold', 'Requests that woke the app'],
  ['regressions', 'Routes that got worse'],
] as const;
/** The window choices in words; the URL keeps the short form. */
export const WINDOW_LABELS: Record<(typeof WINDOWS)[number], string> = {
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '72h': 'Last 3 days',
};
export const SLOW_MS = 1000;
export interface DebugSearch extends Record<string, unknown> {
  app?: string;
  debugView?: DebugView;
  debugFilter?: (typeof QUICK_FILTERS)[number][0];
  debugWindow?: (typeof WINDOWS)[number];
  request?: string;
  wake?: string;
  regression?: string;
  debugSource?: string;
  debugMirror?: string;
  debugRoute?: string;
  debugQuery?: string;
}
export function validateDebugSearch(raw: Record<string, unknown>): DebugSearch {
  const search = { ...raw } as DebugSearch;
  for (const key of [
    'app',
    'request',
    'wake',
    'debugSource',
    'debugMirror',
    'debugRoute',
    'debugQuery',
  ] as const) {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) search[key] = undefined;
  }
  if (!DEBUG_VIEWS.includes(raw.debugView as never)) search.debugView = undefined;
  if (!QUICK_FILTERS.some(([value]) => value === raw.debugFilter)) search.debugFilter = undefined;
  if (!WINDOWS.includes(raw.debugWindow as never)) search.debugWindow = undefined;
  try {
    const tuple: unknown =
      typeof raw.regression === 'string' ? JSON.parse(raw.regression) : raw.regression;
    search.regression =
      Array.isArray(tuple) &&
      tuple.length === 2 &&
      tuple.every((item) => typeof item === 'string' && item.trim())
        ? JSON.stringify(tuple)
        : undefined;
  } catch {
    search.regression = undefined;
  }
  return search;
}
export type DebugSelection = {
  search: DebugSearch;
  onSelect: (patch: Partial<DebugSearch>) => void;
};
export type Regression = components['schemas']['DebugRegressionItem'];
export function regressionKey(item: Regression) {
  return JSON.stringify([item.deployment_id, item.route]);
}
export function matchesRegression(
  request: components['schemas']['DebugTelemetryRequestItem'],
  regression: Regression
) {
  // A bucket with no deployment or route cannot match; two absences are not equal.
  return (
    request.deployment_id !== undefined &&
    request.route !== undefined &&
    request.deployment_id === regression.deployment_id &&
    request.route === regression.route
  );
}
