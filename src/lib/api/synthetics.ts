import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';
import type { SyntheticCheck } from './alert-rules';

/**
 * Synthetic checks (faas ADR-748, docs/synthetic-checks.md). The list is
 * `useAppSyntheticChecks` in alert-rules.ts, shared with the alert form's
 * check picker; this module adds one check's results, create, pause or
 * resume, and delete. Every route is gated on `synthetic-checks`.
 */
export type SyntheticResults = components['schemas']['SyntheticCheckResults'];
export type SyntheticRun = components['schemas']['SyntheticCheckRun'];
export type CreateSyntheticCheck = components['schemas']['CreateSyntheticCheckRequest'];
export type { SyntheticCheck };

export const checkListKey = (slug: string) => ['apps', slug, 'synthetics'] as const;
export const checkKey = (slug: string, id: string) => ['apps', slug, 'synthetics', id] as const;

/**
 * Each check with its results (GET /v1/apps/{slug}/synthetics/{id}): the list
 * carries none, and an app holds at most 5 checks, so one read each. Checks
 * run every 5 minutes at the most often, so a minute between re-reads is
 * plenty.
 */
export function useSyntheticResults(slug: string, ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: checkKey(slug, id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        unwrap(
          api.GET('/v1/apps/{slug}/synthetics/{id}', { params: { path: { slug, id } }, signal })
        ),
      enabled: Boolean(slug && id),
      retry: retryPolicy,
      refetchInterval: 60_000,
    })),
  });
}

export function useCreateSyntheticCheck(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSyntheticCheck) =>
      unwrap(api.POST('/v1/apps/{slug}/synthetics', { params: { path: { slug } }, body })),
    onSettled: () => qc.invalidateQueries({ queryKey: checkListKey(slug) }),
  });
}

/** Pause or resume; the only change apid allows (delete and recreate for the rest). */
export function useSetSyntheticCheckEnabled(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      unwrap(
        api.PATCH('/v1/apps/{slug}/synthetics/{id}', {
          params: { path: { slug, id } },
          body: { enabled },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: checkListKey(slug) }),
  });
}

/** Deleting a check deletes its run history and the alert rules that watch it. */
export function useDeleteSyntheticCheck(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/synthetics/{id}', { params: { path: { slug, id } } })),
    onSuccess: (_, id) => qc.removeQueries({ queryKey: checkKey(slug, id) }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: checkListKey(slug), exact: true }),
        qc.invalidateQueries({ queryKey: keys.appAlerts(slug) }),
      ]),
  });
}
