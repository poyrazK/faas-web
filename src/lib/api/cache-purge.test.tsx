import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { usePurgeAppCache } from './queries';

afterEach(() => vi.restoreAllMocks());

it('sends exactly the selected cache purge scope', async () => {
  const send = vi
    .spyOn(api, 'DELETE')
    .mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const hook = renderHook(() => usePurgeAppCache('api'), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await hook.result.current.mutateAsync({});
    await hook.result.current.mutateAsync({ path: '/products/*' });
    await hook.result.current.mutateAsync({ tag: 'product:42' });
  });
  expect(send).toHaveBeenCalledTimes(3);
  expect(send).toHaveBeenNthCalledWith(1, '/v1/apps/{slug}/cache', {
    params: { path: { slug: 'api' }, query: {} },
  });
  expect(send).toHaveBeenNthCalledWith(2, '/v1/apps/{slug}/cache', {
    params: { path: { slug: 'api' }, query: { path: '/products/*' } },
  });
  expect(send).toHaveBeenNthCalledWith(3, '/v1/apps/{slug}/cache', {
    params: { path: { slug: 'api' }, query: { tag: 'product:42' } },
  });
});
