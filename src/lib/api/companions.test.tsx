import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { readCompanionChoices, readCompanions, useCompanions } from './companions';

afterEach(() => vi.restoreAllMocks());

it.each([404, 501])(
  'does not cache an empty declaration when an older server returns HTTP %s',
  async (status) => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/v1/account') return { data: { id: 'a' }, response: new Response() } as never;
      if (path === '/v1/apps/{slug}')
        return { data: { id: 'app', slug: 'api' }, response: new Response() } as never;
      return {
        error: 'Not available',
        response: new Response('Not available', { status }),
      } as never;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useCompanions('a', 'api', 'dep'), { wrapper });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(hook.result.current.data).toBeUndefined();
    expect(
      get.mock.calls.filter(([path]) => path === '/v1/deployments/{id}/companions')
    ).toHaveLength(1);
  }
);
const helper = {
  name: 'metrics',
  type: 'sidecar',
  image: `registry.test/helper@sha256:${'a'.repeat(64)}`,
  ram_mb: 128,
  cpu_millicores: 0,
  scratch_mb: 0,
  port: 9090,
  primary_ingress: false,
  depends_on: [{ name: 'main', condition: 'started', token: 'never-retain' }],
  environment_keys: ['TOKEN'],
  env: { TOKEN: 'never-retain' },
  cmd: ['never-retain'],
  health: 'healthy',
};
const view = {
  account_id: 'a',
  app_id: 'app',
  app_slug: 'api',
  deployment_id: 'dep',
  scope: 'staging',
  state: 'available',
  companions: [helper],
  endpoint_url: 'never-retain',
};
function reads(metadata: unknown = view) {
  return vi.spyOn(api, 'GET').mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/account'
            ? { id: 'a' }
            : path === '/v1/apps/{slug}'
              ? { id: 'app', slug: 'api', env: { TOKEN: 'never-retain' } }
              : metadata,
        response: new Response(),
      }) as never
  );
}
it('retains only declared metadata in the exact account/app/deployment query cache', async () => {
  const get = reads();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCompanions('a', 'api', 'dep'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.scope).toBe('staging');
  const retained = JSON.stringify(
    client
      .getQueryCache()
      .getAll()
      .map((q) => q.state.data)
  );
  expect(retained).not.toMatch(/never-retain|healthy|endpoint_url/);
  expect(get).toHaveBeenCalledWith(
    '/v1/deployments/{id}/companions',
    expect.objectContaining({ params: { path: { id: 'dep' } }, signal: expect.any(AbortSignal) })
  );
});
it.each(['account_id', 'app_id', 'app_slug', 'deployment_id'])(
  'rejects a different %s before caching metadata',
  async (field) => {
    reads({ ...view, [field]: 'other' });
    await expect(readCompanions('a', 'api', 'dep')).rejects.toThrow(/identity|context/i);
  }
);
it('rejects an account change after a delayed read', async () => {
  let accounts = 0;
  vi.spyOn(api, 'GET').mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/account'
            ? { id: ++accounts > 1 ? 'other' : 'a' }
            : path === '/v1/apps/{slug}'
              ? { id: 'app', slug: 'api' }
              : view,
        response: new Response(),
      }) as never
  );
  await expect(readCompanions('a', 'api', 'dep')).rejects.toThrow(/context/i);
});
it('keeps unavailable metadata distinct from an available empty declaration', async () => {
  const get = reads({
    ...view,
    state: 'unavailable',
    reason: 'declaration_metadata_unavailable',
    companions: [],
  });
  expect((await readCompanions('a', 'api', 'dep')).state).toBe('unavailable');
  get.mockRestore();
  reads({ ...view, companions: [] });
  expect((await readCompanions('a', 'api', 'dep')).companions).toEqual([]);
});
it('preserves a digest-pinned image with the casing accepted by the backend contract', async () => {
  const image = `Registry.Example.test:5000/Custom_Helper@sha256:${'a'.repeat(64)}`;
  reads({ ...view, companions: [{ ...helper, image }] });
  expect((await readCompanions('a', 'api', 'dep')).companions[0].image).toBe(image);
});
it('reads bounded app-owned choices with the actual cursor and strips unexpected metadata', async () => {
  const get = reads({
    items: [
      {
        id: 'dep',
        app_id: 'app',
        status: 'active',
        created_at: '2026-10-12T00:00:00Z',
        env: { TOKEN: 'never-retain' },
        sidecars: [helper],
      },
    ],
    next_before: '2026-10-11T00:00:00Z',
  });
  const choices = await readCompanionChoices('a', 'api', '2026-10-12T00:00:00Z');
  expect(choices.nextBefore).toBe('2026-10-11T00:00:00Z');
  expect(JSON.stringify(choices)).not.toContain('never-retain');
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/deployments',
    expect.objectContaining({
      params: { path: { slug: 'api' }, query: { limit: 25, before: '2026-10-12T00:00:00Z' } },
    })
  );
});
it('rejects foreign deployment choices and cancellation', async () => {
  reads({
    items: [{ id: 'dep', app_id: 'other', status: 'active', created_at: '2026-10-12T00:00:00Z' }],
  });
  await expect(readCompanionChoices('a', 'api')).rejects.toThrow(/identity/i);
  const controller = new AbortController();
  controller.abort();
  await expect(readCompanions('a', 'api', 'dep', controller.signal)).rejects.toThrow();
});
it('rejects an object deployment ID before it can retain secret-bearing fields', async () => {
  reads({
    items: [
      {
        id: { env: { TOKEN: 'never-retain' }, cmd: ['never-retain'] },
        app_id: 'app',
        status: 'live',
        created_at: '2026-10-12T00:00:00Z',
      },
    ],
  });
  await expect(readCompanionChoices('a', 'api')).rejects.toThrow(/identity/i);
});
