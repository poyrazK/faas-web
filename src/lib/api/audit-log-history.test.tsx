import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import * as queries from './queries';

const get = vi.hoisted(() => vi.fn());
vi.mock('./client', async (original) => ({ ...(await original<object>()), api: { GET: get } }));

it('passes the opaque cursor through while loading older audit entries', async () => {
  get
    .mockResolvedValueOnce({
      data: {
        entries: [{ id: 'entry-1' }, { id: 'entry-2' }],
        limit: 2,
        next_before: 'audit-cursor-2',
      },
      response: new Response(),
    })
    .mockResolvedValueOnce({
      data: { entries: [{ id: 'entry-3' }], limit: 2 },
      response: new Response(),
    });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => queries.useInfiniteAuditLog(2), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });

  await waitFor(() => expect(result.current.hasNextPage).toBe(true));
  await act(async () => {
    await result.current.fetchNextPage();
  });

  expect(get).toHaveBeenLastCalledWith('/v1/audit-log', {
    params: { query: { limit: 2, before: 'audit-cursor-2' } },
  });
  await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  const cached = client.getQueryData<{
    pages: Array<{ entries: Array<{ id: string }> }>;
  }>(['audit-log', 'history', 2]);
  expect(cached?.pages.flatMap((page) => page.entries).map((entry) => entry.id)).toEqual([
    'entry-1',
    'entry-2',
    'entry-3',
  ]);
});
