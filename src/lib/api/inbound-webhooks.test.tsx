import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import {
  createInboundEndpointOnce,
  deleteInboundEndpoint,
  deleteWebhookBinding,
  inboundWebhookKey,
  putWebhookBinding,
  rotateInboundEndpointSecret,
  setInboundEndpointEnabled,
  setInboundEndpointDeliveryPath,
  stripInboundEndpointSecrets,
  useInboundEndpoints,
  useWebhookBinding,
  webhookBindingKey,
} from './inbound-webhooks';

const rawEndpoint = {
  id: 'endpoint-1',
  app_id: 'app-1',
  account_id: 'account-1',
  name: 'stripe-primary',
  provider: 'stripe',
  delivery_path: '/stripe',
  enabled: true,
  signing_secret_masked: '***',
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
  endpoint_url: 'https://api.example.test/v1/hooks/secret-token',
  token: 'secret-token',
};

afterEach(() => vi.restoreAllMocks());

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it('whitelists endpoint metadata before a list enters the account and app query cache', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue({
    data: [rawEndpoint],
    response: new Response(),
  } as never);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useInboundEndpoints('account-1', 'app-a'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.[0]).toMatchObject({ id: 'endpoint-1' });
  expect(JSON.stringify(client.getQueryData(inboundWebhookKey('account-1', 'app-a')))).not.toMatch(
    /secret-token|endpoint_url|"token"/
  );
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/inbound-webhooks',
    expect.objectContaining({
      params: { path: { slug: 'app-a' } },
      signal: expect.any(AbortSignal),
    })
  );
});

it('does not read without an account and keeps delayed app results isolated', async () => {
  let finish!: (value: never) => void;
  const get = vi
    .spyOn(api, 'GET')
    .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    .mockResolvedValue({ data: [], response: new Response() } as never);
  const { client, wrapper } = setup();
  const hook = renderHook(({ account, slug }) => useInboundEndpoints(account, slug), {
    wrapper,
    initialProps: { account: '', slug: 'old' },
  });
  expect(get).not.toHaveBeenCalled();
  hook.rerender({ account: 'account-1', slug: 'old' });
  hook.rerender({ account: 'account-1', slug: 'new' });
  await waitFor(() => expect(hook.result.current.data).toEqual([]));
  await act(async () => finish({ data: [rawEndpoint], response: new Response() } as never));
  expect(hook.result.current.data).toEqual([]);
  expect(client.getQueryData(inboundWebhookKey('account-1', 'new'))).toEqual([]);
});

it('keeps a one-time create result outside TanStack mutation storage and never replays a failure', async () => {
  const post = vi.spyOn(api, 'POST').mockResolvedValue({
    data: rawEndpoint,
    response: new Response(null, { status: 201 }),
  } as never);
  const { client } = setup();
  const response = await createInboundEndpointOnce('app-a', {
    name: 'stripe-primary',
    provider: 'stripe',
    signing_secret: 'whsec_private',
    delivery_path: '/stripe',
  });
  expect(response.endpoint_url).toContain('secret-token');
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(post).toHaveBeenCalledTimes(1);
  post.mockRejectedValueOnce(new TypeError('NetworkError'));
  await expect(
    createInboundEndpointOnce('app-a', {
      name: 'stripe-other',
      provider: 'stripe',
      signing_secret: 'whsec_private',
    })
  ).rejects.toThrow('NetworkError');
  expect(post).toHaveBeenCalledTimes(2);
});

it('drops unexpected token-like fields from a metadata object', () => {
  expect(JSON.stringify(stripInboundEndpointSecrets(rawEndpoint as never))).not.toMatch(
    /secret-token|endpoint_url|"token"/
  );
});

it('keeps endpoint management responses sanitized and uses the exact endpoint identity', async () => {
  const patch = vi
    .spyOn(api, 'PATCH')
    .mockResolvedValue({ data: rawEndpoint, response: new Response() } as never);
  const remove = vi
    .spyOn(api, 'DELETE')
    .mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
  expect(JSON.stringify(await setInboundEndpointEnabled('app-a', 'e1', false))).not.toContain(
    'secret-token'
  );
  expect(patch).toHaveBeenCalledWith('/v1/apps/{slug}/inbound-webhooks/{id}', {
    params: { path: { slug: 'app-a', id: 'e1' } },
    body: { enabled: false },
  });
  expect(
    JSON.stringify(await rotateInboundEndpointSecret('app-a', 'e1', 'whsec_new'))
  ).not.toContain('secret-token');
  expect(JSON.stringify(await setInboundEndpointDeliveryPath('app-a', 'e1', '/new'))).not.toContain(
    'secret-token'
  );
  expect(patch).toHaveBeenCalledWith('/v1/apps/{slug}/inbound-webhooks/{id}', {
    params: { path: { slug: 'app-a', id: 'e1' } },
    body: { delivery_path: '/new' },
  });
  await deleteInboundEndpoint('app-a', 'e1');
  expect(remove).toHaveBeenCalledWith('/v1/apps/{slug}/inbound-webhooks/{id}', {
    params: { path: { slug: 'app-a', id: 'e1' } },
  });
});

it('reads a binding in the endpoint scope and sends a versioned takeover without retrying conflicts', async () => {
  const binding = {
    endpoint_id: 'e1',
    workflow_name: 'paid',
    event_type: 'payment_intent.succeeded',
    filter: {},
    version: 4,
    updated_at: '2026-10-10T00:00:00Z',
    endpoint_url: 'secret-token',
  };
  const get = vi
    .spyOn(api, 'GET')
    .mockResolvedValue({ data: binding, response: new Response() } as never);
  const put = vi.spyOn(api, 'PUT').mockRejectedValue(new Error('409 conflict'));
  const remove = vi
    .spyOn(api, 'DELETE')
    .mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useWebhookBinding('account-1', 'app-a', 'e1'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(
    JSON.stringify(client.getQueryData(webhookBindingKey('account-1', 'app-a', 'e1')))
  ).not.toContain('secret-token');
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/inbound-webhooks/{id}/automation-binding',
    expect.objectContaining({
      params: { path: { slug: 'app-a', id: 'e1' } },
      signal: expect.any(AbortSignal),
    })
  );
  const body = {
    expected_version: 4,
    workflow_name: 'paid',
    event_type: 'payment_intent.succeeded',
    take_over_delivery: true as const,
  };
  await expect(putWebhookBinding('app-a', 'e1', body, 'operation-1')).rejects.toThrow(
    '409 conflict'
  );
  expect(put).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledWith('/v1/apps/{slug}/inbound-webhooks/{id}/automation-binding', {
    params: { path: { slug: 'app-a', id: 'e1' }, header: { 'Idempotency-Key': 'operation-1' } },
    body,
  });
  await deleteWebhookBinding('app-a', 'e1', 4);
  expect(remove).toHaveBeenCalledWith('/v1/apps/{slug}/inbound-webhooks/{id}/automation-binding', {
    params: { path: { slug: 'app-a', id: 'e1' }, query: { expected_version: 4 } },
  });
});
