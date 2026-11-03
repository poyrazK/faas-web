import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export type RouteHealthGate = components['schemas']['RouteHealthGate'];
export type RouteHealthRoute = components['schemas']['RouteHealthRoute'];
export type SetRouteHealthGate = components['schemas']['SetRouteHealthGateRequest'];

/** api.RouteHealth* limits (faas pkg/routehealth/health.go:16-52, docs/route-health.md). */
export const ROUTE_HEALTH_LIMITS = {
  routes: 20,
  probes: 5,
  pathBytes: 240,
  maxP95Ms: 86_400_000,
  watchStatuses: [401, 403, 404, 422, 429] as const,
};

const gateKey = (slug: string) => ['apps', slug, 'route-health', 'gate'] as const;

/** The app's critical routes, guard mode, recovery action and revision. */
export function useRouteHealthGate(slug: string, enabled = true) {
  return useQuery({
    queryKey: gateKey(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/route-health/gate', { params: { path: { slug } }, signal })),
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
  });
}

/** Replaces the gate at `expected_revision`; a moved revision answers 409 conflict. */
export function useSetRouteHealthGate(slug: string) {
  const cache = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (body: SetRouteHealthGate) =>
      unwrap(api.PUT('/v1/apps/{slug}/route-health/gate', { params: { path: { slug } }, body })),
    onSuccess: (gate) => cache.setQueryData(gateKey(slug), gate),
    onSettled: () => cache.invalidateQueries({ queryKey: ['apps', slug, 'route-health'] }),
  });
}

/** Why a selector would be refused (routehealth.Validate), or undefined. */
export function routeProblem(route: RouteHealthRoute): string | undefined {
  const path = route.path;
  if (
    !path.startsWith('/') ||
    new TextEncoder().encode(path).length > ROUTE_HEALTH_LIMITS.pathBytes
  )
    return 'An exact normalized path starting with /, at most 240 bytes.';
  if (/[?#*\\\s]/.test(path)) return 'No query, fragment, wildcard or whitespace: use /users/{id}.';
  if (
    route.max_p95_ms !== undefined &&
    (!Number.isInteger(route.max_p95_ms) ||
      route.max_p95_ms < 0 ||
      route.max_p95_ms > ROUTE_HEALTH_LIMITS.maxP95Ms)
  )
    return 'A p95 budget from 0 (off) to 86400000 ms.';
  if (route.probe) {
    if (route.method !== 'GET' && route.method !== 'HEAD')
      return 'Only GET and HEAD selectors can be probed.';
    if (!route.probe.path.startsWith('/') || /[?#*\s{}]/.test(route.probe.path))
      return 'A probe path is concrete: /users/42 for /users/{id}, with no query.';
  }
  return undefined;
}
