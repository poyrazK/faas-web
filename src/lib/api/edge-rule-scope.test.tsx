import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({
  api: { GET: get },
  unwrap: async (result: Promise<{ data: unknown }>) => (await result).data,
}));

import { useAppEdgeRules, useApps, useEdgeRules } from './queries';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => get.mockReset());

it('reloads account rule inventory on account change without retaining the old account response', async () => {
  get.mockResolvedValueOnce({ data: [{ id: 'a-rule', account_id: 'a' }] });
  get.mockResolvedValueOnce({ data: [{ id: 'b-rule', account_id: 'b' }] });
  const { result, rerender } = renderHook(({ accountId }) => useEdgeRules(true, accountId), {
    initialProps: { accountId: 'a' },
    wrapper: makeWrapper(),
  });
  await waitFor(() => expect(result.current.data?.[0]?.id).toBe('a-rule'));
  rerender({ accountId: 'b' });
  await waitFor(() => expect(result.current.data?.[0]?.id).toBe('b-rule'));
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
});

it('reloads app rule inventory for the same slug in a different account', async () => {
  get.mockResolvedValueOnce({ data: [{ id: 'a-rule', account_id: 'a' }] });
  get.mockResolvedValueOnce({ data: [{ id: 'b-rule', account_id: 'b' }] });
  const { result, rerender } = renderHook(({ accountId }) => useAppEdgeRules('api', accountId), {
    initialProps: { accountId: 'a' },
    wrapper: makeWrapper(),
  });
  await waitFor(() => expect(result.current.data?.[0]?.id).toBe('a-rule'));
  rerender({ accountId: 'b' });
  await waitFor(() => expect(result.current.data?.[0]?.id).toBe('b-rule'));
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
});

it('reloads the app selector under the new account identity', async () => {
  get.mockResolvedValueOnce({ data: [{ id: 'a-app', slug: 'api' }] });
  get.mockResolvedValueOnce({ data: [{ id: 'b-app', slug: 'api' }] });
  const { result, rerender } = renderHook(({ accountId }) => useApps(undefined, accountId), {
    initialProps: { accountId: 'a' },
    wrapper: makeWrapper(),
  });
  await waitFor(() => expect(result.current.data?.[0]?.id).toBe('a-app'));
  rerender({ accountId: 'b' });
  await waitFor(() => expect(result.current.data?.[0]?.id).toBe('b-app'));
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
});
