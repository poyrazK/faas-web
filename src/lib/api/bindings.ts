import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

type Schemas = components['schemas'];
export type BindingInventory = Schemas['AppBindingInventory'];
export type BindingInventoryItem = Schemas['AppBindingInventoryItem'];
type UpdateAppRequest = Schemas['UpdateAppRequest'];

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

/** The app DTO omits project identity, so verify against account-owned workload lists. */
export function useAppPolicyOwnership(accountId: string, slug: string) {
  return useQuery({
    queryKey: policyOwnershipKey(accountId, slug),
    queryFn: async ({ signal }) => {
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
    },
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
    staleTime: 30_000,
  });
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

export function patchServicePolicy(slug: string, body: ServicePolicyPatch) {
  return unwrap(
    api.PATCH('/v1/apps/{slug}', {
      params: { path: { slug } },
      body: body satisfies UpdateAppRequest,
    })
  );
}

export function patchAppVisibility(slug: string, visibility: 'public' | 'internal') {
  return unwrap(
    api.PATCH('/v1/apps/{slug}', {
      params: { path: { slug } },
      body: { visibility },
    })
  );
}
