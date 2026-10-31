import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

export type ResourceActivity = components['schemas']['OrgActivityResponse'];
export type ActivityFilters = {
  kind_prefix?: string;
  actor_type?: 'user' | 'api_key' | 'github' | 'system' | 'operator';
};

/** App IDs can be compact or canonical UUIDs on the existing app API. */
export function activityResourceId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(value)) return undefined;
  return value.replaceAll('-', '').toLowerCase();
}

/** Resolve persisted attribution, never the user's selected workspace label. */
export async function resolveActivityWorkspace(appId: string, signal?: AbortSignal) {
  const identity = activityResourceId(appId);
  if (!identity) throw new Error('The app does not have a supported resource ID.');
  const { orgs } = await unwrap(api.GET('/v1/orgs', { signal }));
  const inventories = await Promise.allSettled(
    orgs.map(async (org) => {
      const { apps } = await unwrap(
        api.GET('/v1/orgs/{slug}/apps', {
          params: { path: { slug: org.slug } },
          signal,
        })
      );
      return apps.some((app) => activityResourceId(app.id) === identity) ? org : undefined;
    })
  );
  const matches = inventories.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  );
  if (matches.length > 1)
    throw new Error(
      'The app has conflicting workspace attribution. Activity cannot be scoped safely.'
    );
  if (matches[0]) return matches[0];
  const failure = inventories.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return null;
}

export function useActivityWorkspace(accountId: string | undefined, appId: string) {
  return useQuery({
    queryKey: ['resource-activity', accountId, 'workspace', appId],
    queryFn: ({ signal }) => resolveActivityWorkspace(appId, signal),
    enabled: Boolean(accountId && appId),
    retry: false,
    staleTime: 60_000,
  });
}

export function useResourceActivity(
  accountId: string | undefined,
  orgSlug: string | undefined,
  appId: string,
  filters: ActivityFilters
) {
  return useInfiniteQuery({
    queryKey: ['resource-activity', accountId, orgSlug, appId, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/orgs/{slug}/activity', {
          params: {
            path: { slug: orgSlug! },
            query: { app_id: appId, limit: 50, before: pageParam, ...filters },
          },
          signal,
        })
      ),
    getNextPageParam: (page, _pages, lastCursor, cursors) => {
      // A repeated cursor must never offer an endless duplicate-page loop.
      const next = page.next_before;
      return next && next !== lastCursor && !cursors.includes(next) ? next : undefined;
    },
    enabled: Boolean(accountId && orgSlug && activityResourceId(appId)),
    retry: false,
    refetchInterval: 30_000,
  });
}

/** Do not infer success from an unknown kind or from the absence of an error. */
export function activityOutcome(kind: string) {
  if (['deploy.requested', 'deploy.rollback_requested'].includes(kind)) return 'Requested';
  if (['deploy.failed', 'deploy.rollback_failed'].includes(kind)) return 'Failed';
  if (kind === 'deploy.cancelled') return 'Cancelled';
  if (
    [
      'app.created',
      'app.deleted',
      'app.restored',
      'app.config_updated',
      'app.deployed',
      'deploy.rolled_back',
      'env.set',
      'env.deleted',
      'domain.added',
      'domain.removed',
      'domain.tls_issued',
    ].includes(kind)
  )
    return 'Completed';
  return 'Recorded — outcome not provided';
}

/** Scope every page defensively and keep the API's newest-first keyset order. */
export function scopedActivity(
  pages: { items: ResourceActivity[] }[],
  appId: string,
  deploymentId?: string
) {
  const app = activityResourceId(appId);
  const release = activityResourceId(deploymentId);
  if (!app || (deploymentId && !release)) return [];
  const seen = new Set<string>();
  return pages
    .flatMap((page) => page.items)
    .filter((row) => {
      if (
        activityResourceId(row.app_id) !== app ||
        (release && activityResourceId(row.deployment_id) !== release) ||
        seen.has(row.id)
      )
        return false;
      seen.add(row.id);
      return true;
    });
}
