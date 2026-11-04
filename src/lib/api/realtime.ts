import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Managed realtime (faas ADR-156, the realtime preview family, ADR-1323 fair
 * use, ADR-1324 occupancy).
 *
 * An app's endpoints are durable configuration; everything live (connections,
 * occupancy, publish) is asked of the realtime fleet at request time, so the
 * answers carry `partial` when a node did not reply. Callback and client
 * tokens are write-only (the API returns a constant mask), and subscription
 * tickets are bearer credentials returned once: both travel through direct
 * calls rather than `useMutation`, so the plaintext never sits in the
 * mutation cache's `variables` or `data`.
 */

type S = components['schemas'];
export type RealtimeEndpoint = S['ManagedRealtimeEndpointResponse'];
export type CreateRealtimeEndpoint = S['CreateManagedRealtimeEndpointRequest'];
export type UpdateRealtimeEndpoint = S['UpdateManagedRealtimeEndpointRequest'];
export type RealtimeAuthMode = RealtimeEndpoint['auth_mode'];
export type RealtimeAlgorithm = NonNullable<RealtimeEndpoint['auth_algorithms']>[number];
export type RealtimeConnection = S['ManagedRealtimeConnectionResponse'];
export type RealtimeConnectionList = S['ManagedRealtimeConnectionListResponse'];
export type RealtimeOccupancy = S['ManagedRealtimeOccupancyResponse'];
export type RealtimePublishResult = S['ManagedRealtimePublishResponse'];
export type RealtimeRetainedMessage = S['ManagedRealtimeRetainedMessageResponse'];
export type RealtimeConsumerGroup = S['RealtimeConsumerGroup'];
export type RealtimeAccess = S['ManagedRealtimeAccessResponse'];
export type RealtimeAccessAction = S['ManagedRealtimeAccessRequest']['action'];
export type RealtimeTicketRequest = S['RealtimeTicketRequest'];
export type RealtimeTicket = S['RealtimeTicketResponse'];
export type RealtimePushProvider = S['ManagedRealtimePushProvider'];
export type RealtimeUsage = S['RealtimeUsageResponse'];
export type RealtimeDelivery = 'live' | 'retained';

export const REALTIME_ALGORITHMS: readonly RealtimeAlgorithm[] = [
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
];
/** apid caps one occupancy read at 20 channels (openapi `maxItems: 20`). */
export const OCCUPANCY_MAX_CHANNELS = 20;
/** A ticket lives 1 to 300 seconds and names 1 to 32 channels (RealtimeTicketRequest). */
export const TICKET_MAX_TTL = 300;
export const TICKET_MAX_CHANNELS = 32;
/**
 * Occupancy is polled because the live count arrives only on the resumable
 * WebSocket protocol, from the app's own host, which the console's
 * `connect-src` does not allow (src/lib/security-headers.ts). apid sends
 * frames at most once a second; five seconds keeps the REST read cheap.
 */
export const OCCUPANCY_POLL_MS = 5_000;

export const realtimeKeys = {
  all: (slug: string) => ['apps', slug, 'realtime'] as const,
  endpoints: (slug: string) => [...realtimeKeys.all(slug), 'endpoints'] as const,
  endpoint: (slug: string, id: string) => [...realtimeKeys.all(slug), 'endpoint', id] as const,
  connections: (slug: string, id: string) =>
    [...realtimeKeys.endpoint(slug, id), 'connections'] as const,
  occupancy: (slug: string, id: string, channels: readonly string[]) =>
    [...realtimeKeys.endpoint(slug, id), 'occupancy', channels.join('\n')] as const,
  history: (slug: string, id: string, channel: string) =>
    [...realtimeKeys.endpoint(slug, id), 'history', channel] as const,
  groups: (slug: string, id: string, channel: string) =>
    [...realtimeKeys.endpoint(slug, id), 'groups', channel] as const,
  access: (slug: string, id: string, principal: string) =>
    [...realtimeKeys.endpoint(slug, id), 'access', principal] as const,
  push: (slug: string, id: string) => [...realtimeKeys.endpoint(slug, id), 'push'] as const,
  usage: (accountId: string) => ['account', accountId, 'realtime-usage'] as const,
};

/** The URL clients open: `wss://<app host>/__gregale/realtime/<endpoint id>` (docs/realtime.md). */
export function realtimeClientUrl(appUrl: string | undefined, endpointId: string) {
  if (!appUrl) return undefined;
  try {
    const host = new URL(appUrl).host;
    return host ? `wss://${host}/__gregale/realtime/${encodeURIComponent(endpointId)}` : undefined;
  } catch {
    return undefined;
  }
}

