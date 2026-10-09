import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import {
  componentState,
  configurationEffects,
  readRuntimePolicy,
  useRuntimePolicy,
  type PolicyReceipt,
} from './runtime-policy';
import { gateway, status } from '@/test/runtime-policy';
import { useApp } from './queries';
it('does not reuse a previous account’s configuration read for the same slug', async () => {
  let finish!: (data: never) => void;
  vi.spyOn(api, 'GET')
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue(ok({ id: 'new-app', slug: 'api' }));
  const hook = renderHook(({ account }) => useApp('api', undefined, account), {
    wrapper: wrapper(),
    initialProps: { account: 'old' },
  });
  hook.rerender({ account: 'new' });
  await act(async () => {
    finish(ok({ id: 'old-app', slug: 'api' }));
  });
  await waitFor(() => expect(hook.result.current.data?.id).toBe('new-app'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
it('reads independent component evidence, not the active gateway summary', () => {
  expect(componentState(status, 'request_policy')).toBe('active');
  expect(componentState(status, 'edge_rules')).toBe('pending');
  expect(componentState(status, 'cpu_limit')).toBe('pending');
  expect(componentState(status, 'response_cache')).toBe('pending');
});
it('cannot claim active without a desired revision and fresh serving coverage', () => {
  expect(
    componentState(
      { ...status, request_policy: { ...gateway, serving_gateways: 0, applied_gateways: 0 } },
      'request_policy'
    )
  ).toBe('unverified');
  expect(
    componentState(
      { ...status, request_policy: { ...gateway, stale_gateways: 1 } },
      'request_policy'
    )
  ).toBe('pending');
  expect(
    componentState(
      { ...status, cpu_limit: { ...status.cpu_limit, state: 'active', desired_revision: 0 } },
      'cpu_limit'
    )
  ).toBe('unverified');
  expect(
    componentState(
      { ...status, scheduler_scaling: { ...status.scheduler_scaling, stale: true } },
      'scheduler_scaling'
    )
  ).toBe('pending');
});
it('separates hot request/CPU/scaling effects from replacement settings', () => {
  expect(
    configurationEffects(['ram_mb', 'cpu_millicores', 'max_concurrency', 'min_instances'])
  ).toEqual({
    components: ['cpu_limit', 'request_policy', 'scheduler_scaling'],
    replacement: ['ram_mb'],
    future: [],
  });
});
it('bounds optional wait and sends only a read request', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue(ok(status));
  await readRuntimePolicy('api', 10);
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/policy/status',
    expect.objectContaining({ params: { path: { slug: 'api' }, query: { wait: '10s' } } })
  );
  await expect(readRuntimePolicy('api', 11)).rejects.toThrow();
  expect(get).toHaveBeenCalledTimes(1);
});
it('fences a delayed prior save from the latest accepted operation', async () => {
  let finish!: (data: never) => void;
  vi.spyOn(api, 'GET')
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue(
      ok({
        ...status,
        request_policy: {
          ...gateway,
          state: 'pending',
          desired_revision: 7,
          pending_gateways: 1,
          applied_gateways: 1,
        },
      })
    );
  const receipt: PolicyReceipt = {
    id: 'old',
    appId: 'app-1',
    acceptedAt: Date.now(),
    components: ['request_policy'],
    baseline: { request_policy: 5 },
    action: 'configuration',
  };
  const hook = renderHook(({ operation }) => useRuntimePolicy('account', 'api', operation), {
    wrapper: wrapper(),
    initialProps: { operation: receipt },
  });
  hook.rerender({ operation: { ...receipt, id: 'new', baseline: { request_policy: 6 } } });
  await waitFor(() => expect(hook.result.current.data?.request_policy.desired_revision).toBe(7));
  await act(async () => finish(ok(status)));
  expect(hook.result.current.data?.request_policy.state).toBe('pending');
});
it('stops bounded polling without converting pending into applied', async () => {
  vi.useFakeTimers();
  const get = vi.spyOn(api, 'GET').mockResolvedValue(ok(status));
  const receipt: PolicyReceipt = {
    id: 'purge',
    appId: 'app-1',
    acceptedAt: Date.now(),
    components: ['response_cache'],
    baseline: { response_cache: 4 },
    action: 'purge',
  };
  const hook = renderHook(
    () => {
      const query = useRuntimePolicy('account', 'api', receipt);
      void query.data;
      return query;
    },
    { wrapper: wrapper() }
  );
  await act(async () => vi.advanceTimersByTimeAsync(20));
  await act(async () => vi.advanceTimersByTimeAsync(125_000));
  const calls = get.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(get).toHaveBeenCalledTimes(calls);
  expect(hook.result.current.data?.response_cache.state).toBe('pending');
  expect(calls).toBeGreaterThan(1);
});
