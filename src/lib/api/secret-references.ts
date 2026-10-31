import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

export type SecretReferenceList = components['schemas']['AppSecretReferenceListResponse'];
export type SecretRevocation = components['schemas']['AppSecretRevocationResponse'];
export type SecretRevocationTarget = components['schemas']['SecretRevocationTarget'];

/** Under `['apps', slug]`, so whatever refreshes an app refreshes these too. */
export const secretReferencesKey = (slug: string, environment: string) =>
  ['apps', slug, 'secret-references', environment] as const;
const scopedSecretsKey = (slug: string, scope: string) =>
  [...keys.appSecrets(slug), 'scope', scope] as const;
const revocationKey = (slug: string, id: string) =>
  ['apps', slug, 'secret-revocations', id] as const;

/**
 * Destination-to-source secret references in one registered project
 * environment (faas ADR-568). The API has no default environment for them, so
 * nothing is asked until one is chosen.
 */
export function useSecretReferences(slug: string, environment: string) {
  return useQuery({
    queryKey: secretReferencesKey(slug, environment),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/secret-references', {
          params: { path: { slug }, query: { environment } },
          signal,
        })
      ),
    enabled: Boolean(slug && environment),
    retry: retryPolicy,
  });
}

/** Names of the app's sealed secrets in one scope: the only sources a reference may name. */
export function useScopedSecretNames(slug: string, scope: string) {
  return useQuery({
    queryKey: scopedSecretsKey(slug, scope),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/secrets', { params: { path: { slug }, query: { scope } }, signal })
      ),
    select: (data) => (data.secrets ?? []).map((secret) => secret.key).sort(),
    enabled: Boolean(slug && scope),
    retry: retryPolicy,
  });
}

export function useSetSecretReference(slug: string, environment: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, source }: { key: string; source: string }) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/secret-references/{key}', {
          params: { path: { slug, key }, query: { environment } },
          body: { reference: `secret:${source}` },
        })
      ),
    onSettled: () => client.invalidateQueries({ queryKey: secretReferencesKey(slug, environment) }),
  });
}

/** Leaves a suppression behind: the key stops reaching the main workload, even by name. */
export function useRemoveSecretReference(slug: string, environment: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/secret-references/{key}', {
          params: { path: { slug, key }, query: { environment } },
        })
      ),
    onSettled: () => client.invalidateQueries({ queryKey: secretReferencesKey(slug, environment) }),
  });
}

/**
 * Deletes a secret and asks for its revocation receipt: the runtimes that held
 * it when the delete committed. apid keeps the legacy 204 unless asked
 * (handlers_secrets.go `prefersSecretRevocationRepresentation`), so an older
 * server resolves to `undefined`.
 */
export function useRevokeSecret(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (key: string): Promise<SecretRevocation | undefined> =>
      (await unwrap(
        api.DELETE('/v1/apps/{slug}/secrets/{key}', {
          params: { path: { slug, key } },
          headers: { Prefer: 'return=representation' },
        })
      )) ?? undefined,
    onSuccess: (revocation) => {
      if (revocation) client.setQueryData(revocationKey(slug, revocation.id), revocation);
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.appSecrets(slug) }),
  });
}

/**
 * Poll while a reload-enabled runtime can still answer. A restart-only runtime
 * never acknowledges, so a roster of only those has settled at `blocked`.
 * Guest-init rechecks secrets every 10 seconds, so 5 seconds is enough.
 */
export function revocationPollInterval(revocation: SecretRevocation | undefined) {
  const waiting = revocation?.targets.some(
    (target) => target.status === 'pending' && target.reload_support === 'enabled'
  );
  return waiting ? 5_000 : false;
}

export function useSecretRevocation(slug: string, initial: SecretRevocation) {
  return useQuery({
    queryKey: revocationKey(slug, initial.id),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/secret-revocations/{revocation_id}', {
          params: { path: { slug, revocation_id: initial.id } },
          signal,
        })
      ),
    initialData: initial,
    staleTime: 0,
    refetchInterval: (query) => revocationPollInterval(query.state.data),
    retry: retryPolicy,
  });
}
