import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { useReleaseTask } from './release-command';

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) }) as never;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
const DEP = 'a'.repeat(32);
const row = (kind: string, deployment_id: string) => ({
  id: `${kind}-${deployment_id}`,
  kind,
  deployment_id,
});

afterEach(() => vi.restoreAllMocks());

describe('useReleaseTask', () => {
  it('pages the app tasks until it finds the deployment’s release task', async () => {
    const get = spyApi('GET')
      .mockResolvedValueOnce(
        ok({ tasks: [row('release', 'b'.repeat(32)), row('manual', DEP)], next_offset: 200 })
      )
      .mockResolvedValueOnce(ok({ tasks: [row('release', DEP)], next_offset: -1 }));
    const { result } = renderHook(() => useReleaseTask('api', DEP), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      task: row('release', DEP),
      searched: 3,
      complete: true,
    });
    expect(get).toHaveBeenNthCalledWith(
      2,
      '/v1/apps/{slug}/tasks',
      expect.objectContaining({
        params: { path: { slug: 'api' }, query: { limit: 200, offset: 200 } },
      })
    );
  });

  it('reports an incomplete search instead of a missing task when the budget runs out', async () => {
    spyApi('GET').mockResolvedValue(ok({ tasks: [row('manual', DEP)], next_offset: 1 }));
    const { result } = renderHook(() => useReleaseTask('api', DEP), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ searched: 3, complete: false });
  });

  it('reads nothing until the command has been admitted', () => {
    const get = spyApi('GET');
    renderHook(() => useReleaseTask('api', DEP, { enabled: false }), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});
