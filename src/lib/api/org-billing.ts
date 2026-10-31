import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { useUsageSummary } from './queries';
import type { components } from './schema';
import { useWorkspaceTarget } from './workspace-apps';

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

type UsageRow = components['schemas']['UsageResponse'];

/**
 * The compute allowance a workspace's overview reads. A company has no usage
 * summary route, so its figures are summed from `/v1/orgs/{slug}/usage`; it has
 * no overage amount or cap either, so those stay absent rather than invented.
 */
export interface WorkspaceUsageSummary {
  month: string;
  used_gb_hours: number;
  /** null when the allowance is not on the wire: a company with no usage rows yet. */
  included_gb_hours: number | null;
  overage_gb_hours: number;
  overage_cents?: number;
  used_cpu_hours?: number;
}

const MB_SECONDS_PER_GB_HOUR = 1024 * 3600;
const USEC_PER_HOUR = 3_600_000_000;

/**
 * A company's month, summed from its per-app rows. `included_gb_hours` is the
 * organization plan's allowance, repeated on every row (faas handlers_ext.go
 * getUsage, MustLimitsFor(acct.Plan)).
 */
export function summarizeOrgUsage(rows: UsageRow[], month: string): WorkspaceUsageSummary {
  const used = rows.reduce((sum, row) => sum + row.mb_seconds, 0) / MB_SECONDS_PER_GB_HOUR;
  const included = rows[0]?.included_gb_hours ?? null;
  return {
    month,
    used_gb_hours: used,
    included_gb_hours: included,
    overage_gb_hours: included === null ? 0 : Math.max(0, used - included),
    used_cpu_hours: rows.reduce((sum, row) => sum + (row.cpu_usec ?? 0), 0) / USEC_PER_HOUR,
  };
}

/**
 * The active workspace's compute allowance this month: the account's usage
 * summary, or the company's summed usage in a company workspace. Nothing is
 * read until the workspace is known, so a chosen company is never read as
 * personal.
 */
export function useWorkspaceUsageSummary(): UseQueryResult<WorkspaceUsageSummary> {
  const { org, ready } = useWorkspaceTarget();
  const personal = useUsageSummary({ enabled: ready && !org });
  // The month apid bills by (UTC), passed explicitly so the label is exact.
  const month = new Date().toISOString().slice(0, 7);
  const company = useQuery({
    queryKey: [...key(org ?? '', 'usage'), month],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/orgs/{slug}/usage', {
          params: { path: { slug: org! }, query: { month } },
          signal,
        })
      ),
    enabled: ready && Boolean(org),
    refetchInterval: 30_000,
    select: (rows: UsageRow[]) => summarizeOrgUsage(rows, month),
  });
  return org ? company : (personal as UseQueryResult<WorkspaceUsageSummary>);
}
