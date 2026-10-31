import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  githubConnectionKey,
  useDisconnectGitHub,
  useGitHubConnection,
  useSyncGitHub,
} from './github-connection';
import { spyApi } from '@/test/api';

afterEach(() => vi.restoreAllMocks());

const bound = {
  state: 'bound',
  health: 'healthy',
  connected: true,
  installation_id: 48213377,
  repo_full_name: 'acme-corp/storefront',
  production_branch: 'main',
  last_reconcile_repository_count: 4,
  last_reconcile_detached_count: 0,
  csrf_token: 'fresh-token',
};

const ok = (data: unknown) => ({ data, response: new Response('{}', { status: 200 }) }) as never;

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it('reads the session-only status route, not the bearer-only github alias', async () => {
  const get = spyApi('GET').mockResolvedValue(ok(bound));
  const { wrapper } = setup();
  const hook = renderHook(() => useGitHubConnection('storefront'), { wrapper });
  await waitFor(() => expect(hook.result.current.data?.state).toBe('bound'));
  expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/install', {
    params: { path: { slug: 'storefront' } },
    signal: expect.any(AbortSignal),
  });
});

it('syncs with a token minted by a fresh status read and caches the answer', async () => {
  const get = spyApi('GET').mockResolvedValue(ok(bound));
  const synced = {
    ...bound,
    csrf_token: undefined,
    sync_result: { detached: false, remote_repository_count: 4, synced_at: '2026-10-31T10:00:00Z' },
  };
  const post = spyApi('POST').mockResolvedValue(ok(synced));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useSyncGitHub('storefront'), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync();
  });
  // The token's cookie is rewritten on every status read, so only the newest
  // read's token verifies — the cached one may already be stale.
  expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/install', {
    params: { path: { slug: 'storefront' } },
  });
  expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/install/sync', {
    params: { path: { slug: 'storefront' } },
    body: { csrf_token: 'fresh-token' },
  });
  expect(client.getQueryData(githubConnectionKey('storefront'))).toEqual(synced);
});

it.each([
  ['sync', useSyncGitHub, 'POST'],
  ['disconnect', useDisconnectGitHub, 'DELETE'],
] as const)(
  'cancels an in-flight status read before %s mints its token',
  async (_name, useAction, method) => {
    // A status read that lands after the fresh one rewrites the token cookie,
    // so the token about to be sent would no longer verify.
    const get = spyApi('GET').mockResolvedValue(ok(bound));
    spyApi(method).mockResolvedValue(ok(bound));
    const { client, wrapper } = setup();
    const cancel = vi.spyOn(client, 'cancelQueries');
    const hook = renderHook(() => useAction('storefront'), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync();
    });
    expect(cancel).toHaveBeenCalledWith({ queryKey: githubConnectionKey('storefront') });
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[0]);
  }
);

it('disconnects through DELETE install/bind with the CSRF envelope', async () => {
  spyApi('GET').mockResolvedValue(ok(bound));
  const unbound = {
    state: 'installed',
    health: 'healthy',
    connected: false,
    installation_id: 48213377,
    last_reconcile_repository_count: 4,
    last_reconcile_detached_count: 0,
  };
  const del = spyApi('DELETE').mockResolvedValue(ok(unbound));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useDisconnectGitHub('storefront'), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync();
  });
  expect(del).toHaveBeenCalledWith('/v1/apps/{slug}/install/bind', {
    params: { path: { slug: 'storefront' } },
    body: { csrf_token: 'fresh-token' },
  });
  expect(client.getQueryData(githubConnectionKey('storefront'))).toEqual(unbound);
});

it('refreshes the connection after the deploy dialog binds a repository', async () => {
  spyApi('GET').mockResolvedValue(ok({ csrf_token: 'bind-proof' }));
  spyApi('POST').mockResolvedValue(
    ok({ binding_id: 'b', repo_full_name: 'acme-corp/storefront', production_branch: 'main' })
  );
  const { useBindRepo } = await import('./queries');
  const { client, wrapper } = setup();
  client.setQueryData(githubConnectionKey('storefront'), { ...bound, state: 'installed' });
  const hook = renderHook(() => useBindRepo('storefront'), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync({
      installationId: 48213377,
      repo: 'acme-corp/storefront',
      branch: 'main',
    });
  });
  expect(client.getQueryState(githubConnectionKey('storefront'))?.isInvalidated).toBe(true);
});
