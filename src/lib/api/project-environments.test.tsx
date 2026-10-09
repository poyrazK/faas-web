import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { useEnvironmentState, useEnvironmentDiff } from './projects';
afterEach(() => vi.restoreAllMocks());
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
it('separates target and comparison source, and sends the server comparison query', async () => {
  const get = vi.spyOn(api, 'GET').mockImplementation(async (_path, options) => {
    const params = (
      options as unknown as { params: { path: { environment: string }; query?: { from: string } } }
    ).params;
    return ok({
      project_slug: 'shop',
      to_environment: params.path.environment,
      from_environment: params.query?.from,
      workloads: [],
    });
  });
  const hook = renderHook(({ target, source }) => useEnvironmentDiff('a', 'shop', target, source), {
    wrapper: wrapper(),
    initialProps: { target: 'staging', source: 'production' },
  });
  await waitFor(() => expect(hook.result.current.data?.from_environment).toBe('production'));
  hook.rerender({ target: 'staging', source: 'testing' });
  await waitFor(() => expect(hook.result.current.data?.from_environment).toBe('testing'));
  expect(get).toHaveBeenLastCalledWith(
    '/v1/projects/{slug}/environments/{environment}/diff',
    expect.objectContaining({
      params: { path: { slug: 'shop', environment: 'staging' }, query: { from: 'testing' } },
    })
  );
});
it('ignores delayed state from the prior account and selected environment', async () => {
  let finish!: (value: never) => void;
  vi.spyOn(api, 'GET')
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue(ok({ project_slug: 'shop', environment: 'testing', workloads: [] }));
  const hook = renderHook(
    ({ account, environment }) => useEnvironmentState(account, 'shop', environment),
    { wrapper: wrapper(), initialProps: { account: 'old', environment: 'production' } }
  );
  hook.rerender({ account: 'new', environment: 'testing' });
  await waitFor(() => expect(hook.result.current.data?.environment).toBe('testing'));
  await act(async () =>
    finish(ok({ project_slug: 'shop', environment: 'production', workloads: [] }))
  );
  expect(hook.result.current.data?.environment).toBe('testing');
});
it('does not read reserved default, blank or invalid named scopes', () => {
  const get = vi.spyOn(api, 'GET');
  renderHook(
    () => {
      useEnvironmentState('a', 'shop', 'default');
      useEnvironmentState('a', 'shop', '');
      useEnvironmentDiff('a', 'shop', 'INVALID', 'production');
      useEnvironmentDiff('a', 'shop', 'production', 'production');
    },
    { wrapper: wrapper() }
  );
  expect(get).not.toHaveBeenCalled();
});
