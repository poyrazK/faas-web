import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { useDebugRequests } from './queries';

const get = vi.hoisted(() => vi.fn());
vi.mock('./client', async (original) => ({ ...(await original<object>()), api: { GET: get } }));
beforeEach(() => {
  get.mockReset().mockImplementation((_path, options) =>
    Promise.resolve({
      data: {
        since: '1h',
        requests: [
          {
            id: options.params.query.route ?? 'all-routes',
            deployment_id: 'deployment-1',
            route: options.params.query.route ?? '/default',
            method: 'GET',
            status: 200,
            latency_ms: 50,
            count: 1,
            cold_boot: false,
            trace_id: null,
            received_at: '2026-09-11T06:00:00Z',
          },
        ],
      },
      response: new Response(),
    })
  );
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

it('uses the exact route filter before the explicit 20-row bound and separates route caches', async () => {
  const { result } = renderHook(
    () => ({
      orders: useDebugRequests('api', '1h', '/orders/{id}'),
      users: useDebugRequests('api', '1h', '/users'),
    }),
    { wrapper: wrapper() }
  );
  await waitFor(() => expect(result.current.orders.data?.requests[0].id).toBe('/orders/{id}'));
  expect(result.current.users.data?.requests[0].id).toBe('/users');
  expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/debug/requests', {
    params: { path: { slug: 'api' }, query: { since: '1h', route: '/orders/{id}', limit: 20 } },
  });
});

it('keeps the all-route request sample explicitly bounded without inventing a route parameter', async () => {
  const { result } = renderHook(() => useDebugRequests('api', '1h'), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data?.requests[0].id).toBe('all-routes'));
  expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/debug/requests', {
    params: { path: { slug: 'api' }, query: { since: '1h', limit: 20 } },
  });
});
