import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

export type DomainHosts = components['schemas']['CustomDomainHostsResponse'];

/**
 * A wildcard custom domain's host allowlist, `/v1/domains/{domain}/hosts`
 * (faas ADR-520 amendment 2, pkg/apid/domainhosts). The edge issues an
 * on-demand certificate for any name below a verified wildcard, at most 40 new
 * names in any 7 days, so random server names can spend that budget. With a
 * list, only the listed names get certificates; routing does not change.
 */

/** faas api.CustomDomainTLSAllowedHostsMax (pkg/api/limits.go). */
export const HOSTS_MAX = 100;

/** The label the domain doctor probes below a wildcard (faas state.WildcardProbeLabel). */
const PROBE_LABEL = 'gregale-wildcard-check';

/** faas api.TrafficPolicyMaxHostnameBytes, the longest host ValidateCustomDomainName accepts. */
const HOST_MAX_BYTES = 253;

/** faas state.wildcardHostNameRE: DNS labels, no wildcard of its own. */
const NAME_RULE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export const isWildcardDomain = (domain: string) => domain.startsWith('*.');

/** `example.com` for `*.example.com`. */
export const wildcardSuffix = (domain: string) => domain.replace(/^\*\./, '');

/** The host the doctor dials, which every allowlist admits (state.WildcardProbeHost). */
export const probeHost = (domain: string) => `${PROBE_LABEL}.${wildcardSuffix(domain)}`;

/**
 * Names typed one per line or comma-separated, read the way faas
 * state.NormalizeWildcardHostNames reads them: lower-cased, the wildcard's
 * suffix trimmed so a full host works too, each checked as a host once joined
 * to the suffix, then sorted and de-duplicated. `invalid` keeps what was
 * typed, in order, so the form can quote it back.
 */
export function parseHostNames(
  domain: string,
  raw: string
): { names: string[]; invalid: string[] } {
  const suffix = wildcardSuffix(domain).toLowerCase();
  const names = new Set<string>();
  const invalid: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    if (!token) continue;
    const lower = token.toLowerCase();
    const name = lower.endsWith(`.${suffix}`) ? lower.slice(0, -(suffix.length + 1)) : lower;
    const host = `${name}.${suffix}`;
    const labelsFit = host.split('.').every((label) => label.length <= 63);
    if (NAME_RULE.test(name) && labelsFit && host.length <= HOST_MAX_BYTES) names.add(name);
    else invalid.push(token);
  }
  return { names: [...names].sort(), invalid };
}

export const domainHostsKey = (domain: string) => ['domains', domain, 'hosts'] as const;

/** The allowlist, read while a wildcard's detail is open. */
export function useDomainHosts(domain: string) {
  return useQuery({
    queryKey: domainHostsKey(domain),
    retry: retryPolicy,
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/domains/{domain}/hosts', { params: { path: { domain } }, signal })),
  });
}

/** Replace the list (PUT); the answer is the saved, normalised list. */
export function useSetDomainHosts(domain: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (names: string[]) =>
      unwrap(
        api.PUT('/v1/domains/{domain}/hosts', { params: { path: { domain } }, body: { names } })
      ),
    onSuccess: (saved) => qc.setQueryData(domainHostsKey(domain), saved),
  });
}

/** Remove the list (DELETE): every name below the wildcard may hold a certificate again. */
export function useClearDomainHosts(domain: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.DELETE('/v1/domains/{domain}/hosts', { params: { path: { domain } } })),
    onSuccess: () =>
      qc.setQueryData<DomainHosts>(domainHostsKey(domain), {
        domain,
        names: [],
        restricted: false,
      }),
  });
}
