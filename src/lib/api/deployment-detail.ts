import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Reads and writes behind the deployment drawer that the release cockpit in
 * `queries.ts` does not cover: the release diff, the runtime base identity,
 * promotion, exact rollbacks and the worker rollout snapshot. Each one is a
 * faas route decided from its handler; the comments say which.
 */

export type ReleaseDiff = components['schemas']['ReleaseDiff'];
export type DeploymentRuntime = components['schemas']['DeploymentRuntimeResponse'];
export type RuntimeRelease = components['schemas']['RuntimeReleaseResponse'];
export type RuntimeUpgradePreview = components['schemas']['RuntimeUpgradePreviewResponse'];
export type PromotionResult = components['schemas']['BindingPromotionResponse'];
export type BindingFinding = components['schemas']['BindingCheckFinding'];
export type RollbackOperation = components['schemas']['RollbackOperation'];
export type WorkerRolloutObservation = components['schemas']['WorkerRolloutObservation'];
export type RolloutDecision = components['schemas']['RolloutDecision'];
export type ScheduledRelease = components['schemas']['ScheduledRelease'];

/** What changed against the release before it, or against `against`. */
export function useReleaseDiff(id: string, against?: string) {
  return useQuery({
    queryKey: ['deployments', id, 'diff', against ?? ''],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/deployments/{id}/diff', {
          params: { path: { id }, ...(against ? { query: { against } } : {}) },
          signal,
        })
      ),
    enabled: Boolean(id),
    retry: retryPolicy,
    staleTime: 60_000,
  });
}

/** The runtime base bytes this artifact is bound to, and same-family candidates. */
export function useDeploymentRuntime(id: string) {
  return useQuery({
    queryKey: ['deployments', id, 'runtime'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/deployments/{id}/runtime', { params: { path: { id } }, signal })),
    enabled: Boolean(id),
    retry: retryPolicy,
  });
}

/** A read-only comparison with one published runtime release; nothing is applied. */
export function useRuntimeUpgradePreview(id: string, target: string) {
  return useQuery({
    queryKey: ['deployments', id, 'runtime', 'upgrade-preview', target],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/deployments/{id}/runtime/upgrade-preview', {
          params: { path: { id }, query: { target } },
          signal,
        })
      ),
    enabled: Boolean(id && target),
    retry: retryPolicy,
  });
}

/**
 * Moves all traffic to one live release after the bindings check
 * (handlers_binding_promotion.go). The strict variant has its own route so an
 * older server answers 404 instead of silently ignoring the policy, which is
 * why a failure there is never retried on the ordinary route.
 */
export function usePromoteDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, requireApplicationAck }: { id: string; requireApplicationAck: boolean }) =>
      unwrap(
        requireApplicationAck
          ? api.POST('/v1/deployments/{id}/promote-with-application-ack', {
              params: { path: { id } },
              body: { require_application_ack: true },
            })
          : api.POST('/v1/deployments/{id}/promote', { params: { path: { id } }, body: {} })
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.deployments });
      void qc.invalidateQueries({ queryKey: keys.apps });
    },
  });
}

/**
 * Rolls an app back to one named release. `acknowledgeReleases` answers a
 * `rollback_crosses_release` refusal: the rollback does not undo the release
 * commands that ran since the target last served.
 */
export function useRollbackToRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      targetDeploymentId,
      acknowledgeReleases,
    }: {
      slug: string;
      targetDeploymentId: string;
      acknowledgeReleases?: boolean;
    }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/rollback', {
          params: { path: { slug } },
          body: {
            target_deployment_id: targetDeploymentId,
            ...(acknowledgeReleases ? { acknowledge_releases: true } : {}),
          },
        })
      ),
    onSettled: (_data, _error, { slug }) => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      void qc.invalidateQueries({ queryKey: keys.app(slug) });
      void qc.invalidateQueries({ queryKey: keys.deployments });
    },
  });
}

/** `blocked` retries fresh evidence on the server, so only these two end it. */
export function isRollbackSettled(status: RollbackOperation['status']): boolean {
  return status === 'complete' || status === 'failed';
}

/**
 * Progress of one accepted rollback. The server sweeps plain rollbacks every
 * 5 s and fails them after 10 min (pkg/api/limits.go:1360-1361), so polling
 * faster than the sweep would only re-read the same row.
 */
export function useRollbackOperation(
  slug: string,
  operation: string,
  initialData?: RollbackOperation
) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['apps', slug, 'rollbacks', operation],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/rollbacks/{operation}', {
          params: { path: { slug, operation } },
          signal,
        })
      ),
    initialData,
    initialDataUpdatedAt: 0,
    enabled: Boolean(slug && operation),
    retry: retryPolicy,
    refetchInterval: (q) =>
      q.state.data && isRollbackSettled(q.state.data.status) ? false : 5_000,
  });
  // A settled rollback moved traffic, so the deployment reads are stale. The
  // app prefix holds this query too; refreshing it from inside its own fetch
  // would cancel and restart it forever.
  const settled = query.data && isRollbackSettled(query.data.status);
  useEffect(() => {
    if (!settled) return;
    void qc.invalidateQueries({ queryKey: keys.deployments });
    void qc.invalidateQueries({
      queryKey: keys.app(slug),
      predicate: (q) => q.queryKey[2] !== 'rollbacks',
    });
  }, [qc, slug, settled]);
  return query;
}

/** The route wants exactly one selector; a named scope is its environment. */
export function observationSelector(
  scope: string | null | undefined
): { scope: 'default' } | { environment: string } {
  return !scope || scope === 'default' ? { scope: 'default' } : { environment: scope };
}

/** Where a worker release's residents are, from the database (scoped_telemetry.go:129). */
export function useWorkerRolloutObservation(
  slug: string,
  id: string,
  scope: string | null | undefined,
  enabled: boolean
) {
  const selector = observationSelector(scope);
  return useQuery({
    queryKey: ['apps', slug, 'rollouts', id, 'observation', selector],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/rollouts/{id}/observation', {
          params: { path: { slug, id }, query: selector },
          signal,
        })
      ),
    enabled: enabled && Boolean(slug && id),
    retry: retryPolicy,
    refetchInterval: 10_000,
  });
}
