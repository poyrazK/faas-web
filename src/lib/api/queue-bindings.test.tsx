import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import {
  createQueueBinding,
  queueBindingsKey,
  queueBindingStatusKey,
  readQueueBinding,
  readQueueBindingContext,
  stageQueueBindingsKey,
  useQueueBindingStatus,
  useQueueBindings,
  useStageQueueBindings,
} from './queue-bindings';

afterEach(() => vi.restoreAllMocks());
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it('keeps production binding and status reads scoped to account and app without a stage selector', async () => {
  const get = vi
    .spyOn(api, 'GET')
    .mockImplementation(async (path) =>
      path === '/v1/apps/{slug}/queue-bindings/{id}/status'
        ? ok({ binding_id: 'binding-1', consumer_state: 'active', consumer_liveness: 'stale' })
        : ok([])
    );
  const { wrapper } = setup();
  const list = renderHook(() => useQueueBindings('account-1', 'worker-1'), { wrapper });
  const status = renderHook(() => useQueueBindingStatus('account-1', 'worker-1', 'binding-1'), {
    wrapper,
  });
  await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
  await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
  expect(queueBindingsKey('account-1', 'worker-1')).not.toEqual(
    queueBindingsKey('account-2', 'worker-1')
  );
  expect(queueBindingStatusKey('account-1', 'worker-1', 'binding-1')).not.toEqual(
    queueBindingStatusKey('account-1', 'worker-2', 'binding-1')
  );
  expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/queue-bindings', {
    params: { path: { slug: 'worker-1' } },
    signal: expect.any(AbortSignal),
  });
  expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/queue-bindings/{id}/status', {
    params: { path: { slug: 'worker-1', id: 'binding-1' } },
    signal: expect.any(AbortSignal),
  });
});

it('uses a separate project/environment/workload key and path for desired stage settings', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue(ok({ activation_state: 'unavailable' }));
  const { wrapper } = setup();
  const hook = renderHook(() => useStageQueueBindings('account-1', 'shop', 'stage', 'worker-1'), {
    wrapper,
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(stageQueueBindingsKey('account-1', 'shop', 'stage', 'worker-1')).not.toEqual(
    stageQueueBindingsKey('account-1', 'shop', 'production', 'worker-1')
  );
  expect(get).toHaveBeenCalledWith(
    '/v1/projects/{slug}/environments/{environment}/workloads/{workload}/queue-bindings',
    {
      params: { path: { slug: 'shop', environment: 'stage', workload: 'worker-1' } },
      signal: expect.any(AbortSignal),
    }
  );
});

it('sends a caller-owned idempotency key for an explicit production binding create', async () => {
  const post = vi.spyOn(api, 'POST').mockResolvedValue(ok({ id: 'binding-1' }));
  await createQueueBinding(
    'worker-1',
    {
      name: 'orders',
      queue_name: 'orders',
      mode: 'pull',
      workload_class: 'worker',
      enabled: true,
      max_concurrency: 1,
    },
    'logical-operation-1'
  );
  expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/queue-bindings', {
    params: { path: { slug: 'worker-1' } },
    body: {
      name: 'orders',
      queue_name: 'orders',
      mode: 'pull',
      workload_class: 'worker',
      enabled: true,
      max_concurrency: 1,
    },
    headers: { 'Idempotency-Key': 'logical-operation-1' },
  });
});

it('rejects stale account or capability context before a queue mutation review', async () => {
  const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/v1/account') return ok({ id: 'account-2', plan: 'hobby' });
    if (path === '/v1/apps/{slug}') return ok({ id: 'app-1', slug: 'worker-1' });
    if (path === '/v1/capabilities')
      return ok({
        plan: 'hobby',
        capabilities: [{ key: 'worker-pools', enabled: true, plans: ['hobby'] }],
      });
    return ok([]);
  });
  await expect(readQueueBindingContext('account-1', 'worker-1', 'hobby')).rejects.toThrow(
    /account/i
  );
  expect(get).not.toHaveBeenCalledWith('/v1/apps/{slug}/queue-bindings', expect.anything());
});

it('reads the affected production binding by ID with an abort signal before writes', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue(ok({ id: 'binding-1', name: 'orders' }));
  const signal = new AbortController().signal;
  await readQueueBinding('worker-1', 'binding-1', signal);
  expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/queue-bindings/{id}', {
    params: { path: { slug: 'worker-1', id: 'binding-1' } },
    signal,
  });
});
