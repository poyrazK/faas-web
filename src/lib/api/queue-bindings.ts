import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];
export type QueueBinding = components['schemas']['QueueBindingResponse'];
export type QueueBindingStatus = components['schemas']['QueueBindingStatusResponse'];
export type StageQueueBindings = components['schemas']['ProjectEnvironmentQueueBindingsResponse'];
export type StageQueueSnapshot =
  { kind: 'ready'; data: StageQueueBindings } | { kind: 'uninitialized'; workloadRevision: number };
export type CreateQueueBinding = components['schemas']['CreateQueueBindingRequest'];
export type UpdateQueueBinding = components['schemas']['UpdateQueueBindingRequest'];
export type QueueWorkloadProfile = components['schemas']['QueueWorkloadProfileRequest'];
export type StageQueueSelection = {
  accountId: string;
  plan: Plan;
  project: string;
  projectId: string;
  environment: string;
  environmentId: string;
  workload: string;
  appId: string;
};

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
    queryFn: ({ signal }) => readStageQueueSnapshot(project, environment, workload, signal),
    enabled: Boolean(
      accountId && project && environment && environment !== 'production' && workload
    ),
    retry: retryPolicy,
  });
}

export async function readStageQueueSnapshot(
  project: string,
  environment: string,
  workload: string,
  signal?: AbortSignal
): Promise<StageQueueSnapshot> {
  if (environment === 'production')
    throw new Error('Production queue bindings use the app queue-bindings API.');
  const result = await api.GET(
    '/v1/projects/{slug}/environments/{environment}/workloads/{workload}/queue-bindings',
    { params: { path: { slug: project, environment, workload } }, ...(signal ? { signal } : {}) }
  );
  if (
    result.response.status === 409 &&
    result.error &&
    typeof result.error === 'object' &&
    'code' in result.error &&
    result.error.code === 'environment_queue_collection_unavailable'
  ) {
    const raw = result.response.headers.get('X-Gregale-Workload-Revision');
    if (raw && /^\d+$/.test(raw)) {
      const workloadRevision = Number(raw);
      if (Number.isSafeInteger(workloadRevision))
        return { kind: 'uninitialized', workloadRevision };
    }
  }
  const data = await unwrap(Promise.resolve(result));
  return { kind: 'ready', data };
}

/** Re-read every authority and the complete workload head before a stage replacement. */
export async function readStageQueueWriteContext(
  selection: StageQueueSelection,
  signal?: AbortSignal
): Promise<StageQueueSnapshot> {
  if (selection.environment === 'production')
    throw new Error('Production queue bindings use the app queue-bindings API.');
  const { project, environment, workload } = selection;
  const [account, registry, projectDetail, environmentDetail, state] = await Promise.all([
    unwrap(api.GET('/v1/account', { signal })),
    unwrap(api.GET('/v1/capabilities', { signal })),
    unwrap(api.GET('/v1/projects/{slug}', { params: { path: { slug: project } }, signal })),
    unwrap(
      api.GET('/v1/projects/{slug}/environments/{environment}', {
        params: { path: { slug: project, environment } },
        signal,
      })
    ),
    unwrap(
      api.GET('/v1/projects/{slug}/environments/{environment}/state', {
        params: { path: { slug: project, environment } },
        signal,
      })
    ),
  ]);
  const capability = registry.capabilities.find((item) => item.key === 'worker-pools');
  if (
    account.id !== selection.accountId ||
    account.plan !== selection.plan ||
    registry.plan !== selection.plan ||
    !capability?.enabled ||
    !capability.plans.includes(selection.plan)
  )
    throw new Error('Worker-pool availability or account changed. Review again.');
  const member = state.workloads.find((item) => item.workload_slug === workload);
  if (
    projectDetail.id !== selection.projectId ||
    projectDetail.slug !== project ||
    !projectDetail.workloads.some((item) => item.slug === workload) ||
    environmentDetail.id !== selection.environmentId ||
    environmentDetail.project_id !== selection.projectId ||
    environmentDetail.slug !== environment ||
    environmentDetail.protected ||
    state.project_slug !== project ||
    state.environment !== environment ||
    state.protected ||
    member?.app_id !== selection.appId
  )
    throw new Error('The project, environment, or workload selection changed. Review again.');
  const snapshot = await readStageQueueSnapshot(project, environment, workload, signal);
  if (
    snapshot.kind === 'ready' &&
    (snapshot.data.environment !== environment ||
      snapshot.data.workload !== workload ||
      snapshot.data.activation_state !== 'unavailable')
  )
    throw new Error('Stage queue response does not match the selected workload.');
  const revision =
    snapshot.kind === 'ready' ? snapshot.data.workload_revision : snapshot.workloadRevision;
  if (member.workload_config_revision !== undefined && member.workload_config_revision !== revision)
    throw new Error('The stage workload revision changed. Refresh before review.');
  return snapshot;
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

export function createQueueBinding(
  slug: string,
  body: CreateQueueBinding,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/queue-bindings', {
      params: { path: { slug } },
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
      ...(signal ? { signal } : {}),
    })
  );
}

export function readQueueBinding(slug: string, id: string, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/queue-bindings/{id}', {
      params: { path: { slug, id } },
      signal,
    })
  );
}

export function updateQueueBinding(
  slug: string,
  id: string,
  body: UpdateQueueBinding,
  signal?: AbortSignal
) {
  return unwrap(
    api.PATCH('/v1/apps/{slug}/queue-bindings/{id}', {
      params: { path: { slug, id } },
      body,
      ...(signal ? { signal } : {}),
    })
  );
}

export function deleteQueueBinding(slug: string, id: string, signal?: AbortSignal) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/queue-bindings/{id}', {
      params: { path: { slug, id } },
      ...(signal ? { signal } : {}),
    })
  );
}

export function configureQueueWorkload(
  slug: string,
  body: QueueWorkloadProfile,
  signal?: AbortSignal
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/queue-workload', {
      params: { path: { slug } },
      body,
      ...(signal ? { signal } : {}),
    })
  );
}

export function replaceStageQueueBindings(
  project: string,
  environment: string,
  workload: string,
  body: components['schemas']['ReplaceProjectEnvironmentQueueBindingsRequest'],
  signal?: AbortSignal
) {
  if (environment === 'production')
    throw new Error('Production queue bindings use the app queue-bindings API.');
  return unwrap(
    api.PUT('/v1/projects/{slug}/environments/{environment}/workloads/{workload}/queue-bindings', {
      params: { path: { slug: project, environment, workload } },
      body,
      ...(signal ? { signal } : {}),
    })
  );
}
