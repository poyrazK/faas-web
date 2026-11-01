import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import {
  delayedTaskPollInterval,
  useDelayedTask,
  useDelayedTasks,
  type DelayedTask,
} from './queries';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const MIN = 60_000;
const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const task = (state: DelayedTask['state'], dueIn: number): DelayedTask => ({
  id: 'a'.repeat(32),
  state,
  scheduled_at: new Date(Date.now() + dueIn).toISOString(),
  created_at: new Date(Date.now() - 10 * MIN).toISOString(),
});

describe('delayedTaskPollInterval', () => {
  const at = (state: DelayedTask['state'], dueIn: number) => ({
    ...task(state, 0),
    scheduled_at: new Date(NOW + dueIn).toISOString(),
  });
  it.each([
    ['nothing loaded', [], false],
    ['only finished tasks', [at('completed', -MIN), at('cancelled', MIN)], false],
    ['a dispatching task', [at('dispatching', -MIN)], 5_000],
    ['a pending task due in 2 s (floor)', [at('pending', 2_000)], 5_000],
    ['a pending task due in 20 s (wake at due time)', [at('pending', 20_000)], 20_000],
    ['a pending task due in 5 min (ceiling)', [at('pending', 5 * MIN)], 60_000],
    ['a pending task a year out (ceiling)', [at('pending', 365 * 24 * 60 * MIN)], 60_000],
    ['a pending task just overdue', [at('pending', -30_000)], 5_000],
    ['a pending task long overdue (backs off)', [at('pending', -10 * MIN)], 60_000],
    [
      'long overdue beside one due in 10 s',
      [at('pending', -10 * MIN), at('pending', 10_000)],
      10_000,
    ],
  ] as const)('%s', (_name, tasks, expected) => {
    expect(delayedTaskPollInterval([...tasks], NOW)).toBe(expected);
  });
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('delayed-task polling under the real refetch loop', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const flush = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it('still re-reads the list for a task scheduled minutes ahead', async () => {
    const get = spyApi('GET').mockImplementation(() => ok({ tasks: [task('pending', 5 * MIN)] }));
    renderHook(() => useDelayedTasks('billing'), { wrapper: wrapper() });
    await flush(10);
    expect(get).toHaveBeenCalledTimes(1);
    await flush(59_000);
    expect(get).toHaveBeenCalledTimes(1);
    await flush(2_000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('backs off for a task long overdue instead of polling every 5 s', async () => {
    const get = spyApi('GET').mockImplementation(() => ok({ tasks: [task('pending', -10 * MIN)] }));
    renderHook(() => useDelayedTasks('billing'), { wrapper: wrapper() });
    await flush(10);
    await flush(30_000);
    expect(get).toHaveBeenCalledTimes(1);
    await flush(31_000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('polls the detail of a dispatching task', async () => {
    const get = spyApi('GET').mockImplementation(() => ok(task('dispatching', -MIN)));
    renderHook(() => useDelayedTask('a'.repeat(32), { poll: true }), { wrapper: wrapper() });
    await flush(10);
    expect(get).toHaveBeenCalledTimes(1);
    await flush(5_100);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not poll the detail of a far-off pending task every 5 s', async () => {
    const get = spyApi('GET').mockImplementation(() => ok(task('pending', 30 * 24 * 60 * MIN)));
    renderHook(() => useDelayedTask('a'.repeat(32), { poll: true }), { wrapper: wrapper() });
    await flush(10);
    await flush(30_000);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