/** UTF-8 text to the standard base64 apid decodes (`format: byte`). */
export function textToBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** A retained payload as text, or undefined when it is binary or not UTF-8. */
export function base64ToText(data: string, binary: boolean) {
  if (binary) return undefined;
  try {
    const raw = atob(data);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Decoded payload size, for the 1 MiB live / 4 KiB retained limits. */
export function utf8Bytes(text: string) {
  return new TextEncoder().encode(text).length;
}

// --- Endpoints ----------------------------------------------------------------

export function useRealtimeEndpoints(slug: string) {
  return useQuery({
    queryKey: realtimeKeys.endpoints(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/realtime/endpoints', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
  });
}

/** Direct by design: the body carries the callback and client tokens. */
export function createRealtimeEndpoint(slug: string, body: CreateRealtimeEndpoint) {
  return unwrap(
    api.POST('/v1/apps/{slug}/realtime/endpoints', { params: { path: { slug } }, body })
  );
}

/** Direct by design, like create: a PATCH may replace a token. Omitted fields stay. */
export function updateRealtimeEndpoint(slug: string, id: string, body: UpdateRealtimeEndpoint) {
  return unwrap(
    api.PATCH('/v1/apps/{slug}/realtime/endpoints/{id}', {
      params: { path: { slug, id } },
      body,
    })
  );
}

/**
 * Promote a new static bearer token and keep accepting the old one until the
 * grace period ends (faas handlers.go:748). Direct: the body is a secret.
 */
export function rotateRealtimeAuth(
  slug: string,
  id: string,
  body: S['RotateManagedRealtimeAuthRequest']
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/realtime/endpoints/{id}/auth/rotate', {
      params: { path: { slug, id } },
      body,
    })
  );
}

/** Refuse the previous static bearer token now rather than at its deadline. */
export function useFinalizeRealtimeAuth(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/apps/{slug}/realtime/endpoints/{id}/auth/rotate/finalize', {
          params: { path: { slug, id } },
        })
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: realtimeKeys.endpoints(slug) }),
  });
}

export function useDeleteRealtimeEndpoint(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/realtime/endpoints/{id}', { params: { path: { slug, id } } })
      ),
    onSettled: (_data, _error, id) => {
      void qc.invalidateQueries({ queryKey: realtimeKeys.endpoints(slug) });
      qc.removeQueries({ queryKey: realtimeKeys.endpoint(slug, id) });
    },
  });
}

// --- Account usage -------------------------------------------------------------

/** Open connections against the plan's fair-use limit (`GET /v1/usage/realtime`). */
export function useRealtimeUsage(accountId: string) {
  return useQuery({
    queryKey: realtimeKeys.usage(accountId),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/usage/realtime', { params: { query: { hours: 24 } }, signal })),
    enabled: Boolean(accountId),
    retry: retryPolicy,
  });
}

// --- Connections ---------------------------------------------------------------

export interface ConnectionFilters {
  principal?: string;
  channel?: string;
}

const CONNECTION_PAGE = 100;

/**
 * A point-in-time fleet inventory, paged by apid's opaque cursor. The filters
 * are part of the key, so changing one starts again from the first page.
 */
export function useRealtimeConnections(slug: string, id: string, filters: ConnectionFilters) {
  const principal = filters.principal?.trim() || undefined;
  const channel = filters.channel?.trim() || undefined;
  return useInfiniteQuery({
    queryKey: [...realtimeKeys.connections(slug, id), principal ?? '', channel ?? ''],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/realtime/endpoints/{id}/connections', {
          params: {
            path: { slug, id },
            query: {
              limit: CONNECTION_PAGE,
              ...(principal ? { principal } : {}),
              ...(channel ? { channel } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
          signal,
        })
      ),
    initialPageParam: '',
    getNextPageParam: (last) => (last.truncated && last.next_cursor ? last.next_cursor : undefined),
    enabled: Boolean(slug && id),
    retry: retryPolicy,
  });
}

export function useCloseRealtimeConnection(slug: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, reason }: { connectionId: string; reason?: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/realtime/endpoints/{id}/connections/{connection_id}/close', {
          params: { path: { slug, id, connection_id: connectionId } },
          body: reason ? { reason } : {},
        })
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: realtimeKeys.connections(slug, id) }),
  });
}

export function useSendRealtimeConnection(slug: string, id: string) {
  return useMutation({
    mutationFn: ({ connectionId, text }: { connectionId: string; text: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/realtime/endpoints/{id}/connections/{connection_id}/send', {
          params: { path: { slug, id, connection_id: connectionId } },
          body: { data_base64: textToBase64(text), binary: false },
        })
      ),
  });
}

// --- Occupancy -----------------------------------------------------------------

