import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

export type InboundEndpoint = components['schemas']['InboundWebhookEndpointResponse'];
export type InboundEndpointMetadata = Omit<InboundEndpoint, 'endpoint_url'>;
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
