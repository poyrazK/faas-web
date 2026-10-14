import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { useRestoreApp } from './queries';

const appId = '00000000-0000-4000-8000-000000000001';
const metadata = {
  account_id: 'account-1',
  id: appId,
  slug: 'app-a',
  deleted_at: '2026-10-12T12:00:00Z',
  delete_grace_until: '2026-10-19T12:00:00Z',
  restore_eligible: true,
  restore_blocker: '',
  evaluated_at: '2026-10-12T13:00:00Z',
};
const request = {
  accountId: 'account-1',
  appId,
  slug: 'app-a',
  expectedDeletedAt: metadata.deleted_at,
  expectedDeadline: metadata.delete_grace_until,
};
beforeEach(() => {
  window.sessionStorage.clear();
  vi.spyOn(api, 'GET').mockImplementation(
    async (path) =>
      ({
        data: path === '/v1/account' ? { id: 'account-1' } : metadata,
        response: new Response(),
      }) as never
  );
});
afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 2, retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it('uses the dedicated ID route and retains only non-secret restore identity', async () => {
  const post = vi.spyOn(api, 'POST').mockResolvedValue({
    data: { id: appId, slug: 'app-a', status: 'undeployed', signing_secret: 'must-not-retain' },
    response: new Response(),
  } as never);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useRestoreApp(), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync(request as never);
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(post).toHaveBeenCalledWith(
    '/v1/deleted-apps/{id}/restore',
    expect.objectContaining({ params: { path: { id: appId } } })
  );
  expect(
    JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state)
    )
  ).not.toContain('must-not-retain');
  expect(hook.result.current.data).toEqual({ id: appId, slug: 'app-a', status: 'undeployed' });
});

it('refreshes app, project, deployment and account-owned deleted inventories after acceptance', async () => {
  vi.spyOn(api, 'POST').mockResolvedValue({
    data: { id: appId, slug: 'app-a', status: 'undeployed' },
    response: new Response(),
  } as never);
  const { client, wrapper } = setup();
  const keys = [
    ['apps', 'app-a'],
    ['deployments'],
    ['projects', 'account-1'],
    ['account', 'account-1', 'deleted-apps'],
  ];
  for (const key of keys) client.setQueryData(key, []);
  const hook = renderHook(() => useRestoreApp(), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync(request as never);
  });
  for (const key of keys)
    expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true);
});

it('never retries or falls back to slug restoration after a lost ID-route response', async () => {
  const post = vi.spyOn(api, 'POST').mockRejectedValue(new TypeError('Response lost'));
  const { wrapper } = setup();
  const hook = renderHook(() => useRestoreApp(), { wrapper });
  await act(async () => {
    await expect(hook.result.current.mutateAsync(request as never)).rejects.toThrow(
      'Response lost'
    );
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/v1/deleted-apps/{id}/restore', expect.anything());
});

it('rejects changed account, deadline or context before any POST', async () => {
  const post = vi.spyOn(api, 'POST');
  const { wrapper } = setup();
  const hook = renderHook(() => useRestoreApp(), { wrapper });
  const get = vi.mocked(api.GET);
  get.mockResolvedValue({ data: { id: 'account-2' }, response: new Response() } as never);
  await act(async () => {
    await expect(hook.result.current.mutateAsync(request as never)).rejects.toThrow(/account/i);
  });
  get.mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/account'
            ? { id: 'account-1' }
            : { ...metadata, delete_grace_until: '2026-10-20T12:00:00Z' },
        response: new Response(),
      }) as never
  );
  await act(async () => {
    await expect(hook.result.current.mutateAsync(request as never)).rejects.toThrow(/review/i);
  });
  get.mockImplementation(
    async (path) =>
      ({
        data: path === '/v1/account' ? { id: 'account-1' } : metadata,
        response: new Response(),
      }) as never
  );
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({ ...request, isCurrent: () => false } as never)
    ).rejects.toThrow(/context/i);
  });
  expect(post).not.toHaveBeenCalled();
});

it('blocks a second attempt after a lost response and persists only its safe identity', async () => {
  const post = vi.spyOn(api, 'POST').mockRejectedValue(new TypeError('Response lost'));
  const { wrapper } = setup();
  const hook = renderHook(() => useRestoreApp(), { wrapper });
  await act(async () => {
    await expect(hook.result.current.mutateAsync(request as never)).rejects.toThrow(
      'Response lost'
    );
  });
  await act(async () => {
    await expect(hook.result.current.mutateAsync(request as never)).rejects.toThrow(/inspect/i);
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(window.sessionStorage)).toContain(appId);
  expect(JSON.stringify(window.sessionStorage)).not.toContain('must-not-retain');
});

it('requires durable identity capture before sending a restore', async () => {
  const post = vi.spyOn(api, 'POST');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  const { wrapper } = setup();
  const hook = renderHook(() => useRestoreApp(), { wrapper });
  await act(async () => {
    await expect(hook.result.current.mutateAsync(request as never)).rejects.toThrow(
      /recovery|storage/i
    );
  });
  expect(post).not.toHaveBeenCalled();
});

it('keeps existing explicit slug callers and sanitizes their mutation results', async () => {
  const post = vi.spyOn(api, 'POST').mockResolvedValue({
    data: { id: appId, slug: 'app-a', status: 'undeployed', signing_secret: 'must-not-retain' },
    response: new Response(),
  } as never);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useRestoreApp(), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync('app-a');
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(post).toHaveBeenCalledWith(
    '/v1/apps/{slug}/restore',
    expect.objectContaining({ params: { path: { slug: 'app-a' } } })
  );
  expect(
    JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state)
    )
  ).not.toContain('must-not-retain');
});
