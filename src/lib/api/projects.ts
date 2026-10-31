import { useQueries, useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';
import { useWorkspaceTarget } from './workspace-apps';
export type ProjectSummary = components['schemas']['ProjectSummaryResponse'];
export type ProjectDetail = components['schemas']['ProjectResponse'];
export type ProjectEnvironment = components['schemas']['ProjectEnvironmentResponse'];
export type EnvironmentState = components['schemas']['ProjectEnvironmentStateResponse'];
export type EnvironmentDiff = components['schemas']['ProjectEnvironmentDiffResponse'];
export function validEnvironment(value: string) {
  return value !== 'default' && /^[a-z0-9](?:[a-z0-9-]{0,31}[a-z0-9])?$/.test(value);
}
export const projectKeys = {
  all: ['projects'] as const,
  list: (accountId: string) => ['projects', accountId] as const,
  detail: (accountId: string, slug: string) => ['projects', accountId, slug] as const,
};
/**
 * The projects of the active workspace. `GET /v1/projects` is account-only
 * (faas handlers_projects.go:29), so a company workspace reads
 * `/v1/orgs/{organization}/projects` (same shape), which includes projects a
 * teammate created. Nothing is read until the workspace is known.
 */
export function useProjects(accountId: string) {
  const { org, ready } = useWorkspaceTarget();
  return useQuery({
    queryKey: org ? [...projectKeys.list(accountId), 'org', org] : projectKeys.list(accountId),
    queryFn: ({ signal }) =>
      org
        ? unwrap(
            api.GET('/v1/orgs/{organization}/projects', {
              params: { path: { organization: org } },
              signal,
            })
          )
        : unwrap(api.GET('/v1/projects', { signal })),
    enabled: Boolean(accountId) && ready,
    retry: retryPolicy,
    staleTime: 30_000,
  });
}
export function useProjectEnvironments(accountId: string, slug: string) {
  return useQuery({
    queryKey: [...projectKeys.detail(accountId, slug), 'environments'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/projects/{slug}/environments', { params: { path: { slug } }, signal })),
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}
export function useProjectEnvironment(accountId: string, slug: string, environment: string) {
  return useQuery({
    queryKey: [...projectKeys.detail(accountId, slug), 'environments', environment],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/projects/{slug}/environments/{environment}', {
          params: { path: { slug, environment } },
          signal,
        })
      ),
    enabled: Boolean(accountId && slug && validEnvironment(environment)),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}
export function useEnvironmentState(accountId: string, slug: string, environment: string) {
  return useQuery({
    queryKey: [...projectKeys.detail(accountId, slug), 'environments', environment, 'state'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/projects/{slug}/environments/{environment}/state', {
          params: { path: { slug, environment } },
          signal,
        })
      ),
    enabled: Boolean(accountId && slug && validEnvironment(environment)),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}
export function useEnvironmentDiff(
  accountId: string,
  slug: string,
  environment: string,
  source: string
) {
  return useQuery({
    queryKey: [...projectKeys.detail(accountId, slug), 'environments', environment, 'diff', source],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/projects/{slug}/environments/{environment}/diff', {
          params: { path: { slug, environment }, query: { from: source } },
          signal,
        })
      ),
    enabled: Boolean(
      accountId &&
      slug &&
      validEnvironment(environment) &&
      validEnvironment(source) &&
      environment !== source
    ),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}
/** One project's detail, under the organization in a company workspace (same shape). */
function readProject(org: string | null, slug: string, signal?: AbortSignal) {
  return org
    ? unwrap(
        api.GET('/v1/orgs/{organization}/projects/{slug}', {
          params: { path: { organization: org, slug } },
          signal,
        })
      )
    : unwrap(api.GET('/v1/projects/{slug}', { params: { path: { slug } }, signal }));
}

export function useProject(accountId: string, slug: string) {
  const { org, ready } = useWorkspaceTarget();
  return useQuery({
    queryKey: org
      ? [...projectKeys.detail(accountId, slug), 'org', org]
      : projectKeys.detail(accountId, slug),
    queryFn: ({ signal }) => readProject(org, slug, signal),
    enabled: Boolean(accountId && slug) && ready,
    retry: retryPolicy,
    staleTime: 30_000,
  });
}

/**
 * Which project each app belongs to.
 *
 * Apps do not report their project (`AppResponse` has no `project_id`), and
 * the project list carries only a workload count, so membership is read from
 * every project's detail: one request per project, cached with the detail
 * pages. Until all of them have answered, membership is `pending` — an app
 * must never be shown as standalone just because its project is slow.
 */
export function useProjectMembership(accountId: string) {
  const { org } = useWorkspaceTarget();
  const list = useProjects(accountId);
  const details = useQueries({
    queries: (list.data ?? []).map((project) => ({
      queryKey: org
        ? [...projectKeys.detail(accountId, project.slug), 'org', org]
        : projectKeys.detail(accountId, project.slug),
      queryFn: ({ signal }: { signal: AbortSignal }) => readProject(org, project.slug, signal),
      enabled: Boolean(accountId),
      retry: retryPolicy,
      staleTime: 30_000,
    })),
  });
  const projectOfApp = new Map<string, string>();
  const workloadsOf = new Map<string, ProjectDetail['workloads']>();
  details.forEach((detail, index) => {
    const slug = list.data?.[index]?.slug;
    if (!slug || !detail.data) return;
    workloadsOf.set(slug, detail.data.workloads);
    for (const workload of detail.data.workloads) projectOfApp.set(workload.slug, slug);
  });
  const state: 'pending' | 'error' | 'ready' =
    list.isError || details.some((detail) => detail.isError)
      ? 'error'
      : list.isPending || details.some((detail) => detail.isPending)
        ? 'pending'
        : 'ready';
  return {
    projects: list.data ?? [],
    list,
    details,
    projectOfApp,
    workloadsOf,
    state,
    retry: () => {
      void list.refetch();
      for (const detail of details) if (detail.isError) void detail.refetch();
    },
  };
}
