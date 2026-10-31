import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys } from './queries';
import type { components } from './schema';

export type DomainDetail = components['schemas']['CustomDomainResponse'];

/**
 * One custom domain with its live certificate (`GET /v1/domains/{domain}`).
 *
 * Unlike the list, the handler dials port 443 for a verified domain and reports
 * what it found — the leaf's expiry and SANs, or `dial_failed:<reason>` — so it
 * is read only while the detail is open and never served from cache.
 */
export function useDomainDetail(domain: string | null) {
  return useQuery({
    queryKey: ['domains', domain, 'detail'],
    enabled: domain !== null,
    staleTime: 0,
    queryFn: () =>
      unwrap(api.GET('/v1/domains/{domain}', { params: { path: { domain: domain! } } })),
  });
}

/**
 * Make a verified domain its app's default (`POST /v1/domains/{domain}/default`).
 *
 * The write replaces the app's previous default, so the whole list is re-read
 * rather than patched, and the apps too: their `canonical_url` follows it.
 */
export function useSetDefaultDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) =>
      unwrap(api.POST('/v1/domains/{domain}/default', { params: { path: { domain } } })),
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.domains }),
        qc.invalidateQueries({ queryKey: keys.apps }),
      ]);
    },
  });
}

/**
 * Why a domain cannot be made the default, in the order the handler checks
 * (faas handlers_ext.go setDefaultDomain): verification, then environment
 * binding, then wildcard. `null` means it can.
 */
export function defaultBlocker(
  d: Pick<DomainDetail, 'domain' | 'verified' | 'environment' | 'default'>
): 'already' | 'unverified' | 'environment' | 'wildcard' | null {
  if (d.default) return 'already';
  if (!d.verified) return 'unverified';
  if (d.environment) return 'environment';
  if (d.domain.startsWith('*.')) return 'wildcard';
  return null;
}
