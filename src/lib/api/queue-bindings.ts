import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];
export type QueueBinding = components['schemas']['QueueBindingResponse'];
export type QueueBindingStatus = components['schemas']['QueueBindingStatusResponse'];
export type StageQueueBindings = components['schemas']['ProjectEnvironmentQueueBindingsResponse'];
export type CreateQueueBinding = components['schemas']['CreateQueueBindingRequest'];
export type UpdateQueueBinding = components['schemas']['UpdateQueueBindingRequest'];
export type QueueWorkloadProfile = components['schemas']['QueueWorkloadProfileRequest'];

export const queueBindingsKey = (accountId: string, slug: string, includeRetired = false) =>
  ['account', accountId, 'app', slug, 'queue-bindings', includeRetired] as const;
export const queueBindingStatusKey = (accountId: string, slug: string, id: string) =>
  ['account', accountId, 'app', slug, 'queue-binding', id, 'status'] as const;
export const stageQueueBindingsKey = (
  accountId: string,
  project: string,
  environment: string,
  workload: string
) =>
  [
    'account',
    accountId,
    'project',
    project,
    'environment',
    environment,
    'workload',
    workload,
    'queue-bindings',
  ] as const;

export function useQueueBindings(accountId: string, slug: string, includeRetired = false) {
  return useQuery({
    queryKey: queueBindingsKey(accountId, slug, includeRetired),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/queue-bindings', {
          params: {
            path: { slug },
            ...(includeRetired ? { query: { include_retired: true } } : {}),
          },
          signal,
        })
      ),
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
  });
}

export function useQueueBindingStatus(accountId: string, slug: string, id: string) {
  return useQuery({
    queryKey: queueBindingStatusKey(accountId, slug, id),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/queue-bindings/{id}/status', {
          params: { path: { slug, id } },
          signal,
        })
      ),
    enabled: Boolean(accountId && slug && id),
    retry: retryPolicy,
  });
}

export function useStageQueueBindings(
  accountId: string,
  project: string,
  environment: string,
  workload: string
) {
  return useQuery({
    queryKey: stageQueueBindingsKey(accountId, project, environment, workload),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET(
          '/v1/projects/{slug}/environments/{environment}/workloads/{workload}/queue-bindings',
          {
            params: { path: { slug: project, environment, workload } },
            signal,
          }
        )
      ),
    enabled: Boolean(
      accountId && project && environment && environment !== 'production' && workload
    ),
    retry: retryPolicy,
  });
}

/** Fresh account and capability fence for every reviewed production mutation. */
export async function readQueueBindingContext(
  accountId: string,
  slug: string,
  plan: Plan,
  signal?: AbortSignal
) {
  const [account, app, registry] = await Promise.all([
    unwrap(api.GET('/v1/account', { signal })),
    unwrap(api.GET('/v1/apps/{slug}', { params: { path: { slug } }, signal })),
    unwrap(api.GET('/v1/capabilities', { signal })),
  ]);
  const capability = registry.capabilities.find((entry) => entry.key === 'worker-pools');
  if (
    account.id !== accountId ||
    account.plan !== plan ||
    registry.plan !== plan ||
    !capability?.enabled ||
    !capability.plans.includes(plan)
  )
    throw new Error('Worker-pool capability is no longer available for this account.');
  const bindings = await unwrap(
    api.GET('/v1/apps/{slug}/queue-bindings', { params: { path: { slug } }, signal })
  );
  return { app, bindings };
}

export function createQueueBinding(slug: string, body: CreateQueueBinding, idempotencyKey: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/queue-bindings', {
      params: { path: { slug } },
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    })
  );
}

export function updateQueueBinding(slug: string, id: string, body: UpdateQueueBinding) {
  return unwrap(
    api.PATCH('/v1/apps/{slug}/queue-bindings/{id}', {
      params: { path: { slug, id } },
      body,
    })
  );
}

export function deleteQueueBinding(slug: string, id: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/queue-bindings/{id}', { params: { path: { slug, id } } })
  );
}

export function configureQueueWorkload(slug: string, body: QueueWorkloadProfile) {
  return unwrap(api.PUT('/v1/apps/{slug}/queue-workload', { params: { path: { slug } }, body }));
}

export function replaceStageQueueBindings(
  project: string,
  environment: string,
  workload: string,
  body: components['schemas']['ReplaceProjectEnvironmentQueueBindingsRequest']
) {
  if (environment === 'production')
    throw new Error('Production queue bindings use the app queue-bindings API.');
  return unwrap(
    api.PUT('/v1/projects/{slug}/environments/{environment}/workloads/{workload}/queue-bindings', {
      params: { path: { slug: project, environment, workload } },
      body,
    })
  );
}
