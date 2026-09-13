import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInfiniteJobs, useJobs, useJobRuns, useJobTasks, useCronRuns } from './queries';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./client')>();
  return { ...original, api: { GET: get } };
});
beforeEach(() => {
  get.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('Jobs deep links beyond the first API page', () => {
  it.each(['jobs', 'runs', 'tasks', 'executions'] as const)(
    'finds selected %s on an older page',
    async (kind) => {
      get.mockImplementation(
        async (
          _path: string,
          options: { params?: { query?: { offset?: number; before?: string } } }
        ) => {
          const later = Boolean(options.params?.query?.offset || options.params?.query?.before);
          const rows =
            kind === 'tasks'
              ? [{ task_index: later ? 75 : 0 }]
              : [{ id: later ? 'older' : 'newest' }];
          const key = kind === 'executions' ? 'runs' : kind;
          return {
            data: {
              [key]: rows,
              next_offset: later ? -1 : 50,
              limit: 50,
              offset: later ? 50 : 0,
              total: 2,
            },
            response: new Response(),
          };
        }
      );
      const hooks = {
        jobs: function useSelectedJobs() {
          return useJobs('older');
        },
        runs: function useSelectedRuns() {
          return useJobRuns('export', 'older');
        },
        tasks: function useSelectedTasks() {
          return useJobTasks('export', 'run-1', 75);
        },
        executions: function useSelectedExecutions() {
          return useCronRuns('schedule-1', 'older');
        },
      };
      const useSelected = hooks[kind];
      const { result } = renderHook(() => useSelected(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const rows = (result.current.data as Record<string, unknown>)[
        kind === 'executions' ? 'runs' : kind
      ];
      expect(rows).toContainEqual(kind === 'tasks' ? { task_index: 75 } : { id: 'older' });
    }
  );

  it('loads older workload pages from the server offset cursor', async () => {
    get.mockImplementation(
      async (
        _path: string,
        options: { params?: { query?: { offset?: number; limit?: number } } }
      ) => {
        const offset = options.params?.query?.offset ?? 0;
        return {
          data: {
            jobs: [{ id: offset === 0 ? 'newest' : 'older' }],
            limit: 50,
            offset,
            next_offset: offset === 0 ? 50 : -1,
            total: 2,
          },
          response: new Response(),
        };
      }
    );
    const { result } = renderHook(() => useInfiniteJobs(), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    expect(get).toHaveBeenNthCalledWith(1, '/v1/jobs', {
      params: { query: { limit: 50, offset: 0 } },
    });
    expect(get).toHaveBeenNthCalledWith(2, '/v1/jobs', {
      params: { query: { limit: 50, offset: 50 } },
    });
    expect(result.current.data?.pages.flatMap((page) => page.jobs)).toEqual([
      { id: 'newest' },
      { id: 'older' },
    ]);
  });

  it('stops when an unknown execution exhausts cursor history', async () => {
    get.mockImplementation(
      async (_path: string, options: { params?: { query?: { before?: string } } }) => {
        const before = options.params?.query?.before;
        return { data: { runs: before ? [] : [{ id: 'newest' }] }, response: new Response() };
      }
    );
    const { result } = renderHook(() => useCronRuns('schedule-1', 'missing'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.runs).toEqual([{ id: 'newest' }]);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
