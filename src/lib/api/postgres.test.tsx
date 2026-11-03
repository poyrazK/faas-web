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

const {
  postgresDatabasesSettling,
  useChangePostgresComputePolicy,
  usePostgresCapabilities,
  usePostgresComputePolicyChange,
  usePostgresConnectionBudget,
  usePostgresOverage,
  usePostgresResize,
  usePostgresStatus,
  usePostgresUsage,
  usePurgePostgresDatabase,
  useResizePostgresDatabase,
  useSetPostgresOverage,
  useUndeletePostgresDatabase,
} = await import('./postgres');

type Init = {
  params?: { path?: Record<string, string>; query?: Record<string, unknown>; header?: object };
  body?: unknown;
};
type Call = { method: string; path: string; init?: Init };
let calls: Call[] = [];
beforeEach(() => {
  calls = [];
  workspace.org = null;
  workspace.ready = true;
  for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const)
    spyApi(method).mockImplementation(async (path: string, init?: unknown) => {
      const { signal: _signal, ...rest } = (init ?? {}) as Init & { signal?: unknown };
      calls.push({ method, path, init: rest });
      return { data: { items: [], conditions: [] }, response: new Response(null, { status: 200 }) };
    });
});
afterEach(() => vi.restoreAllMocks());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('Postgres usage and the compute cap', () => {
  it("reads the account's month from the account route in the personal workspace", async () => {
    const { result } = renderHook(() => usePostgresUsage(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.map((c) => c.path)).toEqual(['/v1/account/managed-postgres-usage']);
  });
  it("reads the company's month from the organization in a company workspace", async () => {
    workspace.org = 'acme';
    const { result } = renderHook(() => usePostgresUsage(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([
      {
        method: 'GET',
        path: '/v1/orgs/{organization}/postgres/usage',
        init: { params: { path: { organization: 'acme' } } },
      },
    ]);
  });
  it('reads nothing until the workspace is known', async () => {
    workspace.ready = false;
    renderHook(() => usePostgresUsage(), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });
  it('reads the plan capabilities for the workspace, by region when one is named', async () => {
    workspace.org = 'acme';
    const { result } = renderHook(() => usePostgresCapabilities('fra'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]).toEqual({
      method: 'GET',
      path: '/v1/orgs/{organization}/postgres/capabilities',
      init: { params: { path: { organization: 'acme' }, query: { region: 'fra' } } },
    });
  });
});

describe('compute overage', () => {
  it('is read only when offered, and only for the personal account', async () => {
    const off = renderHook(() => usePostgresOverage(false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(off.result.current.fetchStatus).toBe('idle');
    workspace.org = 'acme';
    renderHook(() => usePostgresOverage(true), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
    workspace.org = null;
    const on = renderHook(() => usePostgresOverage(true), { wrapper });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(calls.map((c) => c.path)).toEqual(['/v1/postgres/overage']);
  });
  it('is set with a PUT of the new value', async () => {
    const { result } = renderHook(() => useSetPostgresOverage(), { wrapper });
    await result.current.mutateAsync(true);
    expect(calls[0]).toEqual({
      method: 'PUT',
      path: '/v1/postgres/overage',
      init: { body: { enabled: true } },
    });
  });
});

describe('a database’s conditions and connection planning', () => {
  it('reads both from the personal routes', async () => {
    const status = renderHook(() => usePostgresStatus('db-1', true), { wrapper });
    const budget = renderHook(() => usePostgresConnectionBudget('db-1'), { wrapper });
    await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(budget.result.current.isSuccess).toBe(true));
    expect(calls.map((c) => c.path).sort()).toEqual([
      '/v1/postgres/databases/{id}/connection-budget',
      '/v1/postgres/databases/{id}/status',
    ]);
  });
  it('never reads a personal route in a company workspace, which has none for them', async () => {
    workspace.org = 'acme';
    renderHook(() => usePostgresStatus('db-1', true), { wrapper });
    renderHook(() => usePostgresConnectionBudget('db-1'), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });
  it('does not read conditions while their capability is off', async () => {
    renderHook(() => usePostgresStatus('db-1', false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });
});

describe('undelete and purge', () => {
  it('undeletes under the organization in a company workspace, with the intent’s key', async () => {
    workspace.org = 'acme';
    const { result } = renderHook(() => useUndeletePostgresDatabase(), { wrapper });
    await result.current.mutateAsync({ id: 'db-1', idempotencyKey: 'k-1' });
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/v1/orgs/{organization}/postgres/databases/{id}/undelete',
      init: {
        params: {
          path: { organization: 'acme', id: 'db-1' },
          header: { 'Idempotency-Key': 'k-1' },
        },
      },
    });
  });
  it('undeletes a personal database on the personal route', async () => {
    const { result } = renderHook(() => useUndeletePostgresDatabase(), { wrapper });
    await result.current.mutateAsync({ id: 'db-1', idempotencyKey: 'k-1' });
    expect(calls[0]?.path).toBe('/v1/postgres/databases/{id}/undelete');
  });
  it('purges with purge=true, which ends the undelete window', async () => {
    const { result } = renderHook(() => usePurgePostgresDatabase(), { wrapper });
    await result.current.mutateAsync('db-1');
    expect(calls[0]).toEqual({
      method: 'DELETE',
      path: '/v1/postgres/databases/{id}',
      init: { params: { path: { id: 'db-1' }, query: { purge: true } } },
    });
    workspace.org = 'acme';
    const org = renderHook(() => usePurgePostgresDatabase(), { wrapper });
    await org.result.current.mutateAsync('db-2');
    expect(calls[1]).toEqual({
      method: 'DELETE',
      path: '/v1/orgs/{organization}/postgres/databases/{id}',
      init: { params: { path: { organization: 'acme', id: 'db-2' }, query: { purge: true } } },
    });
  });
});

describe('postgresDatabasesSettling', () => {
  const row = (state: string, restorable_until?: string) =>
    ({ state, restorable_until }) as Parameters<typeof postgresDatabasesSettling>[0][number];
  it('polls while the provider is working on a database', () => {
    expect(postgresDatabasesSettling([row('provisioning')])).toBe(true);
    expect(postgresDatabasesSettling([row('updating')])).toBe(true);
    expect(postgresDatabasesSettling([row('deleting')])).toBe(true);
  });
  it('does not poll a scheduled delete, which waits seven days, or a settled list', () => {
    expect(postgresDatabasesSettling([row('deleting', '2026-11-10T00:00:00Z')])).toBe(false);
    expect(postgresDatabasesSettling([row('ready'), row('failed')])).toBe(false);
  });
});

describe('resize and the compute policy (beta)', () => {
  const REQUEST = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

  it('resizes a personal database with the request id as the durable key', async () => {
    const { result } = renderHook(() => useResizePostgresDatabase(), { wrapper });
    await result.current.mutateAsync({
      id: 'db-1',
      request_id: REQUEST,
      service_class: 'burstable',
    });
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/v1/postgres/databases/{id}/resize',
      init: {
        params: { path: { id: 'db-1' } },
        body: { request_id: REQUEST, service_class: 'burstable' },
      },
    });
  });

  it('resizes and changes policy under the organization in a company workspace', async () => {
    workspace.org = 'acme';
    const resize = renderHook(() => useResizePostgresDatabase(), { wrapper });
    await resize.result.current.mutateAsync({
      id: 'db-1',
      request_id: REQUEST,
      service_class: 'burstable',
    });
    const policy = renderHook(() => useChangePostgresComputePolicy(), { wrapper });
    await policy.result.current.mutateAsync({
      id: 'db-1',
      request_id: REQUEST,
      scale_to_zero: true,
    });
    expect(calls.map((c) => [c.path, c.init?.params?.path])).toEqual([
      [
        '/v1/orgs/{organization}/postgres/databases/{id}/resize',
        { organization: 'acme', id: 'db-1' },
      ],
      [
        '/v1/orgs/{organization}/postgres/databases/{id}/compute-policy',
        { organization: 'acme', id: 'db-1' },
      ],
    ]);
    expect(calls[1]?.init?.body).toEqual({ request_id: REQUEST, scale_to_zero: true });
  });

  it('follows a resize and a policy change by their ids, and only once there is one', async () => {
    const none = renderHook(() => usePostgresResize('db-1', ''), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(none.result.current.fetchStatus).toBe('idle');
    const resize = renderHook(() => usePostgresResize('db-1', REQUEST), { wrapper });
    const policy = renderHook(() => usePostgresComputePolicyChange('db-1', REQUEST), { wrapper });
    await waitFor(() => expect(resize.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(policy.result.current.isSuccess).toBe(true));
    expect(calls.map((c) => [c.path, c.init?.params?.path]).sort()).toEqual([
      [
        '/v1/postgres/databases/{id}/compute-policy-changes/{change_id}',
        { id: 'db-1', change_id: REQUEST },
      ],
      ['/v1/postgres/databases/{id}/resizes/{resize_id}', { id: 'db-1', resize_id: REQUEST }],
    ]);
  });

  it('follows them under the organization in a company workspace', async () => {
    workspace.org = 'acme';
    const resize = renderHook(() => usePostgresResize('db-1', REQUEST), { wrapper });
    const policy = renderHook(() => usePostgresComputePolicyChange('db-1', REQUEST), { wrapper });
    await waitFor(() => expect(resize.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(policy.result.current.isSuccess).toBe(true));
    expect(calls.map((c) => c.path).sort()).toEqual([
      '/v1/orgs/{organization}/postgres/databases/{id}/compute-policy-changes/{change_id}',
      '/v1/orgs/{organization}/postgres/databases/{id}/resizes/{resize_id}',
    ]);
  });
});
