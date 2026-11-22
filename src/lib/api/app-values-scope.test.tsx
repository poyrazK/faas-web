import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import {
  keys,
  useAppEnv,
  useAppRoutes,
  useAppSecrets,
  useDeleteEnv,
  useRotateSecret,
  useSetEnv,
  useSetSecret,
} from './queries';
import { useRevokeSecret } from './secret-references';

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
afterEach(() => vi.restoreAllMocks());

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
const paramsOf = (spy: ReturnType<typeof spyApi>) =>
  (spy.mock.calls as unknown as [string, { params: unknown }][]).map(([path, init]) => [
    path,
    init.params,
  ]);

describe('env and secrets in production', () => {
  it('reads and writes with no scope, as before', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ env: [], secrets: [] }));
    const put = spyApi('PUT').mockResolvedValue(ok({}));
    const { wrapper: w } = wrapper();
    const env = renderHook(() => useAppEnv('api'), { wrapper: w });
    renderHook(() => useAppSecrets('api'), { wrapper: w });
    await waitFor(() => expect(env.result.current.isSuccess).toBe(true));
    const set = renderHook(() => useSetEnv('api'), { wrapper: w });
    await act(() => set.result.current.mutateAsync({ key: 'A', value: '1' }));
    expect(paramsOf(get)).toEqual(
      expect.arrayContaining([
        ['/v1/apps/{slug}/env', { path: { slug: 'api' } }],
        ['/v1/apps/{slug}/secrets', { path: { slug: 'api' } }],
      ])
    );
    expect(paramsOf(put)).toEqual([
      ['/v1/apps/{slug}/env/{key}', { path: { slug: 'api', key: 'A' } }],
    ]);
  });
});

describe('env and secrets in Staging', () => {
  it('reads and writes with scope=staging, rotate and delete included', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ env: [], secrets: [] }));
    const put = spyApi('PUT').mockResolvedValue(ok({}));
    const del = spyApi('DELETE').mockResolvedValue(ok(undefined));
    const post = spyApi('POST').mockResolvedValue(ok({}));
    const { wrapper: w } = wrapper();
    const env = renderHook(() => useAppEnv('api', 'staging'), { wrapper: w });
    const secrets = renderHook(() => useAppSecrets('api', 'staging'), { wrapper: w });
    await waitFor(() => expect(env.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(secrets.result.current.isSuccess).toBe(true));
    const setEnv = renderHook(() => useSetEnv('api', 'staging'), { wrapper: w });
    const delEnv = renderHook(() => useDeleteEnv('api', 'staging'), { wrapper: w });
    const setSecret = renderHook(() => useSetSecret('api', 'staging'), { wrapper: w });
    const rotate = renderHook(() => useRotateSecret('api', 'staging'), { wrapper: w });
    const revoke = renderHook(() => useRevokeSecret('api', 'staging'), { wrapper: w });
    await act(() => setEnv.result.current.mutateAsync({ key: 'A', value: '1' }));
    await act(() => delEnv.result.current.mutateAsync('A'));
    await act(() => setSecret.result.current.mutateAsync({ key: 'T', value: 's' }));
    await act(() => rotate.result.current.mutateAsync({ key: 'T', value: 's2' }));
    await act(() => revoke.result.current.mutateAsync('T'));
    const scoped = (path: Record<string, string>) => ({ path, query: { scope: 'staging' } });
    expect(paramsOf(get)).toEqual(
      expect.arrayContaining([
        ['/v1/apps/{slug}/env', scoped({ slug: 'api' })],
        ['/v1/apps/{slug}/secrets', scoped({ slug: 'api' })],
      ])
    );
    expect(paramsOf(put)).toEqual([
      ['/v1/apps/{slug}/env/{key}', scoped({ slug: 'api', key: 'A' })],
      ['/v1/apps/{slug}/secrets/{key}', scoped({ slug: 'api', key: 'T' })],
    ]);
    expect(paramsOf(del)).toEqual([
      ['/v1/apps/{slug}/env/{key}', scoped({ slug: 'api', key: 'A' })],
      ['/v1/apps/{slug}/secrets/{key}', scoped({ slug: 'api', key: 'T' })],
    ]);
    expect(paramsOf(post)).toEqual([
      ['/v1/apps/{slug}/secrets/{key}/rotate', scoped({ slug: 'api', key: 'T' })],
    ]);
  });

  it("leaves production's cached lists alone", async () => {
    spyApi('PUT').mockResolvedValue(ok({}));
    spyApi('DELETE').mockResolvedValue(ok(undefined));
    spyApi('GET').mockResolvedValue(ok({ env: [], secrets: [] }));
    const { client, wrapper: w } = wrapper();
    const production = { env: [{ key: 'A', value: 'prod', scope: '' }] };
    const productionSecrets = { secrets: [{ key: 'T' }] };
    client.setQueryData(keys.appEnv('api'), production);
    client.setQueryData(keys.appSecrets('api'), productionSecrets);
    const setEnv = renderHook(() => useSetEnv('api', 'staging'), { wrapper: w });
    const revoke = renderHook(() => useRevokeSecret('api', 'staging'), { wrapper: w });
    await act(() => setEnv.result.current.mutateAsync({ key: 'A', value: 'stage' }));
    await act(() => revoke.result.current.mutateAsync('T'));
    expect(client.getQueryData(keys.appEnv('api'))).toEqual(production);
    expect(client.getQueryData(keys.appSecrets('api'))).toEqual(productionSecrets);
    expect(client.getQueryState(keys.appEnv('api'))?.isInvalidated).toBe(false);
    expect(client.getQueryState(keys.appSecrets('api'))?.isInvalidated).toBe(false);
  });
});

describe('route traffic', () => {
  it('reads Staging with environment=staging, production as before, cached apart', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ routes: [], source: 'prometheus' }));
    const { client, wrapper: w } = wrapper();
    const production = renderHook(() => useAppRoutes('api'), { wrapper: w });
    const staging = renderHook(() => useAppRoutes('api', 'staging'), { wrapper: w });
    await waitFor(() => expect(production.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(staging.result.current.isSuccess).toBe(true));
    expect(paramsOf(get)).toEqual(
      expect.arrayContaining([
        ['/v1/apps/{slug}/routes', { path: { slug: 'api' } }],
        ['/v1/apps/{slug}/routes', { path: { slug: 'api' }, query: { environment: 'staging' } }],
      ])
    );
    expect(client.getQueryData(['apps', 'api', 'routes'])).toBeDefined();
    expect(client.getQueryData(['apps', 'api', 'routes', 'staging'])).toBeDefined();
  });
});
