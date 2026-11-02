import type { AnalyticsGroupBy, AppAnalyticsTimeseriesOptions } from '@/lib/api/queries';

/**
 * The request-analytics search keys and their validation, apart from the
 * panel itself: route `validateSearch` and `beforeLoad` are not code-split, so
 * whatever they import lands in the main bundle. This module is constants only.
 */

export type AnalyticsMethod = NonNullable<AppAnalyticsTimeseriesOptions['method']>;

export const WINDOWS = ['24h', '3d', '7d'] as const;
/** Every grouping the selector offers; the routes' search validation reads it too. */
export const ANALYTICS_GROUPS: { value: AnalyticsGroupBy; label: string }[] = [
  { value: 'route', label: 'Route' },
  { value: 'country', label: 'Country' },
  { value: 'referrer_host', label: 'Referrer' },
  { value: 'ua_family', label: 'Client' },
  { value: 'status', label: 'Status' },
  { value: 'consumer_id', label: 'Consumer' },
];
const METHODS: readonly AnalyticsMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

/** The Metrics section's request-analytics state, kept in the app page URL. */
export type AppAnalyticsSearch = {
  analyticsSince?: (typeof WINDOWS)[number];
  analyticsGroup?: AnalyticsGroupBy;
  analyticsRoute?: string;
  analyticsMethod?: AnalyticsMethod;
};

/** Reads the analytics keys from a search object; unknown values are dropped. */
export function validateAppAnalyticsSearch(search: Record<string, unknown>): AppAnalyticsSearch {
  const since = WINDOWS.find((w) => w === search.analyticsSince);
  const group = ANALYTICS_GROUPS.find(({ value }) => value === search.analyticsGroup)?.value;
  const method = METHODS.find((m) => m === search.analyticsMethod);
  const route =
    typeof search.analyticsRoute === 'string' && search.analyticsRoute.trim()
      ? search.analyticsRoute
      : undefined;
  return {
    ...(since ? { analyticsSince: since } : {}),
    ...(group ? { analyticsGroup: group } : {}),
    // A route filter is only meaningful as a pair, and only when grouping by route.
    ...(route && method && (!group || group === 'route')
      ? { analyticsRoute: route, analyticsMethod: method }
      : {}),
  };
}
