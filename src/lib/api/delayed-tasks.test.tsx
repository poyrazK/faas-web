import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { useCancelDelayedTask, useDelayedTasks, useScheduleDelayedTask } from './queries';

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);

function task(id: string, state = 'pending') {
  return {
    id,
    scheduled_at: '2026-11-01T09:00:00Z',
    state,
    method: 'POST',
    path: '/send-reminder',
    created_at: '2026-10-31T09:00:00Z',
  };
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('useDelayedTasks', () => {
  it("pages an app's delayed tasks newest-first with the API's next_before cursor", async () => {
    const get = spyApi('GET')
      .mockImplementationOnce(() => ok({ tasks: [task(A), task(B)], next_before: B }))
      .mockImplementationOnce(() => ok({ tasks: [task(C)] }));
    const { result } = renderHook(() => useDelayedTasks('billing', 2), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/delayed-tasks', {
      params: { path: { slug: 'billing' }, query: { limit: 2 } },
    });
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(get).toHaveBeenLastCalledWith('/v1/apps/{slug}/delayed-tasks', {
      params: { path: { slug: 'billing' }, query: { limit: 2, before: B } },
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(result.current.data?.pages.flatMap((p) => p.tasks).map((t) => t.id)).toEqual([A, B, C]);
  });

  it('does not read without an app', () => {
    const get = spyApi('GET');
    renderHook(() => useDelayedTasks(''), { wrapper: wrapper() });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('delayed-task writes refresh the list', () => {
  it('re-reads the list after a cancel, so the row shows the state the API returned', async () => {
    const get = spyApi('GET').mockImplementation(() => ok({ tasks: [task(A)] }));
    spyApi('DELETE').mockImplementation(() => ok(task(A, 'cancelled')));
    const { result } = renderHook(
      () => ({ list: useDelayedTasks('billing'), cancel: useCancelDelayedTask() }),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const before = get.mock.calls.length;
    await act(async () => {
      await result.current.cancel.mutateAsync(A);
    });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
  });

  it('re-reads the list after scheduling a task', async () => {
    const get = spyApi('GET').mockImplementation(() => ok({ tasks: [] }));
    spyApi('POST').mockImplementation(() => ok(task(C)));
    const { result } = renderHook(
      () => ({ list: useDelayedTasks('billing'), schedule: useScheduleDelayedTask('billing') }),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const before = get.mock.calls.length;
    await act(async () => {
      await result.current.schedule.mutateAsync({
        scheduledAt: '2026-11-01T09:00:00Z',
        payload: {},
      });
    });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
  });
});
