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
  const { result } = renderHook(() => queries.useInfiniteAuditLog('account-a', 2), {
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
    signal: expect.any(AbortSignal),
  });
  await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  const cached = client.getQueryData<{
    pages: Array<{ entries: Array<{ id: string }> }>;
  }>(['audit-log', 'history', 'account-a', 2]);
  expect(cached?.pages.flatMap((page) => page.entries).map((entry) => entry.id)).toEqual([
    'entry-1',
    'entry-2',
    'entry-3',
  ]);
});

it('waits for a verified account and never reuses the previous account history', async () => {
  get.mockResolvedValueOnce({
    data: { entries: [{ id: 'entry-for-a' }], limit: 50 },
    response: new Response(),
  });
  get.mockImplementationOnce(() => new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result, rerender } = renderHook(({ account }) => queries.useInfiniteAuditLog(account), {
    initialProps: { account: '' },
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });

  const callsBeforeVerification = get.mock.calls.length;
  expect(result.current.fetchStatus).toBe('idle');
  rerender({ account: 'account-a' });
  await waitFor(() => expect(result.current.data?.pages[0].entries[0].id).toBe('entry-for-a'));
  expect(get).toHaveBeenCalledTimes(callsBeforeVerification + 1);

  rerender({ account: 'account-b' });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(callsBeforeVerification + 2));
  expect(result.current.data).toBeUndefined();
});
