import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const patch = vi.fn();
const del = vi.fn();
const post = vi.fn();

vi.mock('./client', () => ({
  api: { PATCH: patch, DELETE: del, POST: post },
  unwrap: (value: unknown) => value,
}));

const { keys, useDeleteTrigger, useSetTriggerEnabled, useUpdateTrigger } =
  await import('./queries');

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, wrapper };
}

beforeEach(() => {
  patch.mockReset().mockResolvedValue({ id: 't1' });
  del.mockReset().mockResolvedValue({});
  post.mockReset().mockResolvedValue({ id: 't1' });
});

describe('trigger mutation queries', () => {
  it('updates through PATCH and invalidates list plus trigger family', async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateTrigger(), { wrapper });
    await result.current.mutateAsync({ id: 't1', body: { max_attempts: 4 } });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(patch).toHaveBeenCalledWith('/v1/triggers/{id}', {
      params: { path: { id: 't1' } },
      body: { max_attempts: 4 },
    });
    expect(keys.trigger('t1')).toEqual(['triggers', 't1']);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['triggers'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['triggers', 't1'] });
  });

  it('invalidates the affected trigger after delete and pause', async () => {
    const first = setup();
    const deleted = renderHook(() => useDeleteTrigger(), { wrapper: first.wrapper });
    await deleted.result.current.mutateAsync('t1');
    await waitFor(() => expect(first.invalidate).toHaveBeenCalledTimes(2));

    const second = setup();
    const enabled = renderHook(() => useSetTriggerEnabled(), { wrapper: second.wrapper });
    await enabled.result.current.mutateAsync({ id: 't1', enabled: false });
    await waitFor(() => expect(second.invalidate).toHaveBeenCalledTimes(2));
    expect(second.invalidate).toHaveBeenCalledWith({ queryKey: ['triggers', 't1'] });
  });
});
