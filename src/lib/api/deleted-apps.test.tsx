import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { deletedAppsKey, readDeletedApp, readDeletedApps, useDeletedApps } from './deleted-apps';

const id = '00000000-0000-4000-8000-000000000001';
const row = {
  account_id: 'account-a',
  id,
  slug: 'retained-app',
  deleted_at: '2026-10-12T12:00:00Z',
  delete_grace_until: '2026-10-19T12:00:00Z',
  restore_eligible: true,
  restore_blocker: '',
  evaluated_at: '2026-10-12T13:00:00Z',
};
let account = 'account-a';
let responseAccount = 'account-a';
let responseId = id;
const raw = () => ({
  ...row,
  account_id: responseAccount,
  id: responseId,
  signing_secret: 'must-not-cache',
  endpoint_url: 'must-not-cache-url',
});
beforeEach(() => {
  account = responseAccount = 'account-a';
  responseId = id;
  vi.spyOn(api, 'GET').mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/account'
            ? { id: account }
            : path === '/v1/deleted-apps'
              ? {
                  account_id: responseAccount,
                  apps: [raw()],
                  next_cursor: 'opaque',
                  evaluated_at: row.evaluated_at,
                  token: 'must-not-cache',
                }
              : raw(),
        response: new Response(),
      }) as never
  );
});
afterEach(() => vi.restoreAllMocks());

it('whitelists account-owned metadata before query caching and preserves the opaque cursor', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDeletedApps('account-a', 'cursor+/='), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.apps).toEqual([row]);
  expect(hook.result.current.data?.next_cursor).toBe('opaque');
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data)
    )
  ).not.toContain('must-not-cache');
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/deleted-apps',
    expect.objectContaining({
      params: { query: { limit: 25, cursor: 'cursor+/=' } },
      signal: expect.any(AbortSignal),
    })
  );
  expect(deletedAppsKey('account-a', 'cursor+/=')).not.toEqual(
    deletedAppsKey('account-b', 'cursor+/=')
  );
});

it('rejects account authority changes and mismatched response ownership', async () => {
  account = 'account-b';
  await expect(readDeletedApps('account-a', '')).rejects.toThrow(/account/i);
  account = 'account-a';
  responseAccount = 'account-b';
  await expect(readDeletedApps('account-a', '')).rejects.toThrow(/account/i);
  await expect(readDeletedApp('account-a', id)).rejects.toThrow(/account/i);
});

it('rejects a different retained identity and forwards the abort signal', async () => {
  const controller = new AbortController();
  expect(await readDeletedApp('account-a', id, controller.signal)).toEqual(row);
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/deleted-apps/{id}',
    expect.objectContaining({ params: { path: { id } }, signal: controller.signal })
  );
  responseId = '00000000-0000-4000-8000-000000000002';
  await expect(readDeletedApp('account-a', id)).rejects.toThrow(/identity/i);
  controller.abort();
  await expect(readDeletedApps('account-a', '', controller.signal)).rejects.toThrow();
});
