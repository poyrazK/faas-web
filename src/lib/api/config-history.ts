import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError } from './errors';
import { keys } from './queries';

/**
 * Reads and the rollback for an app's config history (faas ADR-1451).
 *
 * The console edits the `default` scope only (`useAppEnv` sends no scope), so
 * these send none either and the history matches what the Environment tab
 * writes. Reads need `apps:read`; the rollback needs `env:write` and no MFA
 * step-up, because it writes variables only.
 */
export const configKeys = {
  all: keys.appConfig,
  revisions: (slug: string) => ['apps', slug, 'config', 'revisions'] as const,
  revision: (slug: string, revision: number) =>
    ['apps', slug, 'config', 'revisions', revision] as const,
  guard: (slug: string) => ['apps', slug, 'config', 'guard'] as const,
};

/** The scope's newest revisions, newest first (default 20, at most 100). */
export function useConfigRevisions(slug: string) {
  return useQuery({
    queryKey: configKeys.revisions(slug),
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/config/revisions', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

/** One revision with its variables and secret versions. Secret values never come back. */
export function useConfigRevision(slug: string, revision: number | null) {
  return useQuery({
    queryKey: configKeys.revision(slug, revision ?? 0),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/config/revisions/{revision}', {
          params: { path: { slug, revision: revision ?? 0 } },
        })
      ),
    enabled: Boolean(slug) && revision != null,
    staleTime: Infinity, // A recorded revision never changes.
  });
}

/**
 * The scope's newest guard, or `null` when no change in the scope was ever
 * guarded (`config_guard_not_found`) — that is an answer, not a failure.
 */
export function useConfigGuard(slug: string) {
  return useQuery({
    queryKey: configKeys.guard(slug),
    queryFn: async () => {
      try {
        return await unwrap(
          api.GET('/v1/apps/{slug}/config/guard', { params: { path: { slug } } })
        );
      } catch (err) {
        if (err instanceof ApiError && err.code === 'config_guard_not_found') return null;
        throw err;
      }
    },
    enabled: Boolean(slug),
    // A watching guard closes on its own within minutes; keep the verdict fresh.
    refetchInterval: (query) => (query.state.data?.status === 'watching' ? 30_000 : false),
  });
}

/** Restore the scope's variables to a revision, as one guarded change. */
export function useRollbackConfig(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (revision: number) =>
      unwrap(
        api.POST('/v1/apps/{slug}/config/rollback', {
          params: { path: { slug } },
          body: { revision },
        })
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: configKeys.all(slug) });
      void qc.invalidateQueries({ queryKey: keys.appEnv(slug) });
    },
  });
}
