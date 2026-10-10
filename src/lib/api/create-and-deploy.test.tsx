import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('./client', async (o) => ({ ...(await o<object>()), api }));
const addWorkflow = vi.hoisted(() => vi.fn());
vi.mock('@/lib/store', () => ({ useData: () => ({ addWorkflow }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { github_install_id: '42' } }) }));
const { useCreateAndDeploy } = await import('./create-and-deploy');

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useCreateAndDeploy', () => {
  it('creates an app at the platform floor', async () => {
    addWorkflow.mockResolvedValue({ id: 'acme-api' });
    const { result } = renderHook(() => useCreateAndDeploy(), { wrapper: wrap });
    await result.current.createApp({ name: 'acme-api' });
    expect(addWorkflow).toHaveBeenCalledWith({
      name: 'acme-api',
      runtime: 'node22',
      memoryMb: 128,
      type: 'app',
    });
  });

  it('binds the repo, then deploys the ref, and returns the deployment', async () => {
    api.POST.mockResolvedValueOnce({ data: {}, response: new Response() }).mockResolvedValueOnce({
      data: { id: 'dep1' },
      response: new Response(null, { status: 202 }),
    });
    const { result } = renderHook(() => useCreateAndDeploy(), { wrapper: wrap });
    await expect(
      result.current.deployGit({ slug: 'acme-api', repo: 'acme/api', ref: 'main' })
    ).resolves.toMatchObject({ id: 'dep1' });
    expect(api.POST.mock.calls.map(([path]) => path)).toEqual([
      '/v1/apps/{slug}/install/bind',
      '/v1/apps/{slug}/deployments/source-ref',
    ]);
  });

  it('refuses to deploy from GitHub before it is connected', async () => {
    vi.doMock('@/lib/auth', () => ({ useAuth: () => ({ account: {} }) }));
    vi.resetModules();
    const fresh = await import('./create-and-deploy');
    const { result } = renderHook(() => fresh.useCreateAndDeploy(), { wrapper: wrap });
    await expect(result.current.deployGit({ slug: 'a', repo: 'a/b', ref: 'main' })).rejects.toThrow(
      /connect github/i
    );
  });
});
