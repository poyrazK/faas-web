import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError } from './errors';
import type { components } from './schema';
import { keys, retryPolicy, type Deployment } from './queries';

/**
 * Scheduled releases (faas ADR-20261021152201, apidserver/scheduled_releases.go):
 * a production release built ahead of time waits live without traffic, and
 * apid starts its rollout at `release_at`. Freezes are checked again at that
 * moment, a newer serving release supersedes it, and a release that cannot
 * start stays built without traffic.
 */
export type ScheduledRelease = components['schemas']['ScheduledRelease'];
export type ScheduleReleaseRequest = components['schemas']['ScheduleReleaseRequest'];
export type CanaryPreset = components['schemas']['CanaryPresetSpec']['preset'];

/** api.ScheduledReleaseMaxAhead and ScheduledReleaseNotifyChannelsMax (faas pkg/api/limits.go:1398-1403). */
export const SCHEDULE_MAX_AHEAD_MS = 7 * 24 * 3_600_000;
export const SCHEDULE_NOTIFY_MAX = 5;

/** The ladders a schedule may name; `custom` needs stages the console does not author. */
export const SCHEDULE_PRESETS: { value: Exclude<CanaryPreset, 'custom'>; label: string }[] = [
  { value: 'balanced', label: 'Balanced canary' },
  { value: 'slow', label: 'Slow canary' },
  { value: 'aggressive', label: 'Fast canary' },
  { value: '1-10-50-100', label: '1 → 10 → 50 → 100%' },
  { value: 'adaptive', label: 'Adaptive canary' },
  { value: 'none', label: 'All traffic at once' },
];

/** One sentence per state (api.ScheduledReleaseState*), for lists and badges. */
export const SCHEDULE_STATES: Record<ScheduledRelease['state'], string> = {
  scheduled: 'Scheduled',
  started: 'Started',
  blocked: 'Could not start',
  expired: 'Expired',
  cancelled: 'Cancelled',
  superseded: 'Superseded',
};

/**
 * Why apid would refuse to schedule this release, or undefined when it may
 * (scheduled_releases.go:90-101 and notSchedulable at :326-338). The API also
 * accepts a release still building toward no traffic, which the deployment
 * does not report, so a building one is left to the server.
 */
export function scheduleBlocker(d: Deployment): string | undefined {
  if (d.scope && d.scope !== 'default')
    return 'Only production releases are scheduled; this one is for another environment or scope.';
  const status = d.status.toLowerCase();
  if (['failed', 'cancelled', 'superseded', 'stopped'].includes(status))
    return `It is ${status}; only a release that waits without traffic can be scheduled.`;
  if (d.canary_total_steps) return 'It already rolls out through a canary.';
  if ((d.traffic_percent ?? 0) > 0) return `It already takes ${d.traffic_percent}% of traffic.`;
  if (status !== 'live')
    return 'It is still building. Once it is live without traffic it can be scheduled.';
  return undefined;
}

/** A pending schedule on the deployment, as GET /v1/deployments/{id} reports it. */
export const pendingSchedule = (d: Deployment) =>
  d.scheduled_release?.state === 'scheduled' ? d.scheduled_release : undefined;

/** Why a `release_at` would be refused before it leaves the browser (api.ParseReleaseAt). */
export function releaseAtProblem(iso: string | null, now = Date.now()): string | undefined {
  if (!iso) return 'Choose when the rollout starts.';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Choose when the rollout starts.';
  if (at < now - 60_000) return 'That time has passed; choose one in the future.';
  if (at > now + SCHEDULE_MAX_AHEAD_MS) return 'At most 7 days ahead.';
  return undefined;
}

const root = ['scheduled-releases'] as const;

/** The account's scheduled releases, pending ones first; `app` narrows to one app. */
export function useScheduledReleases(app?: string, enabled = true) {
  return useQuery({
    queryKey: [...root, app ?? 'all'],
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api.GET('/v1/scheduled-releases', {
            params: { query: app ? { app } : {} },
            signal,
          })
        )
      ).items,
    enabled,
    retry: retryPolicy,
    // A schedule starts, blocks or expires on the clock.
    refetchInterval: 60_000,
  });
}

/** The release's newest schedule, or null when it was never scheduled. */
export function useDeploymentSchedule(id: string, enabled = true) {
  return useQuery({
    queryKey: [...root, 'deployment', id],
    queryFn: async ({ signal }) => {
      try {
        return await unwrap(
          api.GET('/v1/deployments/{id}/schedule', { params: { path: { id } }, signal })
        );
      } catch (err) {
        if (err instanceof ApiError && err.code === 'scheduled_release_not_found') return null;
        throw err;
      }
    },
    enabled: enabled && Boolean(id),
    retry: retryPolicy,
  });
}

function useScheduleRefresh() {
  const cache = useQueryClient();
  return () => {
    void cache.invalidateQueries({ queryKey: root });
    void cache.invalidateQueries({ queryKey: keys.deployments });
    void cache.invalidateQueries({ queryKey: keys.apps });
  };
}

/** Schedule, or move, the start of a release that waits without traffic. */
export function useScheduleRelease() {
  const refresh = useScheduleRefresh();
  return useMutation({
    retry: false,
    mutationFn: ({ id, body }: { id: string; body: ScheduleReleaseRequest }) =>
      unwrap(api.PUT('/v1/deployments/{id}/schedule', { params: { path: { id } }, body })),
    onSettled: refresh,
  });
}

/** Cancel a pending schedule; the release stays live without traffic. */
export function useCancelSchedule() {
  const refresh = useScheduleRefresh();
  return useMutation({
    retry: false,
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/deployments/{id}/schedule', { params: { path: { id } } })),
    onSettled: refresh,
  });
}
