import { useMutation, useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

/**
 * Mirror detail and replay (faas handlers_mirror.go:238-260, 448-600): one
 * rule as apid stores it, including the headers the gateway always strips, and
 * a bounded corpus of sanitized historical requests queued against the rule's
 * mirror deployment. Replays run asynchronously; the response correlates each
 * request with its mirror invocation.
 */
export type ReplayItem = components['schemas']['MirrorReplayRequestItem'];
export type ReplayResult = components['schemas']['MirrorReplayBatchResponse'];

/** api.MirrorReplay* limits (faas pkg/api/limits.go:7637-7644). */
export const REPLAY_MAX_REQUESTS = 100;
export const REPLAY_BODY_CAP = 64 * 1024;
export const REPLAY_MAX_HEADERS = 32;
export const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
const METHODS = ['GET', 'HEAD', 'OPTIONS', ...UNSAFE_METHODS];

/**
 * Parses a pasted corpus (a JSON array of requests, or `{ "requests": [...] }`)
 * and checks each item the way prepareMirrorReplayInvocation does, so a
 * refused batch is caught before anything is queued.
 */
export function parseReplayCorpus(text: string): { items: ReplayItem[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'Paste a JSON array of requests.' };
  }
  const list =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'requests' in parsed
      ? (parsed as { requests: unknown }).requests
      : parsed;
  if (!Array.isArray(list) || list.length === 0 || list.length > REPLAY_MAX_REQUESTS)
    return { error: `Between 1 and ${REPLAY_MAX_REQUESTS} requests.` };
  const items: ReplayItem[] = [];
  for (const [i, raw] of list.entries()) {
    const where = `Request ${i + 1}`;
    if (!raw || typeof raw !== 'object') return { error: `${where}: not an object.` };
    const item = raw as Record<string, unknown>;
    const method = String(item.method ?? '').toUpperCase();
    if (!METHODS.includes(method))
      return { error: `${where}: method ${method || '(none)'} is not supported.` };
    const path = typeof item.path === 'string' ? item.path.trim() : '';
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('#') || path.length > 4096)
      return { error: `${where}: path must be an absolute request path, such as /orders?limit=5.` };
    const headers = item.headers;
    if (headers !== undefined) {
      if (!headers || typeof headers !== 'object' || Array.isArray(headers))
        return { error: `${where}: headers must be an object of strings.` };
      const entries = Object.entries(headers as Record<string, unknown>);
      if (entries.length > REPLAY_MAX_HEADERS || entries.some(([, v]) => typeof v !== 'string'))
        return { error: `${where}: at most ${REPLAY_MAX_HEADERS} string headers.` };
    }
    if (
      item.body !== undefined &&
      new TextEncoder().encode(JSON.stringify(item.body)).length > REPLAY_BODY_CAP
    )
      return { error: `${where}: the body is over 64 KiB.` };
    const status = item.expected_status;
    if (
      status !== undefined &&
      (!Number.isInteger(status) || (status as number) < 100 || (status as number) > 599)
    )
      return { error: `${where}: expected_status must be 100 to 599.` };
    const latency = item.expected_latency_ms;
    if (latency !== undefined && (!Number.isInteger(latency) || (latency as number) < 0))
      return { error: `${where}: expected_latency_ms must be a whole number of milliseconds.` };
    const hash = item.expected_body_sha256;
    if (hash !== undefined && !(typeof hash === 'string' && /^[a-fA-F0-9]{64}$/.test(hash)))
      return { error: `${where}: expected_body_sha256 must be 64 hexadecimal characters.` };
    const id = item.request_id;
    if (id !== undefined && !(typeof id === 'string' && id.length <= 128))
      return { error: `${where}: request_id must be at most 128 characters.` };
    items.push({
      ...(item as unknown as ReplayItem),
      method: method as ReplayItem['method'],
      path,
    });
  }
  return { items };
}

export const hasUnsafe = (items: ReplayItem[]) =>
  items.some((i) => (UNSAFE_METHODS as readonly string[]).includes(i.method));

/** One mirror rule as apid stores it. */
export function useMirrorRule(slug: string, id: string, enabled = true) {
  return useQuery({
    queryKey: ['apps', slug, 'mirrors', id],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/mirrors/{id}', { params: { path: { slug, id } }, signal })),
    enabled: enabled && Boolean(slug && id),
    retry: retryPolicy,
  });
}

/** Queues a corpus against the rule's mirror deployment; not idempotent, so never retried. */
export function useReplayMirror(slug: string) {
  return useMutation({
    retry: false,
    mutationFn: ({
      id,
      requests,
      allowUnsafe,
    }: {
      id: string;
      requests: ReplayItem[];
      allowUnsafe: boolean;
    }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/mirrors/{id}/replay', {
          params: { path: { slug, id } },
          body: { requests, ...(allowUnsafe ? { allow_unsafe_methods: true } : {}) },
        })
      ),
  });
}
