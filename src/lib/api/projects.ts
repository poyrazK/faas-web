import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';
export type ProjectSummary = components['schemas']['ProjectSummaryResponse'];
export type ProjectDetail = components['schemas']['ProjectResponse'];
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
