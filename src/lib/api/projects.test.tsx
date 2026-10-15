import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { ApiError } from './errors';
import { useProjects, useProject } from './projects';
afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
it('does not read before account or project identity resolves', () => {
  const get = vi.spyOn(api, 'GET');
  const wrapper = setup();
  renderHook(
    () => {
      useProjects('');
      useProject('a', '');
    },
    { wrapper }
  );
  expect(get).not.toHaveBeenCalled();
});
it('ignores a delayed prior account response', async () => {
  let finish!: (value: never) => void;
  vi.spyOn(api, 'GET')
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue(ok([{ slug: 'new-project' }]));
  const hook = renderHook(({ account }) => useProjects(account), {
    wrapper: setup(),
    initialProps: { account: 'old' },
  });
  hook.rerender({ account: 'new' });
  await waitFor(() => expect(hook.result.current.data?.[0]?.slug).toBe('new-project'));
  await act(async () => finish(ok([{ slug: 'old-project' }])));
  expect(hook.result.current.data?.[0]?.slug).toBe('new-project');
});
it.each([403, 404])('does not automatically retry a settled %s project read', async (status) => {
  const get = vi
    .spyOn(api, 'GET')
    .mockRejectedValue(new ApiError({ status, code: 'not_found', title: 'Unavailable' }));
  const hook = renderHook(() => useProject('a', 'api'), { wrapper: setup() });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(get).toHaveBeenCalledTimes(1);
});
