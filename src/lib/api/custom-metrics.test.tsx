import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  customMetricNameError,
  customMetricValueError,
  useCustomMetricSeries,
  useCustomMetrics,
  useDeleteCustomMetric,
  usePushCustomMetric,
} from './custom-metrics';
import { spyApi } from '@/test/api';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const ok = (data: unknown, status = 200) =>
  ({ data, response: new Response(null, { status }) }) as never;

const list = {
  metrics: [
    {
      name: 'orders_pending',
      value: 1284,
      observed_at: '2026-10-31T11:58:00Z',
      stale: false,
      kind: 'gauge',
    },
  ],
  freshness_seconds: 300,
  max_metrics: 5,
};

it('lists one app’s custom metrics', async () => {
  const get = spyApi('GET').mockResolvedValue(ok(list));
  const { wrapper } = setup();
  const hook = renderHook(() => useCustomMetrics('api'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.metrics[0].name).toBe('orders_pending');
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/custom-metrics',
    expect.objectContaining({ params: { path: { slug: 'api' } } })
  );
});

it('pushes a value by name and refreshes the list', async () => {
  const get = spyApi('GET').mockResolvedValue(ok(list));
  const put = spyApi('PUT').mockResolvedValue(ok(undefined, 204));
  const { wrapper } = setup();
  const hook = renderHook(
    () => ({ list: useCustomMetrics('api'), push: usePushCustomMetric('api') }),
    { wrapper }
  );
  await waitFor(() => expect(hook.result.current.list.isSuccess).toBe(true));
  await act(() => hook.result.current.push.mutateAsync({ name: 'orders_pending', value: 12 }));
  expect(put).toHaveBeenCalledWith('/v1/apps/{slug}/custom-metrics/{name}', {
    params: { path: { slug: 'api', name: 'orders_pending' } },
    body: { value: 12 },
  });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});

it('deletes a metric by name and refreshes the list', async () => {
  const get = spyApi('GET').mockResolvedValue(ok(list));
  const del = spyApi('DELETE').mockResolvedValue(ok(undefined, 204));
  const { wrapper } = setup();
  const hook = renderHook(
    () => ({ list: useCustomMetrics('api'), remove: useDeleteCustomMetric('api') }),
    { wrapper }
  );
  await waitFor(() => expect(hook.result.current.list.isSuccess).toBe(true));
  await act(() => hook.result.current.remove.mutateAsync('orders_pending'));
  expect(del).toHaveBeenCalledWith('/v1/apps/{slug}/custom-metrics/{name}', {
    params: { path: { slug: 'api', name: 'orders_pending' } },
  });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});

it('reads a metric’s history for a range, and only once a metric is chosen', async () => {
  const get = spyApi('GET').mockResolvedValue(
    ok({
      app_id: 'app-1',
      name: 'orders_pending',
      kind: 'gauge',
      range: '6h',
      step: '5m',
      source: 'prometheus',
      points: [],
    })
  );
  const { wrapper } = setup();
  const hook = renderHook(
    ({ name }) => useCustomMetricSeries('api', name, '6h', { enabled: true }),
    { wrapper, initialProps: { name: '' } }
  );
  expect(get).not.toHaveBeenCalled();
  hook.rerender({ name: 'orders_pending' });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/custom-metrics/{name}/series',
    expect.objectContaining({
      params: { path: { slug: 'api', name: 'orders_pending' }, query: { range: '6h' } },
    })
  );
});

it('does not read history while the history capability is off', () => {
  const get = spyApi('GET');
  const { wrapper } = setup();
  renderHook(() => useCustomMetricSeries('api', 'orders_pending', '24h', { enabled: false }), {
    wrapper,
  });
  expect(get).not.toHaveBeenCalled();
});

it('does not retry history the installation has switched off', async () => {
  const get = spyApi('GET').mockResolvedValue({
    error: {
      type: 'about:blank',
      title: 'Custom metric history unavailable',
      status: 503,
      code: 'custom_metric_history_unavailable',
      detail: 'custom metric history is not enabled for this deployment',
    },
    response: new Response(null, { status: 503 }),
  } as never);
  // The default client retries; the hook's own policy must stop it.
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useCustomMetricSeries('api', 'orders_pending', '24h', { enabled: true }),
    { wrapper }
  );
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(get).toHaveBeenCalledTimes(1);
});

it('checks a name the way apid does: [a-z][a-z0-9_]{0,62}', () => {
  expect(customMetricNameError('orders_pending')).toBeUndefined();
  expect(customMetricNameError('a')).toBeUndefined();
  expect(customMetricNameError('a'.repeat(63))).toBeUndefined();
  expect(customMetricNameError('')).toMatch(/Enter a name/);
  expect(customMetricNameError('a'.repeat(64))).toMatch(/63 characters/);
  expect(customMetricNameError('Orders')).toMatch(/lowercase letter/);
  expect(customMetricNameError('1orders')).toMatch(/lowercase letter/);
  expect(customMetricNameError('_orders')).toMatch(/lowercase letter/);
  expect(customMetricNameError('orders-pending')).toMatch(/letters, digits and underscores/);
  expect(customMetricNameError('orders.pending')).toMatch(/letters, digits and underscores/);
});

it('checks a value the way apid does: finite, at least 0, at most 1e12', () => {
  expect(customMetricValueError('0')).toBeUndefined();
  expect(customMetricValueError('1284')).toBeUndefined();
  expect(customMetricValueError('0.5')).toBeUndefined();
  expect(customMetricValueError('1e12')).toBeUndefined();
  expect(customMetricValueError('')).toMatch(/Enter a number/);
  expect(customMetricValueError('abc')).toMatch(/Enter a number/);
  expect(customMetricValueError('Infinity')).toMatch(/Enter a number/);
  expect(customMetricValueError('-1')).toMatch(/0 or more/);
  expect(customMetricValueError('1000000000001')).toMatch(/at most 1,000,000,000,000/);
});
