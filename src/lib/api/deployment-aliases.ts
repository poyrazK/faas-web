import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { keys, retryPolicy } from './queries';

/**
 * Deployment aliases (faas handlers_deployment_aliases.go): a customer-chosen
 * name pinned to one immutable deployment, served at its own stable host
 * `tag-<name>-<app id>.<apps domain>`. Setting or removing one never changes
 * the app's production traffic; it only changes what that one host serves.
 */
export type DeploymentAlias = components['schemas']['DeploymentAliasResponse'];

/**
 * The host label is `tag-` + name + `-` + the app's 32-hex id, and it must fit
 * one 63-character DNS label (api.DeploymentAliasHostLabel), so the name gets
 * what is left: 26 characters, not the 63 the path pattern alone allows.
 */
export const ALIAS_NAME_MAX = 63 - 'tag-'.length - 1 - 32;
const LABEL = /^[a-z0-9-]+$/;

/** Why apid would refuse this name, or null. */
export function aliasNameProblem(name: string): string | null {
  if (!name) return 'Name the alias.';
  if (!LABEL.test(name)) return 'Use lowercase letters, digits and hyphens only.';
  if (name.startsWith('-') || name.endsWith('-'))
    return 'The name must start and end with a letter or digit.';
  if (name.length > ALIAS_NAME_MAX)
    return `At most ${ALIAS_NAME_MAX} characters: the name shares one hostname label with the app’s id.`;
  return null;
}

/** apid accepts only a live or in-progress deployment (DeploymentPreviewActive). */
const TARGETABLE = new Set(['pending', 'building', 'imaging', 'snapshotting', 'live']);
export const aliasTargetable = (status?: string) => Boolean(status && TARGETABLE.has(status));

/**
 * What the alias host does now. The gateway serves a pinned deployment only
 * while it is live and answers 409 "Deployment not serving" otherwise
 * (gateway pinnedDeploymentNotServing), so a superseded target has stopped.
 */
export function aliasServing(
  alias: Pick<DeploymentAlias, 'deployment_status'>
): 'serving' | 'waiting' | 'stopped' | 'unknown' {
  const status = alias.deployment_status;
  if (!status) return 'unknown';
  if (status === 'live') return 'serving';
  return TARGETABLE.has(status) ? 'waiting' : 'stopped';
}

const aliasKey = (slug: string) => [...keys.app(slug), 'deployment-aliases'] as const;
const aliasQuery = (slug: string) => ({
  queryKey: aliasKey(slug),
  queryFn: async ({ signal }: { signal?: AbortSignal }) =>
    (
      await unwrap(
        api.GET('/v1/apps/{slug}/deployment-aliases', { params: { path: { slug } }, signal })
      )
    ).items,
});

export function useDeploymentAliases(slug: string) {
  return useQuery({ ...aliasQuery(slug), enabled: Boolean(slug), retry: retryPolicy });
}

/**
 * A read that ignores the cache. PUT upserts, so whether a set moves an
 * existing name is decided from what apid has now, not from a list someone
 * else may have changed since it was read.
 */
export function useFreshDeploymentAliases(slug: string) {
  const cache = useQueryClient();
  return useCallback(
    () => cache.fetchQuery({ ...aliasQuery(slug), staleTime: 0, retry: false }),
    [cache, slug]
  );
}

/**
 * A deployment going live supersedes the one before it, which stops its
 * aliases serving; that happens on the deployments poll, not through a
 * mutation, so the list rereads whenever `signature` (the deployments' ids
 * and statuses) changes.
 */
export function useAliasesFollowDeployments(slug: string, signature: string) {
  const cache = useQueryClient();
  const seen = useRef(signature);
  useEffect(() => {
    if (seen.current === signature) return;
    seen.current = signature;
    void cache.invalidateQueries({ queryKey: aliasKey(slug) });
  }, [cache, slug, signature]);
}

export function useSetDeploymentAlias(slug: string) {
  const cache = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ name, deploymentId }: { name: string; deploymentId: string }) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/deployment-aliases/{name}', {
          params: { path: { slug, name } },
          body: { deployment_id: deploymentId },
        })
      ),
    onSettled: () => cache.invalidateQueries({ queryKey: aliasKey(slug) }),
  });
}

export function useDeleteDeploymentAlias(slug: string) {
  const cache = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (name: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/deployment-aliases/{name}', {
          params: { path: { slug, name } },
        })
      ),
    onSettled: () => cache.invalidateQueries({ queryKey: aliasKey(slug) }),
  });
}