export function useRealtimeOccupancy(slug: string, id: string, channels: readonly string[]) {
  return useQuery({
    queryKey: realtimeKeys.occupancy(slug, id, channels),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/realtime/endpoints/{id}/occupancy', {
          params: { path: { slug, id }, query: { channel: [...channels] } },
          signal,
        })
      ),
    enabled: Boolean(slug && id) && channels.length > 0,
    retry: retryPolicy,
    // Hidden tabs do not poll (TanStack's refetchIntervalInBackground is off).
    refetchInterval: OCCUPANCY_POLL_MS,
  });
}

// --- Channels: publish, retained history, consumer groups ----------------------

export interface PublishInput {
  channel: string;
  text: string;
  delivery: RealtimeDelivery;
  /** Stable per composed message, so a retry after an unknown outcome replays rather than repeats. */
  idempotencyKey: string;
}

export function useRealtimePublish(slug: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channel, text, delivery, idempotencyKey }: PublishInput) =>
      unwrap(
        api.POST('/v1/apps/{slug}/realtime/endpoints/{id}/channels/{channel}/publish', {
          params: {
            path: { slug, id, channel },
            query: { delivery },
            header: { 'Idempotency-Key': idempotencyKey },
          },
          body: { data_base64: textToBase64(text), binary: false },
        })
      ),
    onSettled: (_data, _error, input) => {
      if (input.delivery === 'retained')
        void qc.invalidateQueries({ queryKey: realtimeKeys.history(slug, id, input.channel) });
    },
  });
}

const HISTORY_PAGE = 50;

/** Retained history after a sequence; `after: 0` starts at the oldest retained message. */
export function useRetainedHistory(slug: string, id: string, channel: string) {
  return useInfiniteQuery({
    queryKey: realtimeKeys.history(slug, id, channel),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/realtime/endpoints/{id}/channels/{channel}/retained-messages', {
          params: { path: { slug, id, channel }, query: { after: pageParam, limit: HISTORY_PAGE } },
          signal,
        })
      ),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.has_more && last.messages.length > 0
        ? last.messages[last.messages.length - 1].sequence
        : undefined,
    enabled: Boolean(slug && id && channel),
    retry: retryPolicy,
  });
}

export function useConsumerGroups(slug: string, id: string, channel: string) {
  return useQuery({
    queryKey: realtimeKeys.groups(slug, id, channel),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/realtime/endpoints/{id}/channels/{channel}/groups', {
          params: { path: { slug, id, channel } },
          signal,
        })
      ),
    enabled: Boolean(slug && id && channel),
    retry: retryPolicy,
  });
}

// --- Subscription tickets --------------------------------------------------------

/**
 * Direct by design, and never cached: the ticket is a bearer credential apid
 * returns once with `Cache-Control: no-store` (handlers_tickets.go:14).
 */
export function issueRealtimeTicket(slug: string, id: string, body: RealtimeTicketRequest) {
  return unwrap(
    api.POST('/v1/apps/{slug}/realtime/endpoints/{id}/tickets', {
      params: { path: { slug, id } },
      body,
    })
  );
}

export function useRevokeRealtimeTicket(slug: string, id: string) {
  return useMutation({
    mutationFn: (ticketId: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/realtime/endpoints/{id}/tickets/{ticket}', {
          params: { path: { slug, id, ticket: ticketId } },
        })
      ),
  });
}

export function useRevokePrincipalTickets(slug: string, id: string) {
  return useMutation({
    mutationFn: (principal: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/realtime/endpoints/{id}/tickets', {
          params: { path: { slug, id }, query: { principal } },
        })
      ),
  });
}

// --- Principal access ------------------------------------------------------------

export function useRealtimeAccess(slug: string, id: string, principal: string) {
  return useQuery({
    queryKey: realtimeKeys.access(slug, id, principal),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/realtime/endpoints/{id}/principals/{principal}/access', {
          params: { path: { slug, id, principal } },
          signal,
        })
      ),
    enabled: Boolean(slug && id && principal),
    retry: retryPolicy,
  });
}

export function useChangeRealtimeAccess(slug: string, id: string, principal: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, channel }: { action: RealtimeAccessAction; channel?: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/realtime/endpoints/{id}/principals/{principal}/access', {
          params: { path: { slug, id, principal } },
          body: action === 'revoke_sessions' ? { action } : { action, channel },
        })
      ),
    onSuccess: (access) => qc.setQueryData(realtimeKeys.access(slug, id, principal), access),
    onSettled: () =>
      void qc.invalidateQueries({ queryKey: realtimeKeys.access(slug, id, principal) }),
  });
}

// --- Push --------------------------------------------------------------------------

export function useRealtimePushProviders(slug: string, id: string) {
  return useQuery({
    queryKey: realtimeKeys.push(slug, id),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/realtime/endpoints/{id}/push/providers', {
          params: { path: { slug, id } },
          signal,
        })
      ),
    enabled: Boolean(slug && id),
    retry: retryPolicy,
  });
}
