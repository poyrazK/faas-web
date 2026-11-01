import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Delivery history, health, attempts and re-sending for one outbound webhook.
 *
 * App webhooks (`/v1/apps/{slug}/webhooks/{id}/…`) and account release
 * webhooks (`/v1/account/release-webhooks/{id}/…`) share one delivery ledger
 * and dispatcher in apid (ADR-224), so their sub-routes answer the same
 * shapes. A source with a slug is an app webhook; without, a release one.
 */
export interface WebhookSource {
  id: string;
  slug?: string;
}

export type WebhookDelivery = components['schemas']['AppWebhookDeliveryResponse'];
export type WebhookHealth = components['schemas']['AppWebhookDeliveryHealthResponse'];
export type WebhookAttempt = components['schemas']['AppWebhookDeliveryAttemptResponse'];

export const webhookKey = ({ id, slug }: WebhookSource) =>
  slug ? (['apps', slug, 'webhooks', id] as const) : (['release-webhooks', id] as const);

export function useWebhookHealth(source: WebhookSource) {
  const { id, slug } = source;
  return useQuery({
    queryKey: [...webhookKey(source), 'health'],
    queryFn: ({ signal }) =>
      unwrap(
        slug
          ? api.GET('/v1/apps/{slug}/webhooks/{id}/health', {
              params: { path: { slug, id } },
              signal,
            })
          : api.GET('/v1/account/release-webhooks/{id}/health', {
              params: { path: { id } },
              signal,
            })
      ),
    retry: retryPolicy,
  });
}

/** Newest first, 50 a page; `next_token` is an opaque cursor. */
export function useWebhookDeliveryPages(source: WebhookSource) {
  const { id, slug } = source;
  return useInfiniteQuery({
    queryKey: [...webhookKey(source), 'deliveries', 'pages'],
    queryFn: ({ pageParam, signal }) => {
      const query = pageParam ? { page_token: pageParam } : {};
      return unwrap(
        slug
          ? api.GET('/v1/apps/{slug}/webhooks/{id}/deliveries', {
              params: { path: { slug, id }, query },
              signal,
            })
          : api.GET('/v1/account/release-webhooks/{id}/deliveries', {
              params: { path: { id }, query },
              signal,
            })
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_token || undefined,
    retry: retryPolicy,
  });
}

/** Completed attempts for one delivery, newest first; bodies are never kept. */
export function useWebhookAttempts(source: WebhookSource, did: string, enabled: boolean) {
  const { id, slug } = source;
  return useInfiniteQuery({
    queryKey: [...webhookKey(source), 'deliveries', did, 'attempts'],
    queryFn: ({ pageParam, signal }) => {
      const query = pageParam ? { page_token: pageParam } : {};
      return unwrap(
        slug
          ? api.GET('/v1/apps/{slug}/webhooks/{id}/deliveries/{did}/attempts', {
              params: { path: { slug, id, did }, query },
              signal,
            })
          : api.GET('/v1/account/release-webhooks/{id}/deliveries/{did}/attempts', {
              params: { path: { id, did }, query },
              signal,
            })
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_token || undefined,
    enabled,
    retry: retryPolicy,
  });
}

/**
 * Re-arms a dead delivery: apid puts it back to pending with a fresh retry
 * ladder and the same delivery id. Anything not dead is refused with
 * `app_webhook_invalid` (handlers_webhooks.go:900-912).
 */
export function useResendWebhookDelivery(source: WebhookSource) {
  const qc = useQueryClient();
  const { id, slug } = source;
  return useMutation({
    mutationFn: (did: string) =>
      unwrap(
        slug
          ? api.POST('/v1/apps/{slug}/webhooks/{id}/deliveries/{did}/retry', {
              params: { path: { slug, id, did } },
            })
          : api.POST('/v1/account/release-webhooks/{id}/deliveries/{did}/retry', {
              params: { path: { id, did } },
            })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: webhookKey(source) }),
  });
}
