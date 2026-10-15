import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';
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
export function useProjects(accountId: string) {
  return useQuery({
    queryKey: projectKeys.list(accountId),
    queryFn: ({ signal }) => unwrap(api.GET('/v1/projects', { signal })),
    enabled: Boolean(accountId),
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
export function useProject(accountId: string, slug: string) {
  return useQuery({
    queryKey: projectKeys.detail(accountId, slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/projects/{slug}', { params: { path: { slug } }, signal })),
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}
