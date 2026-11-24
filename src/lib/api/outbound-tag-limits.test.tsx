import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { useAITagLimits, useSetAITagLimits } from './outbound';

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
afterEach(() => vi.restoreAllMocks());

it('reads and replaces an AI integration’s per-tag daily cost limits', async () => {
  const limits = [{ tag: 'search', daily_cost_limit_millicents: 500_000 }];
  const get = spyApi('GET').mockResolvedValue(ok({ limits }));
  const put = spyApi('PUT').mockResolvedValue(ok({ limits: [] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const read = renderHook(() => useAITagLimits('acct', 'i1'), { wrapper });
  const write = renderHook(() => useSetAITagLimits('acct', 'i1'), { wrapper });
  await waitFor(() => expect(read.result.current.data).toEqual(limits));
  expect(get).toHaveBeenCalledWith(
    '/v1/outbound/integrations/{integration}/ai-tag-limits',
    expect.objectContaining({ params: { path: { integration: 'i1' } } })
  );
  await act(() => write.result.current.mutateAsync([]));
  expect(put).toHaveBeenCalledWith('/v1/outbound/integrations/{integration}/ai-tag-limits', {
    params: { path: { integration: 'i1' } },
    body: { limits: [] },
  });
  await waitFor(() => expect(read.result.current.data).toEqual([]));
});
