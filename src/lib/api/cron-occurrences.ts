import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

export type CronOccurrence = components['schemas']['ScheduleOccurrenceResponse'];
export type CronOccurrenceStatus = CronOccurrence['status'];
export type AppTask = components['schemas']['AppTaskResponse'];

/** Statuses the scheduler has not settled yet; anything else is final. */
export const ACTIVE_OCCURRENCE: ReadonlySet<CronOccurrenceStatus> = new Set([
  'pending',
  'queued',
  'running',
  'waiting_replacement',
]);

const PAGE = 50;

/**
 * The durable decision the scheduler recorded for each nominal fire time of a
 * cron — ran, skipped for overlap, missed its start deadline, coalesced — with
 * the invocation (HTTP) or app task (command) it produced. Newest first,
 * cursor-paged by occurrence id; the server keeps settled rows for 90 days.
 * Upcoming times are never rows here: an occurrence exists once its time is
 * reached.
 */
export function useCronOccurrences(id: string) {
  return useInfiniteQuery({
    queryKey: ['crons', id, 'occurrences'],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/crons/{id}/occurrences', {
          params: {
            path: { id },
            query: { limit: PAGE, ...(pageParam ? { before: pageParam } : {}) },
          },
          signal,
        })
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before ?? undefined,
    enabled: Boolean(id),
    retry: retryPolicy,
    // Follow an occurrence the scheduler is still working on; stop once the
    // newest page has settled.
    refetchInterval: (query) =>
      !query.state.error &&
      query.state.data?.pages[0]?.occurrences.some((o) => ACTIVE_OCCURRENCE.has(o.status))
        ? 5_000
        : false,
  });
}

/**
 * Cancel one command-cron run (its app task). A queued run is cancelled at
 * once; a restoring or running one records `cancel_requested_at` and stays
 * active until its worker stops it. Repeating it is harmless.
 */
export function useCancelCronRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cronId, runId }: { cronId: string; runId: string }) =>
      unwrap(
        api.POST('/v1/crons/{id}/runs/{run_id}/cancel', {
          params: { path: { id: cronId, run_id: runId } },
        })
      ),
    onSettled: (_task, _err, { cronId }) => qc.invalidateQueries({ queryKey: ['crons', cronId] }),
  });
}
