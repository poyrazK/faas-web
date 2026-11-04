import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

/**
 * What runs a workflow on its own: deployed schedules (capability
 * `workflow-schedules`) and the app's recovery policy (capability
 * `workflow-recovery`). Both beta, both per app.
 *
 * Schedules are declared in `gregale.yaml`; apid only reports them, previews
 * their next fires and replays skipped minutes. The recovery policy is the
 * one thing here the console writes, always fenced to the version it read.
 */

type S = components['schemas'];
export type WorkflowSchedule = S['WorkflowScheduleResponse'];
export type WorkflowSchedules = S['ListWorkflowSchedulesResponse'];
export type WorkflowSchedulePreview = S['WorkflowSchedulePreviewResponse'];
export type ScheduleOccurrence = S['WorkflowScheduleOccurrenceResponse'];
export type ScheduleReplayOutcome = S['WorkflowScheduleReplayOutcome'];
export type RecoveryPolicy = S['WorkflowRecoveryPolicy'];
export type RecoveryPolicyState = S['WorkflowRecoveryPolicyResponse'];
export type RecoveryPolicyHealth = S['WorkflowRecoveryPolicyHealth'];
export type RecoveryPolicyChangePreview = S['WorkflowRecoveryPolicyChangePreview'];
export type RecoveryControl = S['ControlWorkflowRecoveryPolicyRequest'];

/** The replay routes take at most 20 occurrences (WorkflowScheduleReplayRequest). */
export const REPLAY_MAX = 20;
export const OCCURRENCE_PAGE = 50;

const schedulesKey = (slug: string) => ['workflows', 'app', slug, 'schedules'] as const;
const recoveryKey = (slug: string) => ['workflows', 'app', slug, 'recovery'] as const;

export function useWorkflowSchedules(slug: string) {
  return useQuery({
    queryKey: [...schedulesKey(slug), 'list'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/workflows/schedules', { params: { path: { slug } }, signal })
      ),
    enabled: Boolean(slug),
    refetchInterval: (query) => (query.state.error ? false : 60_000),
  });
}

export function useWorkflowSchedulePreview(slug: string, name: string, enabled: boolean) {
  return useQuery({
    queryKey: [...schedulesKey(slug), 'preview', name],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/workflows/schedules/{name}/preview', {
          params: { path: { slug, name }, query: { count: 5 } },
          signal,
        })
      ),
    enabled: Boolean(slug && name && enabled),
    gcTime: 0,
  });
}

/** Newest nominal minute first, retained 30 days; an expired cursor answers an empty page. */
export function useScheduleOccurrences(slug: string) {
  return useInfiniteQuery({
    queryKey: [...schedulesKey(slug), 'occurrences'],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/workflows/schedules/occurrences', {
          params: {
            path: { slug },
            query: { limit: OCCURRENCE_PAGE, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        })
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(slug),
  });
}

export function previewScheduleReplay(slug: string, ids: string[]) {
  return unwrap(
    api.POST('/v1/apps/{slug}/workflows/schedules/occurrences:replay-preview', {
      params: { path: { slug } },
      body: { occurrence_ids: ids },
    })
  );
}

export function replayScheduleOccurrences(slug: string, ids: string[]) {
  return unwrap(
    api.POST('/v1/apps/{slug}/workflows/schedules/occurrences:replay', {
      params: { path: { slug } },
      body: { occurrence_ids: ids },
    })
  );
}

export function useReplayScheduleOccurrences(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => replayScheduleOccurrences(slug, ids),
    retry: false,
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: schedulesKey(slug) }),
        qc.invalidateQueries({ queryKey: ['workflows', 'app', slug, 'runs'] }),
      ]),
  });
}

/* --- Recovery policy ------------------------------------------------------- */

export function useRecoveryPolicy(slug: string) {
  return useQuery({
    queryKey: [...recoveryKey(slug), 'policy'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/recovery-policy', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
  });
}

export function useRecoveryPolicyHealth(slug: string) {
  return useQuery({
    queryKey: [...recoveryKey(slug), 'health'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/recovery-policy/health', { params: { path: { slug } }, signal })
      ),
    enabled: Boolean(slug),
    refetchInterval: (query) => (query.state.error ? false : 30_000),
  });
}

/** Read-only: the impact of replacing the observed version with `policy`. */
export function previewRecoveryPolicyChange(
  slug: string,
  expectedVersion: number,
  policy: RecoveryPolicy
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/recovery-policy/change-preview', {
      params: { path: { slug } },
      body: { expected_version: expectedVersion, policy },
    })
  );
}

export function setRecoveryPolicy(slug: string, expectedVersion: number, policy: RecoveryPolicy) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/recovery-policy', {
      params: { path: { slug } },
      body: { expected_version: expectedVersion, policy },
    })
  );
}

export function controlRecoveryPolicy(slug: string, body: RecoveryControl) {
  return unwrap(
    api.POST('/v1/apps/{slug}/recovery-policy/control', { params: { path: { slug } }, body })
  );
}

function useRecoverySettle(slug: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: recoveryKey(slug) });
}

export function useSetRecoveryPolicy(slug: string) {
  const settle = useRecoverySettle(slug);
  return useMutation({
    mutationFn: (input: { expectedVersion: number; policy: RecoveryPolicy }) =>
      setRecoveryPolicy(slug, input.expectedVersion, input.policy),
    retry: false,
    onSettled: settle,
  });
}

export function useControlRecoveryPolicy(slug: string) {
  const settle = useRecoverySettle(slug);
  return useMutation({
    mutationFn: (body: RecoveryControl) => controlRecoveryPolicy(slug, body),
    retry: false,
    onSettled: settle,
  });
}
