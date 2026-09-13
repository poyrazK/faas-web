import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import * as queries from './queries';

const get = vi.hoisted(() => vi.fn());
vi.mock('./client', async (original) => ({ ...(await original<object>()), api: { GET: get } }));

it('passes the instance cursor through while loading older pages', async () => {
  get
    .mockResolvedValueOnce({
      data: { instances: [{ id: 'instance-1' }, { id: 'instance-2' }], next_before: 'cursor-2' },
      response: new Response(),
    })
    .mockResolvedValueOnce({
      data: { instances: [{ id: 'instance-3' }], next_before: null },
      response: new Response(),
    });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => queries.useInfiniteInstances(2), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });

  await waitFor(() => expect(result.current.hasNextPage).toBe(true));
  await act(async () => {
    await result.current.fetchNextPage();
  });

  expect(get).toHaveBeenLastCalledWith('/v1/instances', {
    params: { query: { limit: 2, before: 'cursor-2' } },
  });
  await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  const cached = client.getQueryData<{
    pages: Array<{ instances: Array<{ id: string }> }>;
  }>(['instances', 'history', 2]);
  expect(cached?.pages.flatMap((page) => page.instances).map((i) => i.id)).toEqual([
    'instance-1',
    'instance-2',
    'instance-3',
  ]);
});
