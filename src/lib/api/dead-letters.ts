import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

/**
 * The app's unified dead-letter ledger (`/v1/apps/{slug}/dlq`): failed
 * invocations (queue messages, delayed tasks, async invocations, event
 * subscription deliveries), broker trigger records, outbound webhook
 * deliveries and unroutable events, newest first, kept 30 days
 * (faas docs/dead-letters.md).
 *
 * Replay resets the source row to pending and stamps `replayed_at`; a replayed
 * entry is not replayed twice. Purge removes only the ledger projection; the
 * source stays dead-lettered where it came from, and the entry cannot be
 * brought back (handlers_dead_letter.go, openapi `deleteDeadLetterEvent`).
 */

export type DeadLetterEvent = components['schemas']['DeadLetterEvent'];
export type DeadLetterSource = DeadLetterEvent['source'];

/** The page size the API caps both reads and bulk writes at (deadLetterEventsMaxLimit). */
export const DEAD_LETTER_PAGE = 50;
export const DEAD_LETTER_BULK_MAX = 200;

export const deadLetterLedgerKey = (slug: string) => ['apps', slug, 'dlq'] as const;

export function useDeadLetterLedger(slug: string) {
  return useInfiniteQuery({
    queryKey: deadLetterLedgerKey(slug),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/dlq', {
          params: {
            path: { slug },
            query: { limit: DEAD_LETTER_PAGE, ...(pageParam ? { before: pageParam } : {}) },
          },
          signal,
        })
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_before || undefined,
    enabled: Boolean(slug),
    retry: retryPolicy,
    staleTime: 10_000,
  });
}

/** One entry, read fresh: payload, headers and the last error as the server has them now. */
export function useDeadLetterEvent(slug: string, id: string | null) {
  return useQuery({
    queryKey: [...deadLetterLedgerKey(slug), 'event', id ?? ''],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/dlq/{id}', { params: { path: { slug, id: id! } }, signal })),
    enabled: Boolean(slug && id),
    retry: retryPolicy,
    staleTime: 5_000,
  });
}

/**
 * Writes carry an Idempotency-Key minted once per confirmed action, so a
 * retry of the same request returns the original answer instead of acting twice.
 */
const idempotencyKey = () => crypto.randomUUID();

export function useReplayDeadLetterEvent(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key = idempotencyKey() }: { id: string; key?: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/dlq/{id}/replay', {
          params: { path: { slug, id }, header: { 'Idempotency-Key': key } },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: deadLetterLedgerKey(slug) }),
  });
}

export function useDiscardDeadLetterEvent(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key = idempotencyKey() }: { id: string; key?: string }) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/dlq/{id}', {
          params: { path: { slug, id }, header: { 'Idempotency-Key': key } },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: deadLetterLedgerKey(slug) }),
  });
}

/** Replays up to 200 entries that have not been replayed yet. */
export function useReplayAllDeadLetters(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key?: string) =>
      unwrap(
        api.POST('/v1/apps/{slug}/dlq:replay_all', {
          params: {
            path: { slug },
            query: { limit: DEAD_LETTER_BULK_MAX },
            header: { 'Idempotency-Key': key ?? idempotencyKey() },
          },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: deadLetterLedgerKey(slug) }),
  });
}

/** Removes up to 200 ledger entries; their sources stay dead-lettered. */
export function usePurgeDeadLetters(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key?: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/dlq', {
          params: {
            path: { slug },
            query: { limit: DEAD_LETTER_BULK_MAX },
            header: { 'Idempotency-Key': key ?? idempotencyKey() },
          },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: deadLetterLedgerKey(slug) }),
  });
}
