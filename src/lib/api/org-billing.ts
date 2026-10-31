import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';

const key = (org: string, part: string) => ['orgs', org, 'billing', part] as const;

/**
 * A company's billing status. Membership and usage:read (faas
 * org_billing_routes.go, OrgActionView); the plan is the organization's own.
 */
export function useOrgBillingStatus(org: string) {
  return useQuery({
    queryKey: key(org, 'status'),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/orgs/{slug}/billing/status', { params: { path: { slug: org } }, signal })
      ),
    enabled: Boolean(org),
  });
}

/** A company's application usage this month, one row per app. */
export function useOrgUsage(org: string) {
  return useQuery({
    queryKey: key(org, 'usage'),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/orgs/{slug}/usage', { params: { path: { slug: org } }, signal })),
    enabled: Boolean(org),
  });
}
