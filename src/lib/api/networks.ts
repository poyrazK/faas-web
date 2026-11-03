import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

/**
 * Private networks (faas docs/private-networks.md, handlers_private_networks.go,
 * handlers_apps_private_network.go).
 *
 * A network is an account-owned IPv4 RFC1918 range (/16–/28) in a region,
 * with an optional reusable policy: an allowlist of CIDRs and protocol/port
 * firewall rules applied to every attached app. Two networks in the same
 * region with non-overlapping ranges can be peered; a peering is `pending`
 * until the fabric converges and never implies reachability before `ready`.
 *
 * An app has at most one attachment. Every write answers `pending`, and only
 * a `ready` attachment admits private traffic; `pending` and `error` keep it
 * blocked. Pro and Scale only (`402 plan_private_network_not_allowed`);
 * `503 private_network_not_enabled` when the installation has not turned the
 * fabric or attachments on.
 */

export type PrivateNetwork = components['schemas']['PrivateNetwork'];
export type FirewallRule = components['schemas']['PrivateNetworkFirewallRule'];
export type NetworkMembers = components['schemas']['PrivateNetworkMembersResponse'];
export type NetworkPeering = components['schemas']['PrivateNetworkPeering'];
export type AppNetworkAttachment = components['schemas']['AppPrivateNetworkAttachmentResponse'];
export type CreateNetwork = components['schemas']['CreatePrivateNetworkRequest'];
export type NetworkPolicy = components['schemas']['UpdatePrivateNetworkPolicyRequest'];
export type AttachNetwork = components['schemas']['AppPrivateNetworkAttachmentRequest'];

/** The identifier grammar every network, region and peering id follows. */
export const NETWORK_ID = /^[a-z][a-z0-9-]{0,62}$/;

const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

/** A syntactically valid IPv4 CIDR; the server owns containment and overlap rules. */
export function isCidr(value: string): boolean {
  const m = IPV4_CIDR.exec(value.trim());
  if (!m) return false;
  const octets = m.slice(1, 5).map(Number);
  return octets.every((o) => o <= 255) && Number(m[5]) <= 32;
}

/** One CIDR per line or comma; blank entries dropped. */
export function parseCidrs(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** A TCP/UDP port or inclusive range such as 443 or 8000-8080. */
export function isPortSpec(value: string): boolean {
  const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(value.trim());
  if (!m) return false;
  const lo = Number(m[1]);
  const hi = m[2] === undefined ? lo : Number(m[2]);
  return lo >= 1 && hi <= 65535 && lo <= hi;
}

export const networkKeys = {
  all: (accountId: string) => ['account', accountId, 'networks'] as const,
  detail: (accountId: string, id: string) => ['account', accountId, 'networks', id] as const,
  attachment: (slug: string) => ['apps', slug, 'network', 'private'] as const,
};

export function useNetworks(accountId: string, enabled = true) {
  return useQuery({
    queryKey: networkKeys.all(accountId),
    queryFn: ({ signal }) => unwrap(api.GET('/v1/networks', { signal })),
    enabled: Boolean(accountId) && enabled,
    retry: retryPolicy,
    staleTime: 15_000,
  });
}

export function useNetworkMembers(accountId: string, id: string) {
  return useQuery({
    queryKey: [...networkKeys.detail(accountId, id), 'members'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/networks/{id}/members', { params: { path: { id } }, signal })),
    enabled: Boolean(accountId && id),
    retry: retryPolicy,
    staleTime: 15_000,
  });
}

export function useNetworkPeerings(accountId: string, id: string) {
  return useQuery({
    queryKey: [...networkKeys.detail(accountId, id), 'peerings'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/networks/{id}/peerings', { params: { path: { id } }, signal })),
    enabled: Boolean(accountId && id),
    retry: retryPolicy,
    staleTime: 10_000,
  });
}

/**
 * apid wraps network and peering creation and peering removal in its
 * idempotency middleware (server.go:2100-2106) although the spec does not
 * declare the header, so a retried write replays instead of acting twice.
 */
const idempotencyKey = () => crypto.randomUUID();

export function useCreateNetwork(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key = idempotencyKey() }: { body: CreateNetwork; key?: string }) =>
      unwrap(api.POST('/v1/networks', { body, headers: { 'Idempotency-Key': key } })),
    onSettled: () => qc.invalidateQueries({ queryKey: networkKeys.all(accountId) }),
  });
}

export function useDeleteNetwork(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/networks/{id}', { params: { path: { id } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: networkKeys.all(accountId) }),
  });
}

export function useUpdateNetworkPolicy(accountId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NetworkPolicy) =>
      unwrap(api.PUT('/v1/networks/{id}/policy', { params: { path: { id } }, body })),
    onSettled: () => qc.invalidateQueries({ queryKey: networkKeys.all(accountId) }),
  });
}

export function useCreatePeering(accountId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ peer, key = idempotencyKey() }: { peer: string; key?: string }) =>
      unwrap(
        api.POST('/v1/networks/{id}/peerings', {
          params: { path: { id } },
          body: { peer_network_id: peer },
          headers: { 'Idempotency-Key': key },
        })
      ),
    // A peering involves both networks, so both lists change.
    onSettled: () => qc.invalidateQueries({ queryKey: networkKeys.all(accountId) }),
  });
}

export function useDeletePeering(accountId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ peering, key = idempotencyKey() }: { peering: string; key?: string }) =>
      unwrap(
        api.DELETE('/v1/networks/{id}/peerings/{peer_id}', {
          params: { path: { id, peer_id: peering } },
          headers: { 'Idempotency-Key': key },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: networkKeys.all(accountId) }),
  });
}

export function useAppNetworkAttachment(slug: string) {
  return useQuery({
    queryKey: networkKeys.attachment(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/network/private', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
    staleTime: 10_000,
  });
}

export function useAttachNetwork(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AttachNetwork) =>
      unwrap(api.PUT('/v1/apps/{slug}/network/private', { params: { path: { slug } }, body })),
    onSettled: () => qc.invalidateQueries({ queryKey: networkKeys.attachment(slug) }),
  });
}

export function useDetachNetwork(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.DELETE('/v1/apps/{slug}/network/private', { params: { path: { slug } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: networkKeys.attachment(slug) }),
  });
}
