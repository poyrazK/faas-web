import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

function response() {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function urlOf(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), window.location.origin);
}

function queryWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

type TimeseriesProps = {
  route?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  groupBy?: 'route' | 'country';
};

function stubApiFetch(fetchMock: ReturnType<typeof vi.fn>) {
  const NativeRequest = globalThis.Request;
  vi.stubGlobal(
    'Request',
    class RequestForTest extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === 'string' && input.startsWith('/') ? `http://localhost${input}` : input,
          init
        );
      }
    }
  );
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('analytics query contracts', () => {
  it('sends the selected account SLO window and keeps it in the cache identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    stubApiFetch(fetchMock);
    const { useAccountSlo } = await import('./queries');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useAccountSlo('7d'), { wrapper: queryWrapper(queryClient) });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(urlOf(fetchMock.mock.calls[0][0]).pathname).toBe('/v1/account/slo');
    expect(urlOf(fetchMock.mock.calls[0][0]).searchParams.get('window')).toBe('7d');
    expect(queryClient.getQueryCache().getAll()[0]?.queryKey).toEqual(['account', 'slo', '7d']);
  });

  it('sends effective timeseries filters and separates their cached responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    stubApiFetch(fetchMock);
    const { useAppAnalyticsTimeseries } = await import('./queries');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = renderHook<ReturnType<typeof useAppAnalyticsTimeseries>, TimeseriesProps>(
      ({ route, method, groupBy }) =>
        useAppAnalyticsTimeseries('api-gateway', '24h', { route, method, groupBy }),
      {
        initialProps: { route: '/orders', method: 'GET', groupBy: 'route' as const },
        wrapper: queryWrapper(queryClient),
      }
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const first = urlOf(fetchMock.mock.calls[0][0]);
    expect(first.pathname).toBe('/v1/apps/api-gateway/analytics/timeseries');
    expect(Object.fromEntries(first.searchParams)).toEqual({
      since: '24h',
      route: '/orders',
      method: 'GET',
      group_by: 'route',
    });

    rerender({ route: '/orders', method: undefined, groupBy: 'country' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = urlOf(fetchMock.mock.calls[1][0]);
    expect(Object.fromEntries(second.searchParams)).toEqual({ since: '24h', group_by: 'country' });
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey)
    ).toEqual([
      ['apps', 'api-gateway', 'analytics', 'timeseries', '24h', '/orders', 'GET', 'route'],
      ['apps', 'api-gateway', 'analytics', 'timeseries', '24h', null, null, 'country'],
    ]);
  });
});
