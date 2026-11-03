import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy, type Deployment } from './queries';

/**
 * The states a deployment can still be cancelled from (faas ADR-124:
 * CancelDeploymentTx accepts pending, building, imaging, snapshotting). Only
 * `pending` can be reordered: the builder has not claimed it yet.
 */
export const QUEUED_STATUSES = ['pending', 'building', 'imaging', 'snapshotting'] as const;
const isQueued = (d: Deployment) =>
  (QUEUED_STATUSES as readonly string[]).includes(d.status.toLowerCase());

/** The queue, oldest first: builderd claims by priority, then enqueue time. */
export function queuedDeployments(items: readonly Deployment[]): Deployment[] {
  return items.filter(isQueued).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export function queuePollInterval(items: readonly Deployment[] | undefined): number | false {
  return items?.some(isQueued) ? 3_000 : false;
}

export const QUEUE_WINDOW = 200;

/**
 * Deployments still waiting to build or building, across the account. The
 * list has no status filter, so this reads the newest page (a queued
 * deployment is among the newest) and refreshes while anything is queued.
 * It shares the deployments key, so cancel and reorder refresh it.
 */
export function useDeployQueue() {
  return useQuery({
    queryKey: [...keys.deployments, 'queue', QUEUE_WINDOW],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/deployments', { params: { query: { limit: QUEUE_WINDOW } }, signal })),
    select: (data) => queuedDeployments(data.items),
    refetchInterval: (query) => queuePollInterval(query.state.data?.items),
    retry: retryPolicy,
  });
}
