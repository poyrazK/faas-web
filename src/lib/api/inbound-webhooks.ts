import { useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

export type InboundEndpoint = components['schemas']['InboundWebhookEndpointResponse'];
export type InboundEndpointMetadata = Omit<InboundEndpoint, 'endpoint_url'>;
export type WebhookBinding = components['schemas']['WebhookAutomationBindingResponse'];
export type WebhookReceipt = components['schemas']['WebhookAutomationReceiptResponse'];
export type StripeEndpointCreate = Omit<
  components['schemas']['CreateInboundWebhookEndpointRequest'],
  'provider' | 'delivery_path' | 'enabled'
> & {
  provider: 'stripe';
  delivery_path?: string;
  enabled?: boolean;
};

export const inboundWebhookKey = (accountId: string, slug: string) =>
  ['account', accountId, 'app', slug, 'inbound-webhooks'] as const;

/** Whitelist metadata: even a misconfigured server must not put a route token in Query. */
export function stripInboundEndpointSecrets(endpoint: InboundEndpoint): InboundEndpointMetadata {
  const {
    id,
    app_id,
    account_id,
    name,
    provider,
    delivery_path,
    enabled,
    signing_secret_masked,
    created_at,
    updated_at,
  } = endpoint;
  return {
    id,
    app_id,
    account_id,
    name,
    provider,
    delivery_path,
    enabled,
    signing_secret_masked,
    created_at,
    updated_at,
  };
}

export function useInboundEndpoints(accountId: string, slug: string) {
  return useQuery({
    queryKey: inboundWebhookKey(accountId, slug),
    queryFn: async ({ signal }) => {
      const endpoints = await unwrap(
        api.GET('/v1/apps/{slug}/inbound-webhooks', {
          params: { path: { slug } },
          signal,
        })
      );
      return endpoints.map(stripInboundEndpointSecrets);
    },
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
  });
}

/** Direct call by design: TanStack mutations retain variables and results, including secrets. */
export function createInboundEndpointOnce(slug: string, body: StripeEndpointCreate) {
  return unwrap(
    api.POST('/v1/apps/{slug}/inbound-webhooks', {
      params: { path: { slug } },
      body: {
        ...body,
        provider: 'stripe',
        delivery_path: body.delivery_path ?? '/',
        enabled: body.enabled ?? true,
      },
    })
  );
}

export function setInboundEndpointEnabled(slug: string, id: string, enabled: boolean) {
  return unwrap(
    api.PATCH('/v1/apps/{slug}/inbound-webhooks/{id}', {
      params: { path: { slug, id } },
      body: { enabled },
    })
  ).then(stripInboundEndpointSecrets);
}

export function setInboundEndpointDeliveryPath(slug: string, id: string, deliveryPath: string) {
  return unwrap(
    api.PATCH('/v1/apps/{slug}/inbound-webhooks/{id}', {
      params: { path: { slug, id } },
      body: { delivery_path: deliveryPath },
    })
  ).then(stripInboundEndpointSecrets);
}

/** A new signing secret does not rotate or recover the opaque endpoint URL. */
export function rotateInboundEndpointSecret(slug: string, id: string, signingSecret: string) {
  return unwrap(
    api.PATCH('/v1/apps/{slug}/inbound-webhooks/{id}', {
      params: { path: { slug, id } },
      body: { signing_secret: signingSecret },
    })
  ).then(stripInboundEndpointSecrets);
}

export function deleteInboundEndpoint(slug: string, id: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/inbound-webhooks/{id}', {
      params: { path: { slug, id } },
    })
  );
}

export const webhookBindingKey = (accountId: string, slug: string, id: string) =>
  [...inboundWebhookKey(accountId, slug), id, 'automation-binding'] as const;

export function useWebhookBinding(accountId: string, slug: string, id: string) {
  return useQuery({
    queryKey: webhookBindingKey(accountId, slug, id),
    queryFn: async ({ signal }) => {
      let result: WebhookBinding;
      try {
        result = await unwrap(
          api.GET('/v1/apps/{slug}/inbound-webhooks/{id}/automation-binding', {
            params: { path: { slug, id } },
            signal,
          })
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
      const { endpoint_id, workflow_name, event_type, filter, version, updated_at } = result;
      return { endpoint_id, workflow_name, event_type, filter, version, updated_at };
    },
    enabled: Boolean(accountId && slug && id),
    retry: retryPolicy,
  });
}

export function putWebhookBinding(
  slug: string,
  id: string,
  body: components['schemas']['PutWebhookAutomationBindingRequest'],
  key: string
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/inbound-webhooks/{id}/automation-binding', {
      params: { path: { slug, id }, header: { 'Idempotency-Key': key } },
      body,
    })
  );
}

export function deleteWebhookBinding(slug: string, id: string, version: number) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/inbound-webhooks/{id}/automation-binding', {
      params: { path: { slug, id }, query: { expected_version: version } },
    })
  );
}

export const webhookReceiptKey = (accountId: string, slug: string, id: string, eventId: string) =>
  [...inboundWebhookKey(accountId, slug), id, 'automation-receipt', eventId] as const;

/** A receipt is keyed by a customer-known event, not browsable as an inbox. */
export async function lookupWebhookReceipt(
  slug: string,
  id: string,
  eventId: string,
  signal?: AbortSignal
): Promise<WebhookReceipt> {
  const result = await unwrap(
    api.GET('/v1/apps/{slug}/inbound-webhooks/{id}/automation-receipts/{event_id}', {
      params: { path: { slug, id, event_id: eventId } },
      signal,
    })
  );
  const {
    receipt_id,
    endpoint_id,
    provider_event_id,
    workflow_name,
    status,
    ignored_reason,
    duplicate,
    accepted_at,
    event_source,
    routing_status,
    run_id,
  } = result;
  return {
    receipt_id,
    endpoint_id,
    provider_event_id,
    workflow_name,
    status,
    ignored_reason,
    duplicate,
    accepted_at,
    event_source,
    routing_status,
    run_id,
  };
}

export function useWebhookReceipt(accountId: string, slug: string, id: string, eventId: string) {
  return useQuery({
    queryKey: webhookReceiptKey(accountId, slug, id, eventId),
    queryFn: async ({ signal }) => {
      try {
        return await lookupWebhookReceipt(slug, id, eventId, signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(accountId && slug && id && eventId),
    retry: retryPolicy,
  });
}
