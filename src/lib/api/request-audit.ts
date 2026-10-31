import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

export type RequestAuditRecord = components['schemas']['RequestAuditRecord'];
export type RouteCustomerUsage = components['schemas']['RouteCustomerUsage'];
export type RouteCustomerUsageResponse = components['schemas']['RouteCustomerUsageResponse'];

const H = 3_600_000;

/**
 * Audit windows. The API takes at most 31 days at once and deletes records
 * after 30 (faas handlers_request_audit.go, ADR-242), so 30 days is everything.
 */
export const REQUEST_AUDIT_WINDOWS = {
  '1h': H,
  '24h': 24 * H,
  '7d': 7 * 24 * H,
  '30d': 30 * 24 * H,
};
export type RequestAuditWindow = keyof typeof REQUEST_AUDIT_WINDOWS;

/** The API's default page and its ceiling; there is no cursor past 500. */
export const REQUEST_AUDIT_DEFAULT_LIMIT = 100;
export const REQUEST_AUDIT_MAX_LIMIT = 500;

/** An older page of the same window: its start, and the exclusive end the last page stopped at. */
export type RequestAuditPage = { since: string; until: string };

/**
 * Exact gateway-observed requests for one app, newest first. Without `page`,
 * `since` and `until` are both computed when the read runs, so the window is
 * exactly what was asked for and never trips the 31-day bound. With `page`,
 * both are sent as given; it only ever narrows a window that already passed.
 */
export function useRequestAudit(
  slug: string,
  window: RequestAuditWindow,
  limit: number,
  page?: RequestAuditPage
) {
  return useQuery({
    queryKey: ['apps', slug, 'request-audit', window, limit, page ?? null],
    queryFn: ({ signal }) => {
      const until = Date.now();
      return unwrap(
        api.GET('/v1/apps/{slug}/audit/requests', {
          params: {
            path: { slug },
            query: {
              since: page?.since ?? new Date(until - REQUEST_AUDIT_WINDOWS[window]).toISOString(),
              until: page?.until ?? new Date(until).toISOString(),
              limit,
            },
          },
          signal,
        })
      );
    },
    enabled: Boolean(slug),
    retry: retryPolicy,
  });
}

/** Lookbacks the plan may retain (Hobby 3d, Pro 7d, Scale 14d); the API clamps the rest. */
export const ROUTE_CUSTOMER_WINDOWS = ['24h', '3d', '7d', '14d'] as const;
export type RouteCustomerWindow = (typeof ROUTE_CUSTOMER_WINDOWS)[number];

/** Observed customers per route for one of the app's deployments. */
export function useRouteCustomers(slug: string, deploymentId: string, since: RouteCustomerWindow) {
  return useQuery({
    queryKey: ['apps', slug, 'route-customers', deploymentId, since],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/analytics/route-customers', {
          params: { path: { slug }, query: { deployment_id: deploymentId, since } },
          signal,
        })
      ),
    enabled: Boolean(slug && deploymentId),
    retry: retryPolicy,
  });
}
