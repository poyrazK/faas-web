import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Per-app deploy tokens, from `/v1/apps/{slug}/deploy-tokens`.
 *
 * A token carries only `deploy:write` and is accepted only on this app's
 * `/v1/apps/{slug}/…` routes and the upload sessions a source deploy opens.
 * The plaintext comes back once, on create and on rotate; the list is
 * metadata only and keeps revoked rows.
 */
export type DeployToken = components['schemas']['DeployTokenResponse'];

const key = (slug: string) => ['apps', slug, 'deploy-tokens'] as const;

export function useDeployTokens(slug: string) {
  return useQuery({
    queryKey: key(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/deploy-tokens', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
  });
}

export function useCreateDeployToken(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateDeployTokenRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/deploy-tokens', { params: { path: { slug } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(slug) }),
  });
}

/** An empty body keeps the old label and takes the default 90-day expiry. */
export function useRotateDeployToken(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/apps/{slug}/deploy-tokens/{id}/rotate', {
          params: { path: { slug, id } },
          body: {},
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(slug) }),
  });
}

export function useRevokeDeployToken(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/deploy-tokens/{id}', { params: { path: { slug, id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(slug) }),
  });
}
