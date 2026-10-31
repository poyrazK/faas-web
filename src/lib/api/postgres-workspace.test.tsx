import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('./workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));

const { usePostgresDatabases, useCreatePostgresDatabase, useDeletePostgresBinding } =
  await import('./queries');

type Call = { method: string; path: string; params?: { path?: Record<string, string> } };
let calls: Call[] = [];
beforeEach(() => {
  calls = [];
  workspace.org = null;
  workspace.ready = true;
  for (const method of ['GET', 'POST', 'DELETE'] as const)
    spyApi(method).mockImplementation(async (path: string, init?: unknown) => {
      calls.push({ method, path, params: (init as { params?: Call['params'] })?.params });
      return { data: { items: [] }, response: new Response(null, { status: 200 }) };
    });
});
afterEach(() => vi.restoreAllMocks());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('Postgres in a workspace', () => {
  it("lists the company's databases in a company workspace", async () => {
    workspace.org = 'acme';
    const { result } = renderHook(() => usePostgresDatabases(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([
      {
        method: 'GET',
        path: '/v1/orgs/{organization}/postgres/databases',
        params: { path: { organization: 'acme' } },
      },
    ]);
  });
  it('creates a company database under the organization', async () => {
    workspace.org = 'acme';
    const { result } = renderHook(() => useCreatePostgresDatabase(), { wrapper });
    await result.current.mutateAsync({ name: 'orders' } as never);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/orgs/{organization}/postgres/databases',
    });
  });
  it('removes a company binding under the organization', async () => {
    workspace.org = 'acme';
    const { result } = renderHook(() => useDeletePostgresBinding('db-1'), { wrapper });
    await result.current.mutateAsync('bind-1');
    expect(calls[0]).toEqual({
      method: 'DELETE',
      path: '/v1/orgs/{organization}/postgres/bindings/{id}',
      params: { path: { organization: 'acme', id: 'bind-1' } },
    });
  });
  it('keeps the personal routes otherwise, and waits for the workspace', async () => {
    const { result } = renderHook(() => usePostgresDatabases(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.map((c) => c.path)).toEqual(['/v1/postgres/databases']);
    calls = [];
    workspace.ready = false;
    renderHook(() => usePostgresDatabases(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
      ),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });
});
