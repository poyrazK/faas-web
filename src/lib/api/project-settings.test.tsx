import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('./workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));

const { useDeleteProject, useProjectDeletePreview, useUpdateProject } =
  await import('./project-settings');

const preview = {
  project: { id: 'p1', slug: 'shop', scan_source: 'compose', workload_count: 2 },
  workloads: [
    { slug: 'api', workload_name: 'api', status: 'active' },
    { slug: 'worker', workload_name: 'worker', status: 'active' },
  ],
  domain_count: 1,
  env_count: 4,
  cron_count: 0,
};
const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) }) as never;

let client: QueryClient;
beforeEach(() => {
  workspace.org = null;
  workspace.ready = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => vi.restoreAllMocks());
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

describe('project delete preview', () => {
  it('reads the personal route in the personal workspace', async () => {
    const get = spyApi('GET').mockResolvedValue(ok(preview));
    const { result } = renderHook(() => useProjectDeletePreview('a', 'shop'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith(
      '/v1/projects/{slug}/delete-preview',
      expect.objectContaining({ params: { path: { slug: 'shop' } } })
    );
    expect(result.current.data?.domain_count).toBe(1);
  });
  it("reads a company project's preview under the organization", async () => {
    // GET /v1/orgs/{organization}/projects/{slug}/delete-preview (faas org_project_routes.go:28).
    workspace.org = 'acme';
    const get = spyApi('GET').mockResolvedValue(ok(preview));
    const { result } = renderHook(() => useProjectDeletePreview('a', 'shop'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith(
      '/v1/orgs/{organization}/projects/{slug}/delete-preview',
      expect.objectContaining({ params: { path: { organization: 'acme', slug: 'shop' } } })
    );
  });
  it('reads nothing until the workspace is known', async () => {
    workspace.ready = false;
    const get = spyApi('GET').mockResolvedValue(ok(preview));
    renderHook(() => useProjectDeletePreview('a', 'shop'), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(get).not.toHaveBeenCalled();
  });
});

describe('project update', () => {
  it('patches only the fields given and refreshes the cached detail', async () => {
    const updated = { ...preview.project, production_branch: 'release', workloads: [] };
    const patch = spyApi('PATCH').mockResolvedValue(ok(updated));
    client.setQueryData(['projects', 'a', 'shop'], { ...updated, production_branch: 'main' });
    const { result } = renderHook(() => useUpdateProject('a', 'shop'), { wrapper });
    await act(() => result.current.mutateAsync({ production_branch: 'release' }));
    expect(patch).toHaveBeenCalledWith(
      '/v1/projects/{slug}',
      expect.objectContaining({
        params: { path: { slug: 'shop' } },
        body: { production_branch: 'release' },
      })
    );
    expect(client.getQueryData<{ production_branch: string }>(['projects', 'a', 'shop'])).toEqual(
      updated
    );
  });
  it('patches a company project under the organization, never the personal route', async () => {
    // PATCH /v1/orgs/{organization}/projects/{slug} (faas org_project_routes.go:43).
    workspace.org = 'acme';
    const patch = spyApi('PATCH').mockResolvedValue(ok({ ...preview.project, workloads: [] }));
    const { result } = renderHook(() => useUpdateProject('a', 'shop'), { wrapper });
    await act(() => result.current.mutateAsync({ production_branch: 'release' }));
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      '/v1/orgs/{organization}/projects/{slug}',
      expect.objectContaining({ params: { path: { organization: 'acme', slug: 'shop' } } })
    );
  });
});

describe('project delete', () => {
  it('deletes, drops the cached detail and refreshes the project list', async () => {
    const del = spyApi('DELETE').mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 204 }),
    } as never);
    client.setQueryData(['projects', 'a', 'shop'], { slug: 'shop' });
    client.setQueryData(['projects', 'a'], [{ slug: 'shop' }]);
    const { result } = renderHook(() => useDeleteProject('a', 'shop'), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(del).toHaveBeenCalledWith(
      '/v1/projects/{slug}',
      expect.objectContaining({ params: { path: { slug: 'shop' } } })
    );
    expect(client.getQueryData(['projects', 'a', 'shop'])).toBeUndefined();
    expect(client.getQueryState(['projects', 'a'])?.isInvalidated).toBe(true);
  });
  it('deletes a company project under the organization', async () => {
    // DELETE /v1/orgs/{organization}/projects/{slug} (faas org_project_routes.go:47).
    workspace.org = 'acme';
    const del = spyApi('DELETE').mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 204 }),
    } as never);
    const { result } = renderHook(() => useDeleteProject('a', 'shop'), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(del).toHaveBeenCalledWith(
      '/v1/orgs/{organization}/projects/{slug}',
      expect.objectContaining({ params: { path: { organization: 'acme', slug: 'shop' } } })
    );
  });
});
