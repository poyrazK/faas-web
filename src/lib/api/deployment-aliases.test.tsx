import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALIAS_NAME_MAX,
  aliasNameProblem,
  aliasServing,
  aliasTargetable,
  useDeleteDeploymentAlias,
  useDeploymentAliases,
  useSetDeploymentAlias,
} from './deployment-aliases';
import { spyApi } from '@/test/api';

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const alias = {
  name: 'canary',
  deployment_id: 'd2',
  revision: 2,
  deployment_status: 'live',
  host: 'tag-canary-0123456789abcdef0123456789abcdef.gregale.app',
  url: 'https://tag-canary-0123456789abcdef0123456789abcdef.gregale.app',
  created_at: '2026-10-30T10:00:00Z',
  updated_at: '2026-10-30T10:00:00Z',
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('aliasNameProblem', () => {
  it('accepts a lowercase DNS label short enough to share the host label', () => {
    expect(aliasNameProblem('canary')).toBeNull();
    expect(aliasNameProblem('v2-hotfix')).toBeNull();
    expect(aliasNameProblem('a'.repeat(ALIAS_NAME_MAX))).toBeNull();
  });

  it('refuses what apid refuses, before the round trip', () => {
    expect(aliasNameProblem('')).toMatch(/name/i);
    expect(aliasNameProblem('Canary')).toMatch(/lowercase/i);
    expect(aliasNameProblem('-canary')).toMatch(/start and end/i);
    expect(aliasNameProblem('canary-')).toMatch(/start and end/i);
    expect(aliasNameProblem('can_ary')).toMatch(/lowercase/i);
  });

  it('caps the name at 26: tag-, the name, a hyphen and the 32-hex app id fit 63', () => {
    expect(ALIAS_NAME_MAX).toBe(63 - 'tag-'.length - 1 - 32);
    expect(aliasNameProblem('a'.repeat(ALIAS_NAME_MAX + 1))).toMatch(/26 characters/);
  });
});

describe('alias states', () => {
  it('takes a target only while the deployment is live or on its way', () => {
    for (const s of ['pending', 'building', 'imaging', 'snapshotting', 'live'])
      expect(aliasTargetable(s)).toBe(true);
    for (const s of ['superseded', 'failed', 'cancelled', undefined])
      expect(aliasTargetable(s)).toBe(false);
  });

  it('serves only a live deployment; the gateway answers 409 for anything else', () => {
    expect(aliasServing({ deployment_status: 'live' })).toBe('serving');
    expect(aliasServing({ deployment_status: 'building' })).toBe('waiting');
    expect(aliasServing({ deployment_status: 'superseded' })).toBe('stopped');
    expect(aliasServing({ deployment_status: 'failed' })).toBe('stopped');
    expect(aliasServing({})).toBe('unknown');
  });
});

describe('hooks', () => {
  it('lists the app’s aliases', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ items: [alias] }));
    const hook = renderHook(() => useDeploymentAliases('api'), { wrapper: wrapper() });
    await waitFor(() => expect(hook.result.current.data).toEqual([alias]));
    expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/deployment-aliases', {
      params: { path: { slug: 'api' } },
      signal: expect.any(AbortSignal),
    });
  });

  it('does not read without an app', () => {
    const get = spyApi('GET');
    renderHook(() => useDeploymentAliases(''), { wrapper: wrapper() });
    expect(get).not.toHaveBeenCalled();
  });

  it('points a name at a deployment and rereads the list', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ items: [] }));
    const put = spyApi('PUT').mockResolvedValue(ok(alias));
    const w = wrapper();
    renderHook(() => useDeploymentAliases('api'), { wrapper: w });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const hook = renderHook(() => useSetDeploymentAlias('api'), { wrapper: w });
    await hook.result.current.mutateAsync({ name: 'canary', deploymentId: 'd2' });
    expect(put).toHaveBeenCalledWith('/v1/apps/{slug}/deployment-aliases/{name}', {
      params: { path: { slug: 'api', name: 'canary' } },
      body: { deployment_id: 'd2' },
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('removes a name and rereads the list', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ items: [alias] }));
    const del = spyApi('DELETE').mockResolvedValue(ok(undefined));
    const w = wrapper();
    renderHook(() => useDeploymentAliases('api'), { wrapper: w });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const hook = renderHook(() => useDeleteDeploymentAlias('api'), { wrapper: w });
    await hook.result.current.mutateAsync('canary');
    expect(del).toHaveBeenCalledWith('/v1/apps/{slug}/deployment-aliases/{name}', {
      params: { path: { slug: 'api', name: 'canary' } },
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
