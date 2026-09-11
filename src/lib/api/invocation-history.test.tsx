import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import * as queries from './queries';

const get = vi.hoisted(() => vi.fn());
vi.mock('./client', async (original) => ({ ...(await original<object>()), api: { GET: get } }));

it('uses the last invocation id as the cursor for older pages', async () => {
  get
    .mockResolvedValueOnce({
      data: { invocations: [{ id: 'invocation-1' }, { id: 'invocation-2' }] },
      response: new Response(),
    })
    .mockResolvedValueOnce({
      data: { invocations: [{ id: 'invocation-3' }] },
      response: new Response(),
    });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => queries.useInfiniteInvocations(2), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });

  await waitFor(() => expect(result.current.hasNextPage).toBe(true));
  await act(async () => {
    await result.current.fetchNextPage();
  });

  expect(get).toHaveBeenLastCalledWith('/v1/invocations', {
    params: { query: { limit: 2, before: 'invocation-2' } },
  });
  await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  const cached = client.getQueryData<{
    pages: Array<{ invocations: Array<{ id: string }> }>;
  }>(['invocations', 'history', 2]);
  expect(cached?.pages.flatMap((page) => page.invocations).map((i) => i.id)).toEqual([
    'invocation-1',
    'invocation-2',
    'invocation-3',
  ]);
});
