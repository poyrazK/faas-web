import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import {
  bindingInventoryKey,
  patchServicePolicy,
  policyOwnershipKey,
  useAppPolicyOwnership,
  useBindingInventory,
} from './bindings';

afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it('keys a partial binding inventory by account, app, scope and evidence selector', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue({
    data: {
      app: 'app-a',
      generated_at: '2026-10-10T00:00:00Z',
      complete: false,
      bindings: [
        {
          type: 'service',
          name: 'billing',
          binding: 'GREGALE_SERVICE_BILLING_URL',
          scope: 'app',
          access: 'declared',
          state: 'enforced',
          runtime_status: 'unknown',
          verification_status: 'stale',
          http_url: 'http://billing.svc.gregale:10081',
        },
      ],
      issues: [
        { type: 'postgres', code: 'forbidden', severity: 'error', message: 'Not permitted.' },
      ],
    },
    response: new Response(),
  } as never);
  const { wrapper } = setup();
  const hook = renderHook(() => useBindingInventory('account-1', 'app-a', 'staging', 'dep-1'), {
    wrapper,
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.complete).toBe(false);
  expect(hook.result.current.data?.bindings[0].verification_status).toBe('stale');
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/bindings',
    expect.objectContaining({
      params: { path: { slug: 'app-a' }, query: { scope: 'staging', deployment_id: 'dep-1' } },
      signal: expect.any(AbortSignal),
    })
  );
  expect(bindingInventoryKey('account-1', 'app-a', 'staging', 'dep-1')).not.toEqual(
    bindingInventoryKey('account-2', 'app-a', 'staging', 'dep-1')
  );
  expect(bindingInventoryKey('account-1', 'app-a', 'staging', 'dep-1')).not.toEqual(
    bindingInventoryKey('account-1', 'app-b', 'staging', 'dep-1')
  );
  expect(bindingInventoryKey('account-1', 'app-a', 'staging', 'dep-1')).not.toEqual(
    bindingInventoryKey('account-1', 'app-a', 'production', 'dep-1')
  );
});

it('preserves caller null, empty and omitted PATCH meanings without a generic adapter', async () => {
  const patch = vi
    .spyOn(api, 'PATCH')
    .mockResolvedValue({ data: { slug: 'app-a' }, response: new Response() } as never);
  await patchServicePolicy('app-a', { allowed_service_callers: null });
  await patchServicePolicy('app-a', { allowed_service_callers: [] });
  await patchServicePolicy('app-a', {
    service_binding_targets: [],
    service_binding_policy: 'declared',
  });
  expect(patch).toHaveBeenNthCalledWith(1, '/v1/apps/{slug}', {
    params: { path: { slug: 'app-a' } },
    body: { allowed_service_callers: null },
  });
  expect(patch).toHaveBeenNthCalledWith(2, '/v1/apps/{slug}', {
    params: { path: { slug: 'app-a' } },
    body: { allowed_service_callers: [] },
  });
  expect(patch).toHaveBeenNthCalledWith(3, '/v1/apps/{slug}', {
    params: { path: { slug: 'app-a' } },
    body: { service_binding_targets: [], service_binding_policy: 'declared' },
  });
});

it('blocks standalone edits when an authoritative project workload owns this app', async () => {
  const get = vi
    .spyOn(api, 'GET')
    .mockResolvedValueOnce({
      data: [
        { id: 'p0', slug: 'empty', workload_count: 0 },
        { id: 'p1', slug: 'shop', workload_count: 2 },
      ],
      response: new Response(),
    } as never)
    .mockResolvedValueOnce({
      data: { workloads: [{ slug: 'app-a' }] },
      response: new Response(),
    } as never);
  const { wrapper } = setup();
  const hook = renderHook(() => useAppPolicyOwnership('account-1', 'app-a'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data).toEqual({ kind: 'project', projectSlug: 'shop' });
  expect(get).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenCalledWith(
    '/v1/projects',
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(get).toHaveBeenCalledWith(
    '/v1/projects/{slug}',
    expect.objectContaining({ params: { path: { slug: 'shop' } }, signal: expect.any(AbortSignal) })
  );
  expect(policyOwnershipKey('account-1', 'app-a')).not.toEqual(
    policyOwnershipKey('account-2', 'app-a')
  );
});
