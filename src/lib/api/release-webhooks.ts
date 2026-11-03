import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Outbound webhook receivers beyond the app webhook list in queries.ts:
 * account release receivers (faas ADR-224, docs/account-release-webhooks.md)
 * and the delivery health and attempt history both kinds share
 * (handlers_webhooks.go:791-869).
 */
export type ReleaseWebhook = components['schemas']['AccountReleaseWebhookResponse'];
export type CreateReleaseWebhook = components['schemas']['CreateAccountReleaseWebhookRequest'];
export type UpdateReleaseWebhook = components['schemas']['UpdateAccountReleaseWebhookRequest'];
export type ReleaseEvent = CreateReleaseWebhook['event_filter'][number];
export type WebhookDelivery = components['schemas']['AppWebhookDeliveryResponse'];
export type WebhookHealth = components['schemas']['AppWebhookDeliveryHealthResponse'];
export type WebhookAttempt = components['schemas']['AppWebhookDeliveryAttemptResponse'];

/** One receiver: an app's webhook, or one of the account's release receivers. */
export type WebhookScope = { slug: string; id: string } | { account: true; id: string };

export const releaseWebhooksKey = ['account', 'release-webhooks'] as const;

function scopeKey(scope: WebhookScope) {
  return 'slug' in scope
    ? (['apps', scope.slug, 'webhooks', scope.id] as const)
    : ([...releaseWebhooksKey, scope.id] as const);
}

export function useReleaseWebhooks() {
  return useQuery({
    queryKey: releaseWebhooksKey,
    queryFn: ({ signal }) => unwrap(api.GET('/v1/account/release-webhooks', { signal })),
    retry: retryPolicy,
  });
}

/**
 * Creates a receiver. Direct, not a TanStack mutation: the body carries the
 * plaintext signing secret, which a mutation would keep in its cached
 * `variables`. The caller invalidates `releaseWebhooksKey`.
 */
export function createReleaseWebhookOnce(body: CreateReleaseWebhook) {
  return unwrap(api.POST('/v1/account/release-webhooks', { body }));
}

/** Installs a caller-supplied secret; direct for the same reason. */
export function rotateReleaseWebhookSecretOnce(id: string, webhookSecret: string) {
  return unwrap(
    api.POST('/v1/account/release-webhooks/{id}/rotate-secret', {
      params: { path: { id } },
      body: { webhook_secret: webhookSecret },
    })
  );
}

/** Changes everything but the secret, which goes through rotation. */
export function useUpdateReleaseWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Omit<UpdateReleaseWebhook, 'webhook_secret'>;
    }) =>
      unwrap(api.PATCH('/v1/account/release-webhooks/{id}', { params: { path: { id } }, body })),
    onSettled: () => qc.invalidateQueries({ queryKey: releaseWebhooksKey }),
  });
}

/** Removes the receiver and its delivery history (docs: export first). */
export function useDeleteReleaseWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/account/release-webhooks/{id}', { params: { path: { id } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: releaseWebhooksKey }),
  });
}

/** Queue health now: receiver state, backlog, oldest overdue, 24-hour outcomes. */
export function useWebhookHealth(scope: WebhookScope) {
  return useQuery({
    queryKey: [...scopeKey(scope), 'health'],
    queryFn: ({ signal }) =>
      'slug' in scope
        ? unwrap(
            api.GET('/v1/apps/{slug}/webhooks/{id}/health', {
              params: { path: { slug: scope.slug, id: scope.id } },
              signal,
            })
          )
        : unwrap(
            api.GET('/v1/account/release-webhooks/{id}/health', {
              params: { path: { id: scope.id } },
              signal,
            })
          ),
    retry: retryPolicy,
  });
}

/** One page of deliveries, newest first; `pageToken` is the previous page's `next_token`. */
export function useWebhookDeliveryPage(scope: WebhookScope, pageToken: string) {
  return useQuery({
    queryKey: [...scopeKey(scope), 'deliveries', pageToken],
    queryFn: ({ signal }) => {
      const query = { page_size: 25, ...(pageToken ? { page_token: pageToken } : {}) };
      return 'slug' in scope
        ? unwrap(
            api.GET('/v1/apps/{slug}/webhooks/{id}/deliveries', {
              params: { path: { slug: scope.slug, id: scope.id }, query },
              signal,
            })
          )
        : unwrap(
            api.GET('/v1/account/release-webhooks/{id}/deliveries', {
              params: { path: { id: scope.id }, query },
              signal,
            })
          );
    },
    retry: retryPolicy,
  });
}

/**
 * Completed attempts for one delivery, newest first. Manual retries start a
 * new replay generation; older outcomes stay. No bodies are kept.
 */
export function useWebhookAttempts(scope: WebhookScope, deliveryId: string) {
  return useQuery({
    queryKey: [...scopeKey(scope), 'deliveries', 'attempts', deliveryId],
    queryFn: ({ signal }) =>
      'slug' in scope
        ? unwrap(
            api.GET('/v1/apps/{slug}/webhooks/{id}/deliveries/{did}/attempts', {
              params: { path: { slug: scope.slug, id: scope.id, did: deliveryId } },
              signal,
            })
          )
        : unwrap(
            api.GET('/v1/account/release-webhooks/{id}/deliveries/{did}/attempts', {
              params: { path: { id: scope.id, did: deliveryId } },
              signal,
            })
          ),
    retry: retryPolicy,
  });
}

/** Re-arms a dead delivery; apid refuses any other status with app_webhook_invalid. */
export function useRetryWebhookDelivery(scope: WebhookScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (did: string) =>
      'slug' in scope
        ? unwrap(
            api.POST('/v1/apps/{slug}/webhooks/{id}/deliveries/{did}/retry', {
              params: { path: { slug: scope.slug, id: scope.id, did } },
            })
          )
        : unwrap(
            api.POST('/v1/account/release-webhooks/{id}/deliveries/{did}/retry', {
              params: { path: { id: scope.id, did } },
            })
          ),
    onSettled: () => qc.invalidateQueries({ queryKey: scopeKey(scope) }),
  });
}
