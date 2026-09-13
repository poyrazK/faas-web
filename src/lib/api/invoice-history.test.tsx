import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import * as queries from './queries';

const get = vi.hoisted(() => vi.fn());
vi.mock('./client', async (original) => ({ ...(await original<object>()), api: { GET: get } }));

it('passes the invoice timestamp cursor through while loading older pages', async () => {
  get
    .mockResolvedValueOnce({
      data: { items: [{ id: 'invoice-1' }, { id: 'invoice-2' }], next_before: 'cursor-2' },
      response: new Response(),
    })
    .mockResolvedValueOnce({
      data: { items: [{ id: 'invoice-3' }], next_before: null },
      response: new Response(),
    });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => queries.useInfiniteInvoices(2), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });

  await waitFor(() => expect(result.current.hasNextPage).toBe(true));
  await act(async () => {
    await result.current.fetchNextPage();
  });

  expect(get).toHaveBeenLastCalledWith('/v1/invoices', {
    params: { query: { limit: 2, before: 'cursor-2' } },
  });
  await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  const cached = client.getQueryData<{
    pages: Array<{ items: Array<{ id: string }> }>;
  }>(['invoices', 'history', 2]);
  expect(cached?.pages.flatMap((page) => page.items).map((invoice) => invoice.id)).toEqual([
    'invoice-1',
    'invoice-2',
    'invoice-3',
  ]);
});
