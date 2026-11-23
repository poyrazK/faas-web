import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';

/**
 * Reads and writes for the Spending limits page that no other page needs.
 *
 * Egress overage (faas docs/billing.md "Egress overage"): every plan stops at
 * its egress allowance unless a paid account elects to pay beyond it. A
 * company that owns its resources elects for itself. Changing it needs the
 * admin scope and, from a dashboard session, a recent step-up, so the caller
 * owns the idempotency key and replays the same write after the step-up.
 */

const personalEgressKey = [...keys.account, 'egress-overage'] as const;
const orgEgressKey = (org: string) => ['orgs', org, 'egress-overage'] as const;

export function useEgressOverage(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: personalEgressKey,
    queryFn: ({ signal }) => unwrap(api.GET('/v1/account/egress-overage', { signal })),
    enabled: options?.enabled ?? true,
    retry: retryPolicy,
  });
}

export function useOrgEgressOverage(org: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: orgEgressKey(org),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/orgs/{slug}/egress-overage', { params: { path: { slug: org } }, signal })
      ),
    enabled: Boolean(org) && (options?.enabled ?? true),
    retry: retryPolicy,
  });
}

/** Turn paying for egress beyond the allowance on or off, for one subject. */
export function useSetEgressOverage(org: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ enabled, key }: { enabled: boolean; key: string }) => {
      const headers = { 'Idempotency-Key': key };
      return org
        ? unwrap(
            api.PUT('/v1/orgs/{slug}/egress-overage', {
              params: { path: { slug: org } },
              headers,
              body: { enabled },
            })
          )
        : unwrap(api.PUT('/v1/account/egress-overage', { headers, body: { enabled } }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: org ? orgEgressKey(org) : personalEgressKey });
      void qc.invalidateQueries({ queryKey: keys.usage });
    },
  });
}

/** A company's object storage, its ceiling and any scheduled deletion. */
export function useOrgObjectStorageUsage(org: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['orgs', org, 'object-storage-usage'] as const,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/orgs/{organization}/object-storage-usage', {
          params: { path: { organization: org } },
          signal,
        })
      ),
    enabled: Boolean(org) && (options?.enabled ?? true),
    retry: retryPolicy,
  });
}
