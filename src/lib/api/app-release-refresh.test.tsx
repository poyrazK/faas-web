import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useAppDeployments } from './queries';

const get = vi.hoisted(() => vi.fn());
vi.mock('./client', async (original) => ({ ...(await original<object>()), api: { GET: get } }));
afterEach(() => vi.useRealTimers());

it('refreshes a building latest release until it becomes terminal, then stops polling', async () => {
  const release = {
    id: 'new',
    app_id: 'alpha-id',
    status: 'building',
    kind: 'github',
    image_digest: '',
    created_at: '2026-09-12T12:00:00Z',
  };
  get
    .mockResolvedValueOnce({
      data: { items: [release], next_before: null },
      response: new Response(),
    })
    .mockResolvedValue({
      data: { items: [{ ...release, status: 'live' }], next_before: null },
      response: new Response(),
    });
  vi.useFakeTimers();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result, unmount } = renderHook(() => useAppDeployments('alpha'), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.data?.pages[0].items[0].status).toBe('building');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(result.current.data?.pages[0].items[0].status).toBe('live');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenLastCalledWith('/v1/apps/{slug}/deployments', {
      params: { path: { slug: 'alpha' }, query: { limit: 50 } },
    });
  } finally {
    unmount();
    client.clear();
  }
});
