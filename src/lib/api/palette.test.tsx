import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { resourceId, usePaletteKey, usePaletteResources } from './palette';

const id = 'a'.repeat(32);
const deployment = { id, app_id: 'app1', status: 'failed', image_digest: 'sha256:abc' };
const invocation = {
  id,
  app_id: 'app1',
  state: 'failed',
  payload: { token: 'SECRET_PAYLOAD' },
  headers: { authorization: 'SECRET_HEADER' },
  result: { token: 'SECRET_RESULT' },
};
let client: QueryClient;
let get: ReturnType<typeof vi.spyOn>;
const fixture: Record<string, unknown> = {
  '/v1/apps': [{ id: 'app1', slug: 'api' }],
  '/v1/deployments': { items: [deployment], next_before: 'older' },
  '/v1/domains': [
    {
      domain: 'api.example.com',
      app_id: 'app1',
      verified: true,
      challenge_token: 'SECRET_CHALLENGE',
    },
  ],
  '/v1/keys': [
    {
      id: 'a'.repeat(32),
      label: 'deploy-bot',
      scopes: ['deploy:write'],
      prefix: 'SECRET_PREFIX',
      key_plaintext: 'SECRET_PLAINTEXT',
    },
  ],
  '/v1/invocations': { invocations: [invocation] },
  '/v1/deployments/{id}': deployment,
  '/v1/invocations/{id}': invocation,
};
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  get = vi
    .spyOn(api, 'GET')
    .mockImplementation(
      async (path) => ({ data: fixture[path], response: new Response() }) as never
    );
});
afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

describe('palette resource reads', () => {
  it('does not fetch until an authenticated palette has a nonempty query', async () => {
    const { rerender, result } = renderHook(
      ({ account, open, query }) => usePaletteResources(account, open, query),
      {
        wrapper,
        initialProps: { account: undefined as string | undefined, open: true, query: 'api' },
      }
    );
    expect(get).not.toHaveBeenCalled();
    rerender({ account: 'account1', open: false, query: 'api' });
    expect(get).not.toHaveBeenCalled();
    rerender({ account: 'account1', open: true, query: ' ' });
    expect(get).not.toHaveBeenCalled();
    rerender({ account: 'account1', open: true, query: 'api' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(get).toHaveBeenCalledTimes(5);
  });

  it('caches only allowed metadata, never credentials, invocation input, or results', async () => {
    const { result } = renderHook(() => usePaletteResources('account1', true, 'api'), { wrapper });
    await waitFor(() => expect(result.current.keys).toHaveLength(1));
    expect(result.current.appName('app1')).toBe('api');
    expect(result.current.domains[0].hostname).toBe('api.example.com');
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data)
      )
    ).not.toContain('SECRET_');
  });

  it('can load older deployments using the server cursor', async () => {
    get.mockImplementation(
      async (path: string, options: { params?: { query?: { before?: string } } }) => ({
        data:
          path === '/v1/deployments' && options.params?.query?.before
            ? { items: [{ ...deployment, id: 'older-deployment' }], next_before: null }
            : fixture[path],
        response: new Response(),
      })
    );
    const { result } = renderHook(() => usePaletteResources('account1', true, 'deployment'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.moreDeployments).toBe(true));
    act(() => result.current.loadDeployments());
    await waitFor(() => expect(result.current.deployments).toHaveLength(2));
    expect(result.current.moreDeployments).toBe(false);
    expect(get).toHaveBeenCalledWith(
      '/v1/deployments',
      expect.objectContaining({ params: { query: { limit: 100, before: 'older' } } })
    );
  });

  it('looks up exact IDs outside loaded history and deduplicates matching rows', async () => {
    const { result } = renderHook(() => usePaletteResources('account1', true, id), { wrapper });
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/v1/invocations/{id}',
        expect.objectContaining({ params: { path: { id } } })
      )
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.invocations).toHaveLength(1);
    expect(result.current.deployments).toHaveLength(1);
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data)
      )
    ).not.toContain('SECRET_');
  });

  it('does not surface a denied collection or report missing exact IDs as errors', async () => {
    get.mockImplementation(async (path: string) =>
      path === '/v1/keys' || path.endsWith('/{id}')
        ? {
            error: { title: 'Unavailable' },
            response: new Response(null, { status: path === '/v1/keys' ? 403 : 404 }),
          }
        : { data: fixture[path], response: new Response() }
    );
    const { result } = renderHook(() => usePaletteResources('account1', true, id), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(7));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.keys).toEqual([]);
    expect(result.current.errors).toHaveLength(1);
  });

  it('hides the prior account data immediately when account changes or palette closes', async () => {
    const { result, rerender } = renderHook(
      ({ account, open }) => usePaletteResources(account, open, 'api'),
      { wrapper, initialProps: { account: 'old', open: true } }
    );
    await waitFor(() => expect(result.current.keys).toHaveLength(1));
    get.mockImplementation(() => new Promise(() => {}));
    rerender({ account: 'new', open: true });
    expect(result.current.keys).toEqual([]);
    expect(result.current.deployments).toEqual([]);
    rerender({ account: 'new', open: false });
    expect(result.current.invocations).toEqual([]);
    expect(result.current.errors).toEqual([]);
  });

  it('validates full resource IDs without permitting arbitrary paths', () => {
    expect(resourceId(id)).toBe(id);
    expect(resourceId('01234567-89ab-cdef-0123-456789abcdef')).toBeDefined();
    for (const invalid of ['../keys', 'not-an-id', '', id + '?token=secret', ['a']])
      expect(resourceId(invalid)).toBeUndefined();
  });
  it('keeps key detail metadata separate from one-time credentials and account caches', async () => {
    const { result, rerender } = renderHook(
      ({ account }) => usePaletteKey(account, 'a'.repeat(32)),
      { wrapper, initialProps: { account: 'old' } }
    );
    await waitFor(() => expect(result.current.data?.label).toBe('deploy-bot'));
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data)
      )
    ).not.toContain('SECRET_');
    get.mockImplementation(() => new Promise(() => {}));
    rerender({ account: 'new' });
    expect(result.current.data).toBeUndefined();
  });
});
