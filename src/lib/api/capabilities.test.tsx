import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { ApiError } from './errors';
import { useCapabilities } from './capabilities';

afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
const reply = (plan = 'scale') =>
  ({ data: { registry_version: 1, plan, capabilities: [] }, response: new Response() }) as never;
it('never reads without verified account identity', () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue(reply());
  const { wrapper } = setup();
  const hook = renderHook(() => useCapabilities(''), { wrapper });
  expect(hook.result.current.fetchStatus).toBe('idle');
  expect(get).not.toHaveBeenCalled();
});
it('keeps delayed account reads isolated', async () => {
  let finish!: (value: never) => void;
  vi.spyOn(api, 'GET')
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue(reply('free'));
  const { client, wrapper } = setup();
  const hook = renderHook(({ account }) => useCapabilities(account), {
    wrapper,
    initialProps: { account: 'old' },
  });
  hook.rerender({ account: 'new' });
  await waitFor(() => expect(hook.result.current.data?.plan).toBe('free'));
  await act(async () => finish(reply('scale')));
  expect(hook.result.current.data?.plan).toBe('free');
  expect(client.getQueryData(['account', 'new', 'capabilities'])).toMatchObject({ plan: 'free' });
});
it('exposes a refetch failure even with retained registry data', async () => {
  vi.spyOn(api, 'GET')
    .mockResolvedValueOnce(reply())
    .mockRejectedValue(new ApiError({ status: 401, code: 'unauthorized', title: 'Sign in' }));
  const { wrapper } = setup();
  const hook = renderHook(() => useCapabilities('account'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(async () => {
    await hook.result.current.refetch();
  });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
});
it.each([429, 503])('retries a temporary %s failure through the shared policy', async (status) => {
  const get = vi
    .spyOn(api, 'GET')
    .mockRejectedValueOnce(new ApiError({ status, code: 'unavailable', title: 'Try again' }))
    .mockResolvedValue(reply());
  const { wrapper } = setup();
  const hook = renderHook(() => useCapabilities('account'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(get).toHaveBeenCalledTimes(2);
});
