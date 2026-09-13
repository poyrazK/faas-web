import type { components } from '@/lib/api/schema';

export const WINDOWS = ['1h', '6h', '24h', '72h'] as const;
export const DEBUG_VIEWS = ['requests', 'regressions', 'compare'] as const;
export const QUICK_FILTERS = [
  ['all', 'All requests'],
  ['failed', 'Failed (4xx / 5xx)'],
  ['slow', 'Slow'],
  ['cold', 'Cold start'],
  ['regressions', 'Linked regressions'],
] as const;
export const SLOW_MS = 1000;
export interface DebugSearch extends Record<string, unknown> {
  app?: string;
  debugView?: (typeof DEBUG_VIEWS)[number];
  debugFilter?: (typeof QUICK_FILTERS)[number][0];
  debugWindow?: (typeof WINDOWS)[number];
  request?: string;
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
  return request.deployment_id === regression.deployment_id && request.route === regression.route;
}
