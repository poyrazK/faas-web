import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Account release webhooks, from `/v1/account/release-webhooks` (faas
 * ADR-224). One receiver gets release events from every app the signed-in
 * account owns, including apps created later. They are always the signed-in
 * account's: the routes ignore X-Active-Org.
 *
 * The signing secret is write-only: apid seals it and answers `"***"`.
 */
export type ReleaseWebhook = components['schemas']['AccountReleaseWebhookResponse'];
export type CreateReleaseWebhook = components['schemas']['CreateAccountReleaseWebhookRequest'];
export type UpdateReleaseWebhook = components['schemas']['UpdateAccountReleaseWebhookRequest'];
export type ReleaseEvent = CreateReleaseWebhook['event_filter'][number];

/** apid's account vocabulary (pkg/api/webhooks.go:141-144), in the spec's order. */
export const RELEASE_EVENTS: { event: ReleaseEvent; what: string }[] = [
  { event: 'deployment.live', what: 'A deployment went live.' },
  { event: 'deployment.failed', what: 'A deployment failed.' },
  { event: 'rollout.completed', what: 'A progressive rollout finished.' },
  { event: 'rollout.aborted', what: 'A rollout was aborted.' },
  { event: 'environment.gitops.changed', what: "An environment's GitOps status changed." },
];

/** Under the account's key: sign-out clears ['account'], so another account never sees these. */
const releaseKey = (accountId: string) => ['account', accountId, 'release-webhooks'] as const;

export function useReleaseWebhooks(accountId: string) {
  return useQuery({
    queryKey: [...releaseKey(accountId), 'list'],
    queryFn: ({ signal }) => unwrap(api.GET('/v1/account/release-webhooks', { signal })),
    enabled: Boolean(accountId),
    retry: retryPolicy,
  });
}

export function useCreateReleaseWebhook(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReleaseWebhook) =>
      unwrap(api.POST('/v1/account/release-webhooks', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: releaseKey(accountId) }),
  });
}

export function useUpdateReleaseWebhook(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateReleaseWebhook) =>
      unwrap(api.PATCH('/v1/account/release-webhooks/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: releaseKey(accountId) }),
  });
}

/** Deleting a receiver deletes its delivery history too. */
export function useDeleteReleaseWebhook(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/account/release-webhooks/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: releaseKey(accountId) }),
  });
}

/** The new secret replaces the old at once; there is no overlap. */
export function useRotateReleaseWebhookSecret(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, webhookSecret }: { id: string; webhookSecret: string }) =>
      unwrap(
        api.POST('/v1/account/release-webhooks/{id}/rotate-secret', {
          params: { path: { id } },
          body: { webhook_secret: webhookSecret },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: releaseKey(accountId) }),
  });
}
