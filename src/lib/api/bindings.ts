import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

type Schemas = components['schemas'];
export type BindingInventory = Schemas['AppBindingInventory'];
export type BindingInventoryItem = Schemas['AppBindingInventoryItem'];
type UpdateAppRequest = Schemas['UpdateAppRequest'];
type Plan = Schemas['CapabilitiesResponse']['plan'];

/** Target callers have a meaningful null. Other nulls are no-ops or clears. */
export type ServicePolicyPatch = {
  allowed_service_callers?: string[] | null;
  allowed_service_call_scopes?: Schemas['ServiceCallerScopes'] | null;
  service_binding_targets?: string[];
  service_binding_policy?: 'account' | 'declared';
  service_binding_transport?: 'http' | 'https';
};

export const bindingInventoryKey = (
  accountId: string,
  slug: string,
  scope?: string,
  deploymentId?: string
) => ['account', accountId, 'app', slug, 'bindings', scope ?? null, deploymentId ?? null] as const;

export const policyOwnershipKey = (accountId: string, slug: string) =>
  ['account', accountId, 'app', slug, 'service-policy-ownership'] as const;

export const accountAppChoicesKey = (accountId: string) =>
  ['account', accountId, 'service-app-choices'] as const;

export function useAccountAppChoices(accountId: string) {
  return useQuery({
    queryKey: accountAppChoicesKey(accountId),
    queryFn: ({ signal }) => unwrap(api.GET('/v1/apps', { signal })),
    enabled: Boolean(accountId),
    retry: retryPolicy,
  });
}

/** The app DTO omits project identity, so verify against account-owned workload lists. */
export async function readAppPolicyOwnership(slug: string, signal?: AbortSignal) {
  const projects = await unwrap(api.GET('/v1/projects', { signal }));
  const candidates = projects.filter((project) => project.workload_count > 0);
  if (candidates.length > 100) return { kind: 'unverified' as const };
  for (const project of candidates) {
    const detail = await unwrap(
      api.GET('/v1/projects/{slug}', {
        params: { path: { slug: project.slug } },
        signal,
      })
    );
    if (detail.workloads.some((workload) => workload.slug === slug))
      return { kind: 'project' as const, projectSlug: project.slug };
  }
  return { kind: 'standalone' as const };
}

export function useAppPolicyOwnership(accountId: string, slug: string) {
  return useQuery({
    queryKey: policyOwnershipKey(accountId, slug),
    queryFn: ({ signal }) => readAppPolicyOwnership(slug, signal),
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}

/** Fresh, authoritative review evidence; every write calls this again. */
export async function readServicePolicyContext(
  accountId: string,
  slug: string,
  plan: Plan,
  signal?: AbortSignal
) {
  const [account, app, choices, registry] = await Promise.all([
    unwrap(api.GET('/v1/account', { signal })),
    unwrap(api.GET('/v1/apps/{slug}', { params: { path: { slug } }, signal })),
    unwrap(api.GET('/v1/apps', { signal })),
    unwrap(api.GET('/v1/capabilities', { signal })),
  ]);
  const capability = registry.capabilities.find((entry) => entry.key === 'internal-services');
  if (
    account.id !== accountId ||
    account.plan !== plan ||
    registry.plan !== plan ||
    !capability?.enabled ||
    !capability.plans.includes(plan)
  )
    throw new Error('Internal service capability is no longer available for this account.');
  if (app.preview_of_slug) throw new Error('Preview service policies are source-managed.');
  const ownership = await readAppPolicyOwnership(slug, signal);
  if (ownership.kind !== 'standalone')
    throw new Error('Service policy ownership is source-managed or could not be confirmed.');
  return { app, choices: choices.map((choice) => choice.slug).sort() };
}

export function useBindingInventory(
  accountId: string,
  slug: string,
  scope?: string,
  deploymentId?: string
) {
  return useQuery({
    queryKey: bindingInventoryKey(accountId, slug, scope, deploymentId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/bindings', {
          params: {
            path: { slug },
            query: {
              ...(scope ? { scope } : {}),
              ...(deploymentId ? { deployment_id: deploymentId } : {}),
            },
          },
          signal,
        })
      ),
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
  });
}

export function patchServicePolicy(slug: string, body: ServicePolicyPatch, signal?: AbortSignal) {
  return unwrap(
    api.PATCH('/v1/apps/{slug}', {
      params: { path: { slug } },
      body: body satisfies UpdateAppRequest,
      ...(signal ? { signal } : {}),
    })
  );
}

export function patchAppVisibility(
  slug: string,
  visibility: 'public' | 'internal',
  signal?: AbortSignal
) {
  return unwrap(
    api.PATCH('/v1/apps/{slug}', {
      params: { path: { slug } },
      body: { visibility },
      ...(signal ? { signal } : {}),
    })
  );
}

export async function readAppVisibilityContext(
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
  const capability = registry.capabilities.find((entry) => entry.key === 'private-apps');
  if (
    account.id !== accountId ||
    account.plan !== plan ||
    registry.plan !== plan ||
    !capability?.enabled ||
    !capability.plans.includes(plan)
  )
    throw new Error('Private app capability is no longer available for this account.');
  return app;
}
