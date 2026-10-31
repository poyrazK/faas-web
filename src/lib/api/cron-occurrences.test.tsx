import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { spyApi } from '@/test/api';
import { useCancelCronRun, useCronOccurrences } from './cron-occurrences';

const CRON = '0123456789abcdef0123456789abcdef';
const RUN = '11111111-2222-4333-8444-555555555555';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function occurrence(id: string, status = 'succeeded') {
  return {
    id,
    schedule_revision: 1,
    scheduled_for: '2026-10-30T02:00:00Z',
    schedule_policy: {},
    status,
    created_at: '2026-10-30T02:00:00Z',
  };
}

afterEach(() => {
  // spyOn restores between files; reset here so call history stays per-test.
  for (const method of ['GET', 'POST'] as const) spyApi(method).mockRestore();
});

describe('useCronOccurrences', () => {
  it('reads the newest page, then pages older with next_before', async () => {
    const get = spyApi('GET').mockImplementation(async (_path, init) => {
      const before = (init as { params: { query: { before?: string } } }).params.query.before;
      const data = before
        ? { occurrences: [occurrence('occ-old')], limit: 50, before }
        : { occurrences: [occurrence('occ-new')], limit: 50, next_before: 'occ-new' };
      return { data, response: new Response() };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useCronOccurrences(CRON), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/v1/crons/{id}/occurrences', {
      params: { path: { id: CRON }, query: { limit: 50 } },
      signal: expect.any(AbortSignal),
    });
    expect(view.result.current.hasNextPage).toBe(true);
    await act(() => view.result.current.fetchNextPage());
    expect(get).toHaveBeenLastCalledWith('/v1/crons/{id}/occurrences', {
      params: { path: { id: CRON }, query: { limit: 50, before: 'occ-new' } },
      signal: expect.any(AbortSignal),
    });
    await waitFor(() =>
      expect(
        view.result.current.data?.pages.flatMap((p) => p.occurrences.map((o) => o.id))
      ).toEqual(['occ-new', 'occ-old'])
    );
    expect(view.result.current.hasNextPage).toBe(false);
    client.clear();
  });
});

describe('useCancelCronRun', () => {
  it('posts to the run cancel path and refreshes that cron’s runs and occurrences', async () => {
    const post = spyApi('POST').mockResolvedValue({
      data: { id: RUN, status: 'cancelled' },
      response: new Response(null, { status: 202 }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['crons', CRON, 'runs'], { runs: [] });
    client.setQueryData(['crons', CRON, 'occurrences'], { pages: [], pageParams: [] });
    client.setQueryData(['crons', 'other', 'runs'], { runs: [] });
    const view = renderHook(() => useCancelCronRun(), { wrapper: wrapper(client) });
    let task: unknown;
    await act(async () => {
      task = await view.result.current.mutateAsync({ cronId: CRON, runId: RUN });
    });
    expect(post).toHaveBeenCalledWith('/v1/crons/{id}/runs/{run_id}/cancel', {
      params: { path: { id: CRON, run_id: RUN } },
    });
    expect(task).toEqual({ id: RUN, status: 'cancelled' });
    expect(client.getQueryState(['crons', CRON, 'runs'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['crons', CRON, 'occurrences'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['crons', 'other', 'runs'])?.isInvalidated).toBe(false);
    client.clear();
  });
});
