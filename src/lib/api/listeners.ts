import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

/**
 * An app's public raw TCP and UDP listeners (faas handlers_tcp_listeners.go,
 * handlers_udp_listeners.go). Each forwards a stable public port in
 * 40000–49999 to a port the app declares in its manifest; the API refuses a
 * name or guest port the app has not declared, so the console offers only the
 * declared ones (`appDeclaresTCPListener`).
 *
 * TCP accepts connections at once unless it terminates TLS, which starts
 * disabled until its edge certificate is provisioned. UDP always starts
 * disabled. Disabling keeps the public port; deleting releases it.
 */

export type TcpListener = components['schemas']['TCPListenerResponse'];
export type TcpListenerTls = components['schemas']['TCPListenerTLSConfig'];
export type TcpListenerTlsStatus = components['schemas']['TCPListenerTLSStatusResponse'];
export type UdpListener = components['schemas']['UDPListenerResponse'];
export type WorkloadPort = components['schemas']['WorkloadPort'];

/** The reserved public range (api.TCPListenerPublicPortMin/Max, UDPListenerPublicPortMin/Max). */
export const PUBLIC_PORT_MIN = 40000;
export const PUBLIC_PORT_MAX = 49999;

export type ListenerProtocol = 'tcp' | 'udp';

/**
 * The declared ports an app can expose on `protocol`, named the way the API
 * matches them: an unnamed declaration is `tcp-<port>` or `udp-<port>`, and
 * internal listeners never get a public endpoint (ADR-576).
 */
export function declaredListeners(
  ports: WorkloadPort[] | undefined,
  protocol: ListenerProtocol
): { name: string; port: number }[] {
  return (ports ?? [])
    .filter((p) => !p.internal && (p.protocol ?? 'tcp') === protocol)
    .map((p) => ({
      name: (p.name ?? '').trim().toLowerCase() || `${protocol}-${p.port}`,
      port: p.port,
    }));
}

const tcpKey = (slug: string) => ['apps', slug, 'tcp-listeners'] as const;
const udpKey = (slug: string) => ['apps', slug, 'udp-listeners'] as const;
const idempotencyKey = () => crypto.randomUUID();

export function useTcpListeners(slug: string) {
  return useQuery({
    queryKey: tcpKey(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/tcp-listeners', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
    staleTime: 10_000,
  });
}

/** Certificate evidence from the edges that reported it; read only when asked for. */
export function useTcpListenerTlsStatus(slug: string, name: string | null) {
  return useQuery({
    queryKey: [...tcpKey(slug), name ?? '', 'tls-status'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/tcp-listeners/{name}/tls-status', {
          params: { path: { slug, name: name! } },
          signal,
        })
      ),
    enabled: Boolean(slug && name),
    retry: retryPolicy,
    staleTime: 5_000,
  });
}

export type CreateTcpListener = components['schemas']['CreateTCPListenerRequest'];

export function useCreateTcpListener(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key = idempotencyKey() }: { body: CreateTcpListener; key?: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/tcp-listeners', {
          params: { path: { slug }, header: { 'Idempotency-Key': key } },
          body,
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: tcpKey(slug) }),
  });
}

/** Exactly one of `enabled` or `tls`: the API refuses both or neither. */
export type TcpListenerChange = { enabled: boolean } | { tls: TcpListenerTls };

export function useUpdateTcpListener(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, change }: { name: string; change: TcpListenerChange }) =>
      unwrap(
        api.PATCH('/v1/apps/{slug}/tcp-listeners/{name}', {
          params: { path: { slug, name } },
          body: change,
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: tcpKey(slug) }),
  });
}

export function useDeleteTcpListener(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/tcp-listeners/{name}', { params: { path: { slug, name } } })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: tcpKey(slug) }),
  });
}

export function useUdpListeners(slug: string) {
  return useQuery({
    queryKey: udpKey(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/udp-listeners', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
    staleTime: 10_000,
  });
}

export type CreateUdpListener = components['schemas']['CreateUDPListenerRequest'];

export function useCreateUdpListener(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key = idempotencyKey() }: { body: CreateUdpListener; key?: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/udp-listeners', {
          params: { path: { slug }, header: { 'Idempotency-Key': key } },
          body,
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: udpKey(slug) }),
  });
}

export function useUpdateUdpListener(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      unwrap(
        api.PATCH('/v1/apps/{slug}/udp-listeners/{name}', {
          params: { path: { slug, name } },
          body: { enabled },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: udpKey(slug) }),
  });
}

export function useDeleteUdpListener(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/udp-listeners/{name}', { params: { path: { slug, name } } })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: udpKey(slug) }),
  });
}
