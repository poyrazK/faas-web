import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const del = vi.fn();
const post = vi.fn();

vi.mock('./client', () => ({
  api: { DELETE: del, POST: post },
  unwrap: (value: unknown) => value,
}));

const { useDeleteJob, useStartJobRun } = await import('./queries');

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  // The lists, plus two jobs' own detail and run caches.
  client.setQueryData(['jobs'], { jobs: [] });
  client.setQueryData(['jobs', 'history', 50], { pages: [] });
  client.setQueryData(['jobs', 'old-job'], { name: 'old-job' });
  client.setQueryData(['jobs', 'old-job', 'runs'], { runs: [] });
  client.setQueryData(['jobs', 'other-job'], { name: 'other-job' });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  del.mockReset().mockResolvedValue({});
  post.mockReset().mockResolvedValue({ id: 'run-1', tasks: 4, aggregate_status: 'queued' });
});

describe('job run and delete mutations', () => {
  it('starts a run through POST /v1/jobs/{name}/runs with the task count and idempotency key', async () => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useStartJobRun(), { wrapper });
    const run = await result.current.mutateAsync({
      name: 'old-job',
      tasks: 4,
      idempotencyKey: 'key-1',
    });
    expect(run).toMatchObject({ id: 'run-1', aggregate_status: 'queued' });
    expect(post).toHaveBeenCalledWith('/v1/jobs/{name}/runs', {
      params: { path: { name: 'old-job' }, header: { 'Idempotency-Key': 'key-1' } },
      body: { tasks: 4 },
    });
    // The list the run view reads is stale, so the new run will be fetched.
    expect(client.getQueryState(['jobs', 'old-job', 'runs'])?.isInvalidated).toBe(true);
  });

  it('deletes through DELETE /v1/jobs/{name}, refreshing lists and dropping only that job', async () => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useDeleteJob(), { wrapper });
    await result.current.mutateAsync('old-job');
    expect(del).toHaveBeenCalledWith('/v1/jobs/{name}', { params: { path: { name: 'old-job' } } });
    expect(client.getQueryState(['jobs'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['jobs', 'history', 50])?.isInvalidated).toBe(true);
    expect(client.getQueryData(['jobs', 'old-job'])).toBeUndefined();
    expect(client.getQueryData(['jobs', 'old-job', 'runs'])).toBeUndefined();
    expect(client.getQueryData(['jobs', 'other-job'])).toEqual({ name: 'other-job' });
  });

  it('leaves the cache alone when the delete is refused', async () => {
    del.mockRejectedValue(new Error('409'));
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useDeleteJob(), { wrapper });
    await expect(result.current.mutateAsync('old-job')).rejects.toThrow('409');
    expect(client.getQueryData(['jobs', 'old-job'])).toEqual({ name: 'old-job' });
    expect(client.getQueryState(['jobs'])?.isInvalidated).toBe(false);
  });
});
