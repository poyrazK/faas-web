import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { openAPIPreviewKey, previewObservation, useOpenAPIPreview } from './openapi-preview';
import { spyApi } from '@/test/api';

const preview = {
  app_id: 'app-1',
  source: 'preview',
  observed_available: true,
  observed_source: 'live',
  observed_inventory_available: false,
  observed_cap_hit: false,
  collectors_expected: 2,
  collectors_healthy: 2,
  routes: [
    {
      path: '/orders',
      method: 'get',
      status: 'matched',
      declared: true,
      observed: true,
      covered: true,
      rules: [
        {
          id: 'rule-1',
          match_host: 'app-a.example.com',
          match_path: '/orders',
          match_methods: ['GET'],
          priority: 10,
          enabled: true,
          kind: 'headers',
          action: { headers: { Authorization: 'hidden-credential' } },
          token: 'unexpected-secret',
        },
      ],
    },
  ],
  suggestions: [{ action: { secret: 'suggestion-secret' } }],
};
afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
function mockReads() {
  return spyApi('GET').mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/account'
            ? { id: 'account-1' }
            : path === '/v1/apps/{slug}'
              ? { id: 'app-1' }
              : preview,
        response: new Response(),
      }) as never
  );
}

it('scopes and aborts preview reads, retaining match metadata without opaque action secrets', async () => {
  const get = mockReads();
  const { client, wrapper } = setup();
  const hook = renderHook(() => useOpenAPIPreview('account-1', 'app-a'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.routes[0].rules?.[0]).toMatchObject({
    enabled: true,
    match_path: '/orders',
  });
  expect(JSON.stringify(client.getQueryData(openAPIPreviewKey('account-1', 'app-a')))).not.toMatch(
    /credential|unexpected-secret|suggestion-secret|"action"/
  );
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/openapi/preview',
    expect.objectContaining({
      params: { path: { slug: 'app-a' } },
      signal: expect.any(AbortSignal),
    })
  );
});

it('does not read without account identity and isolates a delayed old app response', async () => {
  let finish!: (value: never) => void;
  const get = mockReads();
  get.mockImplementation(async (path, options) => {
    if (path === '/v1/account')
      return { data: { id: 'account-1' }, response: new Response() } as never;
    if (path === '/v1/apps/{slug}')
      return { data: { id: 'app-1' }, response: new Response() } as never;
    if ((options as { params?: { path?: { slug: string } } }).params?.path?.slug === 'old')
      return new Promise((resolve) => {
        finish = resolve;
      });
    return { data: { ...preview, routes: [] }, response: new Response() } as never;
  });
  const { wrapper } = setup();
  const hook = renderHook(({ account, slug }) => useOpenAPIPreview(account, slug), {
    wrapper,
    initialProps: { account: '', slug: 'old' },
  });
  expect(get).not.toHaveBeenCalled();
  hook.rerender({ account: 'account-1', slug: 'old' });
  await waitFor(() => expect(finish).toBeDefined());
  hook.rerender({ account: 'account-1', slug: 'new' });
  await waitFor(() => expect(hook.result.current.data?.routes).toEqual([]));
  await act(async () => finish({ data: preview, response: new Response() } as never));
  expect(hook.result.current.data?.routes).toEqual([]);
});

it('accepts the actual null wire method list for an all-methods policy', async () => {
  const get = mockReads();
  get.mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/account'
            ? { id: 'account-1' }
            : path === '/v1/apps/{slug}'
              ? { id: 'app-1' }
              : {
                  ...preview,
                  routes: [
                    {
                      ...preview.routes[0],
                      rules: [{ ...preview.routes[0].rules[0], match_methods: null }],
                    },
                  ],
                },
        response: new Response(),
      }) as never
  );
  const { wrapper } = setup();
  const hook = renderHook(() => useOpenAPIPreview('account-1', 'app-a'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.routes[0].rules[0].match_methods).toEqual([]);
});

it('rejects unexpected account or app identity rather than caching another context', async () => {
  const get = mockReads();
  get.mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/account'
            ? { id: 'foreign' }
            : path === '/v1/apps/{slug}'
              ? { id: 'app-1' }
              : preview,
        response: new Response(),
      }) as never
  );
  const { wrapper } = setup();
  const hook = renderHook(() => useOpenAPIPreview('account-1', 'app-a'), { wrapper });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.data).toBeUndefined();
});

it('distinguishes healthy zero observations, partial telemetry, retained inventory and cap limits', () => {
  expect(previewObservation({ ...preview, routes: [] } as never)).toBe('live');
  expect(
    previewObservation({ ...preview, observed_source: 'partial', collectors_healthy: 1 } as never)
  ).toBe('partial');
  expect(
    previewObservation({
      ...preview,
      observed_source: 'unavailable',
      observed_inventory_available: true,
    } as never)
  ).toBe('unavailable');
  expect(previewObservation({ ...preview, observed_cap_hit: true } as never)).toBe('capped');
  expect(
    previewObservation({ ...preview, collectors_expected: 0, collectors_healthy: 0 } as never)
  ).toBe('unavailable');
});
