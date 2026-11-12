import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { useOnboardingInventory } from './onboarding';
import { useDeployFromRefFor, useDeployFunctionSourceFor } from './queries';
import { useCreateWorkspaceApp } from './workspace-apps';

afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 0 } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
it('restores only the actor-owned apps listed in the selected company', async () => {
  spyApi('GET').mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/apps'
            ? [
                { id: 'own-a', slug: 'personal-app' },
                { id: 'own-b', slug: 'company-app' },
              ]
            : path === '/v1/orgs/{slug}/apps'
              ? { apps: [{ id: 'own-b' }, { id: 'teammate-app' }] }
              : { items: [] },
        response: new Response(),
      }) as never
  );
  const { result } = renderHook(
    () => useOnboardingInventory({ account: 'actor', workspace: 'acme' }),
    setup()
  );
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.apps).toEqual([{ id: 'own-b', slug: 'company-app' }]);
});
it('does not turn a failed company lookup into an empty workspace or expose the account list', async () => {
  spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/orgs/{slug}/apps') throw new TypeError('offline');
    return {
      data: path === '/v1/apps' ? [{ id: 'own-a', slug: 'personal-app' }] : { items: [] },
      response: new Response(),
    } as never;
  });
  const { result } = renderHook(
    () => useOnboardingInventory({ account: 'actor', workspace: 'acme' }),
    setup()
  );
  await waitFor(() => expect(result.current.error).toBeInstanceOf(TypeError));
  expect(result.current.apps).toEqual([]);
});
it.each(['create', 'sample', 'git'] as const)(
  'never automatically repeats an ambiguous %s mutation',
  async (kind) => {
    const post = spyApi('POST').mockRejectedValue(new TypeError('response lost'));
    const { result } = renderHook(
      () => ({
        create: useCreateWorkspaceApp(),
        sample: useDeployFunctionSourceFor(),
        git: useDeployFromRefFor(),
      }),
      setup()
    );
    await act(async () => {
      const mutation =
        kind === 'create'
          ? result.current.create.mutateAsync({
              org: null,
              body: { slug: 'hello-test', type: 'function', runtime: 'node24' },
            })
          : kind === 'sample'
            ? result.current.sample.mutateAsync({
                slug: 'hello-test',
                archive: new Blob(['source']),
                runtime: 'node24',
              })
            : result.current.git.mutateAsync({
                slug: 'hello-test',
                repo: 'acme/api',
                ref: 'main',
                format: 'tarball',
              });
      await expect(mutation).rejects.toThrow('response lost');
    });
    expect(post).toHaveBeenCalledOnce();
  }
);
