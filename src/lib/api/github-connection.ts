import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
 * Sync and disconnect take a `github_install_manage` token that only the
 * status read mints (it is not one of `/v1/auth/csrf`'s actions). Every read
 * rewrites the HttpOnly cookie, and the token lives ten minutes, so the token
 * cached with the status may no longer match — read it fresh per mutation.
 */
async function manageToken(slug: string): Promise<string> {
  const status = await unwrap(api.GET('/v1/apps/{slug}/install', { params: { path: { slug } } }));
  return status.csrf_token ?? '';
}

export function useSyncGitHub(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const csrf_token = await manageToken(slug);
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

export function useDisconnectGitHub(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const csrf_token = await manageToken(slug);
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
