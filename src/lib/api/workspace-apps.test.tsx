import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import {
  createWorkspaceApp,
  orgAppsKey,
  useCreateWorkspaceApp,
  useWorkspaceTarget,
  workspaceCreateError,
} from './workspace-apps';
import { bindWorkspaceAccount, setActiveOrg } from '../workspace';
import { spyApi } from '@/test/api';

const org = (slug: string, name: string, personal: boolean) => ({
  id: slug,
  slug,
  name,
  personal,
  plan: 'pro',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});
const body = {
  slug: 'team-api',
  type: 'function' as const,
  runtime: 'node22' as const,
  cpu_millicores: 1000 as const,
  head_wakes: false,
  crawler_policy: 'wake' as const,
};

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  bindWorkspaceAccount('account-1');
  setActiveOrg(null);
});
afterEach(() => vi.restoreAllMocks());

it('creates through the workspace URL only when a shared workspace is chosen', async () => {
  const post = spyApi('POST').mockResolvedValue({
    data: { id: 'app' },
    response: new Response(null, { status: 201 }),
  } as never);
  await createWorkspaceApp('acme-corp', body);
  expect(post).toHaveBeenLastCalledWith('/v1/orgs/{slug}/apps', {
    params: { path: { slug: 'acme-corp' } },
    body,
  });
  await createWorkspaceApp(null, body);
  expect(post).toHaveBeenLastCalledWith('/v1/apps', { body });
});

it('targets the personal workspace without reading the org list', () => {
  const get = spyApi('GET');
  const { result } = renderHook(() => useWorkspaceTarget(), wrapper());
  expect(result.current).toEqual({ org: null, label: 'Personal', ready: true });
  expect(get).not.toHaveBeenCalled();
});

it('names a selected shared workspace, and treats a personal slug as personal', async () => {
  spyApi('GET').mockResolvedValue({
    data: { orgs: [org('me', 'me', true), org('acme-corp', 'Acme Corp', false)] },
    response: new Response(),
  } as never);
  setActiveOrg('acme-corp');
  const { result } = renderHook(() => useWorkspaceTarget(), wrapper());
  // The choice is explicit before the list confirms it.
  expect(result.current).toEqual({ org: 'acme-corp', label: 'acme-corp', ready: true });
  await waitFor(() =>
    expect(result.current).toEqual({ org: 'acme-corp', label: 'Acme Corp', ready: true })
  );
  act(() => setActiveOrg('me'));
  expect(result.current).toEqual({ org: null, label: 'Personal', ready: true });
});

it('refreshes quota, the account app list, and the workspace inventory after creation', async () => {
  spyApi('POST').mockResolvedValue({
    data: { id: 'app' },
    response: new Response(null, { status: 201 }),
  } as never);
  const { client, wrapper: Wrapper } = wrapper();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useCreateWorkspaceApp(), { wrapper: Wrapper });
  await act(() => result.current.mutateAsync({ org: 'acme-corp', body }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['apps'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: orgAppsKey('acme-corp') });
});

it('words workspace refusals by code and leaves other errors as the API said', () => {
  const target = { org: 'acme-corp', label: 'Acme Corp' };
  const problem = (code: string) =>
    new ApiError({ status: 403, code, title: 'Forbidden', detail: 'Server prose' });
  expect(workspaceCreateError(problem('org_role_forbidden'), target)).toMatch(
    /^Your role in Acme Corp cannot create apps/
  );
  expect(workspaceCreateError(problem('forbidden'), target)).toBe('Server prose');
  expect(
    workspaceCreateError(problem('org_role_forbidden'), { org: null, label: 'Personal' })
  ).toBe('Server prose');
});
