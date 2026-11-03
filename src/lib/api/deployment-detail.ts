import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError } from './errors';
import { keys, retryPolicy, type Deployment } from './queries';
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
 *
 * `expectedServingDeploymentId` is the release the console showed serving all
 * traffic. apid checks it under the same live-row locks as the write and
 * answers `409 traffic_serving_changed`, changing nothing, when another
 * release took over first (handlers_binding_promotion.go:248-256, :289-290).
 */
export function usePromoteDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      requireApplicationAck,
      expectedServingDeploymentId,
    }: {
      id: string;
      requireApplicationAck: boolean;
      expectedServingDeploymentId?: string;
    }) => {
      const pin = expectedServingDeploymentId
        ? { expected_serving_deployment_id: expectedServingDeploymentId }
        : {};
      return unwrap(
        requireApplicationAck
          ? api.POST('/v1/deployments/{id}/promote-with-application-ack', {
              params: { path: { id } },
              body: { require_application_ack: true, ...pin },
            })
          : api.POST('/v1/deployments/{id}/promote', { params: { path: { id } }, body: pin })
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.deployments });
      void qc.invalidateQueries({ queryKey: keys.apps });
    },
  });
}

/** apid stores the default scope as an empty string or `default`; both mean the same routes. */
export function deploymentScope(deployment: Pick<Deployment, 'scope'>): string {
  return deployment.scope || 'default';
}

/** Deployment ids arrive dashed or as 32 hex; apid compares them either way. */
function sameDeployment(a: string, b: string): boolean {
  const canonical = (id: string) => id.replace(/-/g, '').toLowerCase();
  return canonical(a) === canonical(b);
}

/** The live releases holding traffic in one scope, and whether every weight is accounted for. */
export interface ServingRows {
  rows: Deployment[];
  complete: boolean;
}

/**
 * What a traffic change can be pinned to. apid accepts one expectation: that
 * a single other live release serves 100% of the scope (pgstore.go:8713-8727,
 * memstore.go:6164-6177), which is the CLI's `--if-serving` (faas
 * cmd/gregale/deploy_success.go:125-151). A split cannot be expressed, so it
 * is shown and not pinned; neither is a history the read could not finish.
 */
export type ServingPin =
  | { kind: 'sole'; serving: Deployment }
  | { kind: 'split'; serving: Deployment[] }
  | { kind: 'none' }
  | { kind: 'unknown' };

export function servingPin(candidate: Deployment, read: ServingRows): ServingPin {
  const own = candidate.traffic_percent ?? 0;
  const others = read.rows.filter((d) => !sameDeployment(d.id, candidate.id));
  if (own === 0 && others.length === 1 && others[0].traffic_percent === 100) {
    return { kind: 'sole', serving: others[0] };
  }
  if (others.length > 0 || (own > 0 && own < 100)) {
    return { kind: 'split', serving: [...(own > 0 ? [candidate] : []), ...others] };
  }
  return read.complete || own === 100 ? { kind: 'none' } : { kind: 'unknown' };
}

const SERVING_PAGE = 200;
const SERVING_PAGES = 5;

/**
 * The live, weighted releases of one scope, read from the app's deployment
 * history (there is no serving-release read). Weights in a scope sum to 100
 * by construction (openapi PATCH /v1/deployments/{id}/traffic), so paging
 * stops as soon as they do; a history that outruns the page budget first is
 * reported incomplete rather than guessed at.
 */
export function useServingRows(slug: string, scope: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...keys.appDeployments(slug), 'serving', scope],
    queryFn: async ({ signal }): Promise<ServingRows> => {
      const rows: Deployment[] = [];
      let before: string | undefined;
      for (let page = 0; page < SERVING_PAGES; page++) {
        const data = await unwrap(
          api.GET('/v1/apps/{slug}/deployments', {
            params: {
              path: { slug },
              query: { limit: SERVING_PAGE, ...(before ? { before } : {}) },
            },
            signal,
          })
        );
        for (const d of data.items)
          if (
            d.status.toLowerCase() === 'live' &&
            deploymentScope(d) === scope &&
            (d.traffic_percent ?? 0) > 0
          )
            rows.push(d);
        const weight = rows.reduce((sum, d) => sum + (d.traffic_percent ?? 0), 0);
        if (weight >= 100 || !data.next_before) return { rows, complete: true };
        before = data.next_before;
      }
      return { rows, complete: false };
    },
    enabled: Boolean(slug) && (options?.enabled ?? true),
    retry: retryPolicy,
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
 * Poll every 5 s until the rollback settles. A 404 or 403 will not change on
 * a retry, so it ends the watch; an outage keeps it going.
 */
export function rollbackPollInterval(
  data: RollbackOperation | undefined,
  error: unknown
): number | false {
  if (data && isRollbackSettled(data.status)) return false;
  if (error instanceof ApiError && !error.isRetryable) return false;
  return 5_000;
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
    refetchInterval: (q) => rollbackPollInterval(q.state.data, q.state.error),
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

/**
 * Re-read the snapshot every 10 s only while it can still change: the
 * release is live and its generation has not converged.
 */
export function observationPollInterval(
  data: Pick<WorkerRolloutObservation, 'generation_converged'> | undefined,
  live: boolean
): number | false {
  return live && !data?.generation_converged ? 10_000 : false;
}

/** Where a worker release's residents are, from the database (scoped_telemetry.go:129). */
export function useWorkerRolloutObservation(
  slug: string,
  id: string,
  scope: string | null | undefined,
  enabled: boolean,
  live: boolean
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
    refetchInterval: (q) => observationPollInterval(q.state.data, live),
  });
}
