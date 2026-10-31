import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { bucketKey, useCreateObjectBucket } from './object-storage';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('./client', async (original) => ({ ...(await original<object>()), api }));

describe('useCreateObjectBucket', () => {
  it('posts the default scope and refreshes that app’s bucket list', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(bucketKey('acme-api'), { items: [] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    api.POST.mockResolvedValue({
      data: {
        id: 'b1',
        name: 'orders',
        scope: 'default',
        region: 'eu',
        state: 'ready',
        created_at: '',
      },
      response: new Response(null, { status: 201 }),
    });
    const { result } = renderHook(() => useCreateObjectBucket('acme-api'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await act(() => result.current.mutateAsync({ name: 'orders', region: 'eu' }));
    expect(api.POST).toHaveBeenCalledWith('/v1/apps/{slug}/buckets', {
      params: { path: { slug: 'acme-api' } },
      body: { name: 'orders', scope: 'default', region: 'eu' },
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: bucketKey('acme-api') })
    );
  });

  it('omits the region when none is known', async () => {
    const client = new QueryClient();
    api.POST.mockResolvedValue({ data: {}, response: new Response(null, { status: 201 }) });
    const { result } = renderHook(() => useCreateObjectBucket('acme-api'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await act(() => result.current.mutateAsync({ name: 'orders' }));
    expect(api.POST).toHaveBeenLastCalledWith('/v1/apps/{slug}/buckets', {
      params: { path: { slug: 'acme-api' } },
      body: { name: 'orders', scope: 'default' },
    });
  });
});
