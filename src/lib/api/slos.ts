import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';
import type { SLO } from './alert-rules';

/**
 * Customer-defined SLOs (faas ADR-747, docs/slos.md). The list is
 * `useAppSLOs` in alert-rules.ts, shared with the alert form's SLO picker so
 * a create shows up in both; this module adds one SLO's error-budget status,
 * create and delete. Every route is gated on the `custom-slos` capability.
 */
export type SLOStatus = components['schemas']['SLOStatus'];
export type CreateSLO = components['schemas']['CreateSLORequest'];
export type { SLO };

export const sloListKey = (slug: string) => ['apps', slug, 'slos'] as const;
export const sloKey = (slug: string, id: string) => ['apps', slug, 'slos', id] as const;

/**
 * Each SLO's definition with its status (GET /v1/apps/{slug}/slos/{id}): the
 * list carries no status, and an app holds at most 10 SLOs, so one read each.
 * The budget moves in whole hours and the burn rates are live, so a minute
 * between re-reads is plenty.
 */
export function useSLOStatuses(slug: string, ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: sloKey(slug, id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        unwrap(api.GET('/v1/apps/{slug}/slos/{id}', { params: { path: { slug, id } }, signal })),
      enabled: Boolean(slug && id),
      retry: retryPolicy,
      refetchInterval: 60_000,
    })),
  });
}

export function useCreateSLO(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSLO) =>
      unwrap(api.POST('/v1/apps/{slug}/slos', { params: { path: { slug } }, body })),
    onSettled: () => qc.invalidateQueries({ queryKey: sloListKey(slug) }),
  });
}

/** Deleting an SLO deletes the alert rules that watch it (faas handlers_slos.go:124-134). */
export function useDeleteSLO(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/slos/{id}', { params: { path: { slug, id } } })),
    onSuccess: (_, id) => qc.removeQueries({ queryKey: sloKey(slug, id) }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: sloListKey(slug), exact: true }),
        qc.invalidateQueries({ queryKey: keys.appAlerts(slug) }),
      ]),
  });
}
