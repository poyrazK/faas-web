import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { useCancelDeployment, useRetryDeployment } from './queries';
const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 3, retryDelay: 0 } } });
  for (const key of [
    ['deployments'],
    ['deployments', 'failed-id'],
    ['apps', 'alpha'],
    ['apps', 'alpha', 'deployments'],
  ])
    client.setQueryData(key, { marker: true });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};
afterEach(() => vi.restoreAllMocks());
describe('deployment recovery mutations', () => {
  it('cancels the exact app/id and invalidates app history as well as global detail', async () => {
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValue({ data: { status: 'cancelled' }, response: new Response() } as never);
    const { client, wrapper } = setup();
    const hook = renderHook(() => useCancelDeployment(), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync({ slug: 'alpha', id: 'failed-id' });
    });
    expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/deployments/{id}/cancel', {
      params: { path: { slug: 'alpha', id: 'failed-id' } },
    });
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.state.isInvalidated)
    ).toBe(true);
  });
  it('posts only the original release ID and requested stage, without recreating configuration', async () => {
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValue({
        data: { id: 'new-id' },
        response: new Response(null, { status: 202 }),
      } as never);
    const { client, wrapper } = setup();
    const hook = renderHook(() => useRetryDeployment(), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync({ id: 'failed-id', from_stage: 'source_download' });
    });
    expect(post).toHaveBeenCalledWith('/v1/deployments/{id}/retry', {
      params: { path: { id: 'failed-id' } },
      body: { from_stage: 'source_download' },
    });
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.state.isInvalidated)
    ).toBe(true);
  });
  it.each(['cancel', 'retry'])(
    'does not automatically replay %s on a dropped response and refreshes stale evidence',
    async (action) => {
      const post = vi
        .spyOn(api, 'POST')
        .mockRejectedValue(new TypeError('Network connection lost'));
      const { client, wrapper } = setup();
      const hook = renderHook(
        () => (action === 'cancel' ? useCancelDeployment() : useRetryDeployment()),
        { wrapper }
      );
      await act(async () => {
        await expect(
          hook.result.current.mutateAsync({
            slug: 'alpha',
            id: 'failed-id',
            from_stage: 'source_download',
          })
        ).rejects.toThrow();
      });
      await waitFor(() => expect(hook.result.current.isError).toBe(true));
      expect(post).toHaveBeenCalledOnce();
      expect(
        client
          .getQueryCache()
          .getAll()
          .every((query) => query.state.isInvalidated)
      ).toBe(true);
    }
  );
});
