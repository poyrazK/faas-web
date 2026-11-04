import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

/**
 * Business workflow insights (capability `workflow-insights`, beta): what
 * applications report about their own business workflows through Operation
 * milestones — the attention queue, terminal outcomes and duration cohorts
 * (faas docs/operations.md "Find workflows needing attention",
 * pkg/apid/operation/attention.go, outcomes.go, performance.go).
 *
 * Every read is for one explicit environment (`scope`); none of them is a
 * time series, so the console shows figures and tables, never a chart.
 */

type S = components['schemas'];
export type AttentionEntry = S['OperationWorkflowAttentionEntry'];
export type AttentionStats = S['OperationWorkflowAttentionStats'];
export type AttentionReason = AttentionEntry['reasons'][number];
export type OutcomeGroupBy = S['OperationWorkflowOutcomeSummary']['group_by'];
export type OutcomeEntry = S['OperationWorkflowOutcomeEntry'];
export type PerformanceSummary = S['OperationWorkflowPerformanceSummary'];
export type PerformanceCohort = S['OperationWorkflowPerformanceCohort'];
export type Duration = S['OperationWorkflowDurationDistribution'];
export type PerformanceInstances = S['OperationWorkflowPerformanceInstancesResponse'];

/** The overall duration measures; every other dimension needs a group selector. */
export type OverallDimension = 'state_time' | 'blocked_time' | 'verification_wait';

export const INSIGHTS_PAGE = 20;

const key = (slug: string, scope: string) => ['workflows', 'app', slug, 'insights', scope] as const;

export function useAttentionSummary(slug: string, scope: string, workflow: string) {
  return useQuery({
    queryKey: [...key(slug, scope), 'attention-summary', workflow],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/workflow-attention/summary', {
          params: {
            path: { slug },
            query: { scope, group_by: 'workflow', ...(workflow ? { workflow } : {}) },
          },
          signal,
        })
      ),
    enabled: Boolean(slug && scope),
  });
}

export function useAttentionQueue(
  slug: string,
  scope: string,
  workflow: string,
  reason: AttentionReason | ''
) {
  return useInfiniteQuery({
    queryKey: [...key(slug, scope), 'attention', workflow, reason],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/workflow-attention', {
          params: {
            path: { slug },
            query: {
              scope,
              limit: INSIGHTS_PAGE,
              ...(workflow ? { workflow } : {}),
              ...(reason ? { reason } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
          signal,
        })
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(slug && scope),
  });
}

export function useOutcomeSummary(
  slug: string,
  scope: string,
  workflow: string,
  groupBy: OutcomeGroupBy
) {
  return useQuery({
    queryKey: [...key(slug, scope), 'outcome-summary', workflow, groupBy],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/workflow-outcomes/summary', {
          params: {
            path: { slug },
            query: { scope, group_by: groupBy, limit: 100, ...(workflow ? { workflow } : {}) },
          },
          signal,
        })
      ),
    enabled: Boolean(slug && scope),
  });
}

export function useOutcomes(slug: string, scope: string, workflow: string) {
  return useInfiniteQuery({
    queryKey: [...key(slug, scope), 'outcomes', workflow],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/workflow-outcomes', {
          params: {
            path: { slug },
            query: {
              scope,
              limit: INSIGHTS_PAGE,
              ...(workflow ? { workflow } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
          signal,
        })
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(slug && scope),
  });
}

/** Needs one declared workflow; the latest 100 completed and 100 ongoing form the cohorts. */
export function usePerformanceSummary(slug: string, scope: string, workflow: string) {
  return useQuery({
    queryKey: [...key(slug, scope), 'performance', workflow],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/workflow-performance/summary', {
          params: { path: { slug }, query: { scope, workflow } },
          signal,
        })
      ),
    enabled: Boolean(slug && scope && workflow),
  });
}

/**
 * The slowest contributors to one overall measure, bound to the summary's
 * cohort token: a changed cohort answers `workflow_performance_cohort_changed`
 * and the summary has to be read again.
 */
export function usePerformanceInstances(
  slug: string,
  scope: string,
  workflow: string,
  cohort: 'completed' | 'ongoing',
  dimension: OverallDimension,
  token: string | undefined
) {
  return useQuery({
    queryKey: [...key(slug, scope), 'instances', workflow, cohort, dimension, token],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/workflow-performance/instances', {
          params: {
            path: { slug },
            query: {
              scope,
              workflow,
              cohort,
              dimension,
              ...(token ? { cohort_token: token } : {}),
            },
          },
          signal,
        })
      ),
    enabled: Boolean(slug && scope && workflow && token),
    retry: false,
  });
}
