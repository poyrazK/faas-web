import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRestoreApp } from './queries';
import { spyApi } from '@/test/api';

const appId = '00000000-0000-4000-8000-000000000001';
afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 2, retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it('restores by slug and keeps nothing secret from the response', async () => {
  const post = spyApi('POST').mockResolvedValue({
    data: { id: appId, slug: 'app-a', status: 'undeployed', signing_secret: 'must-not-retain' },
    response: new Response(),
  } as never);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useRestoreApp(), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync('app-a');
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(post).toHaveBeenCalledWith(
    '/v1/apps/{slug}/restore',
    expect.objectContaining({ params: { path: { slug: 'app-a' } } })
  );
  expect(
    JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state)
    )
  ).not.toContain('must-not-retain');
});
