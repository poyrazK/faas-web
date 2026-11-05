import type { AnalyticsGroupBy } from '@/lib/api/queries';

/**
 * Every grouping the analytics selector offers. The `/dashboard/analytics`
 * route's `validateSearch` reads it too, and `validateSearch` is not
 * code-split — it ships in the entry chunk with the route tree — so this lives
 * apart from the chart components that render it.
 */
export const ANALYTICS_GROUPS: { value: AnalyticsGroupBy; label: string }[] = [
  { value: 'route', label: 'Route' },
  { value: 'country', label: 'Country' },
  { value: 'referrer_host', label: 'Referrer' },
  { value: 'ua_family', label: 'Client' },
  { value: 'status', label: 'Status' },
  { value: 'consumer_id', label: 'Consumer' },
];
