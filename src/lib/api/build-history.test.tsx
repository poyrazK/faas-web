import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import * as queries from './queries';
const get = vi.hoisted(() => vi.fn());
vi.mock('./client', async (original) => ({ ...(await original<object>()), api: { GET: get } }));

it('loads every build page using the opaque cursor and stops on the empty cursor', async () => {
  expect(queries).toHaveProperty('useInfiniteBuilds');
  get
    .mockResolvedValueOnce({
      data: { items: [{ id: 'build-1' }], next_before: '|queued-id' },
      response: new Response(),
    })
    .mockResolvedValueOnce({
      data: { items: [{ id: 'unattached-build' }], next_before: '' },
      response: new Response(),
    });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => queries.useInfiniteBuilds(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.hasNextPage).toBe(true));
  await act(async () => {
    await result.current.fetchNextPage();
  });
  expect(get).toHaveBeenLastCalledWith('/v1/builds', {
    params: { query: { limit: 50, before: '|queued-id' } },
  });
  await waitFor(() =>
    expect(result.current.data?.pages.flatMap((p) => p.items).map((b) => b.id)).toEqual([
      'build-1',
      'unattached-build',
    ])
  );
  expect(result.current.hasNextPage).toBe(false);
});

it('reads missing build records by exact ID without treating the current history page as complete', async () => {
  expect(queries).toHaveProperty('useBuildRecords');
  get.mockReset().mockResolvedValue({
    data: {
      id: 'build-old',
      deployment_id: 'dep-1',
      kind: 'github',
      source_bytes: 0,
      status: 'failed',
      failure_class: 'infra',
      enqueued_at: '2026-01-01T00:00:00Z',
    },
    response: new Response(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => queries.useBuildRecords(['build-old']), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current[0].data?.failure_class).toBe('infra'));
  expect(get).toHaveBeenCalledWith('/v1/builds/{id}', { params: { path: { id: 'build-old' } } });
});
