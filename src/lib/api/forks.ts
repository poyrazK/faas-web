import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

/**
 * Production forks and crash snapshots (faas ADR-732, ADR-733; docs/forks.md,
 * docs/crash-snapshots.md).
 *
 * A fork restores a copy of a running app — its memory and disk, secrets in
 * memory included — into a private VM that never serves traffic, cannot reach
 * the network, and is destroyed at its TTL. A crash snapshot is a capture of an
 * instance's memory taken after a 5xx (or on request), kept encrypted for 7
 * days, and only ever opened as a fork.
 *
 * The create responses carry the fork's `access_token` once
 * (handlers_app_forks.go:76-83 sends it `no-store` and skips the idempotent
 * replay). So they are plain calls, not TanStack mutations: nothing keeps the
 * token in a cache after the one-time panel lets it go.
 */

export type AppFork = components['schemas']['AppForkResponse'];
export type AppForkStatus = AppFork['status'];
export type ForkExec = components['schemas']['AppForkExecResponse'];
export type CreateForkExec = components['schemas']['CreateAppForkExecRequest'];
export type CrashCapture = components['schemas']['CrashCaptureResponse'];
export type CrashSettings = components['schemas']['CrashSnapshotSettingsResponse'];

/** api.AppForkMinTTL / DefaultTTL / MaxTTL (faas pkg/api/app_forks.go:62-74). */
export const FORK_TTL = { min: 60, default: 3600, max: 14400 } as const;

/** States that end on their own, so their readers keep polling (faas state.AppForkStatus). */
export const ACTIVE_FORK: ReadonlySet<AppForkStatus> = new Set(['queued', 'restoring', 'running']);
const SETTLING_FORK: ReadonlySet<AppForkStatus> = new Set(['queued', 'restoring']);
const SETTLING_CAPTURE: ReadonlySet<CrashCapture['status']> = new Set(['requested', 'capturing']);
const SETTLING_EXEC: ReadonlySet<ForkExec['status']> = new Set(['queued', 'running']);

export const forksKey = (slug: string) => ['apps', slug, 'forks'] as const;
export const crashSnapshotsKey = (slug: string) => ['apps', slug, 'crash-snapshots'] as const;

const idempotencyKey = () => crypto.randomUUID();

export function useAppForks(slug: string) {
  return useQuery({
    queryKey: forksKey(slug),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/forks', {
          params: { path: { slug }, query: { limit: 100 } },
          signal,
        })
      ),
    enabled: Boolean(slug),
    retry: retryPolicy,
    // A fork restores in seconds and expires on its own: follow a settling one
    // closely, and a running one often enough to see it end.
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      if (
        items.some(
          (f) => SETTLING_FORK.has(f.status) || (f.cancel_requested_at && ACTIVE_FORK.has(f.status))
        )
      )
        return 3_000;
      return items.some((f) => f.status === 'running') ? 15_000 : false;
    },
  });
}

/** Queues a fork of the live deployment's snapshot, or of a capture taken now (`live`). */
export function createAppFork(slug: string, body: components['schemas']['CreateAppForkRequest']) {
  return unwrap(
    api.POST('/v1/apps/{slug}/forks', {
      params: { path: { slug }, header: { 'Idempotency-Key': idempotencyKey() } },
      body,
    })
  );
}

/** Opens a ready crash snapshot as a fork; same rules and one-time token as a fork. */
export function forkCrashSnapshot(
  slug: string,
  captureId: string,
  body: components['schemas']['CreateAppForkRequest']
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/crash-snapshots/{id}/fork', {
      params: { path: { slug, id: captureId }, header: { 'Idempotency-Key': idempotencyKey() } },
      body,
    })
  );
}

export function useCancelAppFork(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/forks/{id}', {
          params: { path: { slug, id }, header: { 'Idempotency-Key': idempotencyKey() } },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: forksKey(slug) }),
  });
}

/**
 * Commands run in one fork. Their output comes from inside a copy of
 * production, so reading it needs deploy:write and secrets:read, like
 * creating the fork (faas server.go:2008-2010).
 */
export function useForkExecs(slug: string, forkId: string) {
  return useQuery({
    queryKey: [...forksKey(slug), forkId, 'execs'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/forks/{id}/execs', {
          params: { path: { slug, id: forkId }, query: { limit: 20 } },
          signal,
        })
      ),
    enabled: Boolean(slug && forkId),
    retry: retryPolicy,
    // Output is not cached past the panel that shows it.
    gcTime: 0,
    refetchInterval: (query) =>
      query.state.data?.items.some((e) => SETTLING_EXEC.has(e.status)) ? 2_000 : false,
  });
}

export function useRunForkExec(slug: string, forkId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateForkExec) =>
      unwrap(
        api.POST('/v1/apps/{slug}/forks/{id}/execs', {
          params: { path: { slug, id: forkId }, header: { 'Idempotency-Key': idempotencyKey() } },
          body,
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: [...forksKey(slug), forkId, 'execs'] }),
  });
}

export function useCrashSnapshotSettings(slug: string) {
  return useQuery({
    queryKey: [...crashSnapshotsKey(slug), 'settings'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/crash-snapshots/settings', { params: { path: { slug } }, signal })
      ),
    enabled: Boolean(slug),
    retry: retryPolicy,
  });
}

export function useSetCrashSnapshots(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/crash-snapshots/settings', {
          params: { path: { slug } },
          body: { enabled },
        })
      ),
    onSuccess: (saved) => qc.setQueryData([...crashSnapshotsKey(slug), 'settings'], saved),
  });
}

export function useCrashSnapshots(slug: string) {
  return useQuery({
    queryKey: [...crashSnapshotsKey(slug), 'list'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/crash-snapshots', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
    refetchInterval: (query) =>
      query.state.data?.items.some((c) => SETTLING_CAPTURE.has(c.status)) ? 2_000 : false,
  });
}

/** Captures the newest running instance now, with or without the 5xx setting. */
export function useCaptureCrashSnapshot(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/apps/{slug}/crash-snapshots', {
          params: { path: { slug }, header: { 'Idempotency-Key': idempotencyKey() } },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: [...crashSnapshotsKey(slug), 'list'] }),
  });
}
