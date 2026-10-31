import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

export type RouteHealthReport = components['schemas']['RouteHealthReport'];
export type RouteHealthHistoryEntry = components['schemas']['RouteHealthHistoryEntry'];

/** The live candidate-versus-stable comparison for one canary deployment. */
export function useRouteHealthReport(slug: string, deployment: string, enabled = true) {
  return useQuery({
    queryKey: ['apps', slug, 'route-health', deployment],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/route-health/deployments/{deployment}', {
          params: { path: { slug, deployment } },
          signal,
        })
      ),
    enabled: enabled && Boolean(slug && deployment),
    retry: retryPolicy,
    refetchInterval: 30_000,
  });
}

/** Saved rollout decisions for one canary, newest first. */
export function useRouteHealthHistory(slug: string, deployment: string, enabled = true) {
  return useQuery({
    queryKey: ['apps', slug, 'route-health', deployment, 'history'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/route-health/deployments/{deployment}/history', {
          params: { path: { slug, deployment } },
          signal,
        })
      ),
    enabled: enabled && Boolean(slug && deployment),
    retry: retryPolicy,
  });
}
