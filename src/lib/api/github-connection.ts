import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

/**
 * One app's GitHub connection: the account's installation, this app's
 * repository binding, and the recent push and Check Run activity.
 *
 * These are the session-cookie `/install` routes. The `/v1/apps/{slug}/github*`
 * aliases are bearer-only (CI and agents) and reject a browser session, so the
 * console never calls them.
 */

export type GitHubConnection = components['schemas']['GitHubInstallStatus'];

export const githubConnectionKey = keys.appGitHub;

export function useGitHubConnection(slug: string) {
  return useQuery({
    queryKey: githubConnectionKey(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/install', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
  });
}

/**
 * Sync, disconnect and activity retry take a `github_install_manage` token
 * that only the status read mints (not one of `/v1/auth/csrf`'s actions). Every read
 * rewrites the HttpOnly cookie, and the token lives ten minutes, so the token
 * cached with the status may no longer match — read it fresh per mutation.
 * An in-flight status read is cancelled first: landing after this one, it
 * would rewrite the cookie and orphan the token about to be sent.
 */
async function manageToken(qc: QueryClient, slug: string): Promise<string> {
  await qc.cancelQueries({ queryKey: githubConnectionKey(slug) });
  const status = await unwrap(api.GET('/v1/apps/{slug}/install', { params: { path: { slug } } }));
  qc.setQueryData(githubConnectionKey(slug), status);
  return status.csrf_token ?? '';
}

export function useSyncGitHub(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const csrf_token = await manageToken(qc, slug);
      return unwrap(
        api.POST('/v1/apps/{slug}/install/sync', {
          params: { path: { slug } },
          body: { csrf_token },
        })
      );
    },
    onSuccess: (status) => qc.setQueryData(githubConnectionKey(slug), status),
  });
}

export type GitHubActivityRetry = components['schemas']['GitHubActivityRetryResponse'];

/**
 * Requeue up to ten recent dead pushes and Check Run updates (faas
 * handlers_github_connection.go:132-157). The answer is counts only.
 *
 * The caller names the attempt with `idempotencyKey`, so a resend of the same
 * click carries the same key. Only the bearer twin
 * (`/github/activity/retry`) replays on it, and that route refuses a browser
 * session; this one requeues only rows that are still dead, so a duplicate
 * finds nothing left to queue rather than queuing twice.
 */
export function useRetryGitHubActivity(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (idempotencyKey: string): Promise<GitHubActivityRetry> => {
      const csrf_token = await manageToken(qc, slug);
      return unwrap(
        api.POST('/v1/apps/{slug}/install/activity/retry', {
          params: { path: { slug } },
          body: { csrf_token },
          headers: { 'Idempotency-Key': idempotencyKey },
        })
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: githubConnectionKey(slug) }),
  });
}

export function useDisconnectGitHub(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const csrf_token = await manageToken(qc, slug);
      return unwrap(
        api.DELETE('/v1/apps/{slug}/install/bind', {
          params: { path: { slug } },
          body: { csrf_token },
        })
      );
    },
    onSuccess: (status) => qc.setQueryData(githubConnectionKey(slug), status),
  });
}
