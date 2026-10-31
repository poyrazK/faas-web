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

const { useProject, useProjects } = await import('./projects');

let calls: { path: string; params?: { path?: Record<string, string> } }[] = [];
beforeEach(() => {
  calls = [];
  workspace.org = null;
  workspace.ready = true;
  spyApi('GET').mockImplementation(async (path: string, init?: unknown) => {
    calls.push({ path, params: (init as { params?: { path?: Record<string, string> } })?.params });
    const data = path.endsWith('/projects')
      ? [{ slug: 'shop', workload_count: 2 }]
      : { slug: 'shop', workloads: [] };
    return { data, response: new Response(null, { status: 200 }) };
  });
});
afterEach(() => vi.restoreAllMocks());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('projects in a workspace', () => {
  it("lists the company's projects, including ones a teammate created", async () => {
    // GET /v1/projects is account-only (faas handlers_projects.go:29).
    workspace.org = 'acme';
    const { result } = renderHook(() => useProjects('account'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([
      { path: '/v1/orgs/{organization}/projects', params: { path: { organization: 'acme' } } },
    ]);
  });
  it("reads a company project's detail under the organization", async () => {
    workspace.org = 'acme';
    const { result } = renderHook(() => useProject('account', 'shop'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]).toEqual({
      path: '/v1/orgs/{organization}/projects/{slug}',
      params: { path: { organization: 'acme', slug: 'shop' } },
    });
  });
  it('keeps the personal route in the personal workspace', async () => {
    const { result } = renderHook(() => useProjects('account'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.map((c) => c.path)).toEqual(['/v1/projects']);
  });
  it('reads nothing until the workspace is known', async () => {
    workspace.ready = false;
    renderHook(() => useProjects('account'), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });
});
