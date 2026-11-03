import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { ApiError } from './errors';
import {
  useBudgetRevisions,
  useBudgets,
  useCreateBudget,
  useDeleteBudget,
  useOperationKey,
  useSetBudgetChannels,
  useUpdateBudget,
} from './budgets';
import type { BudgetSpec } from '../budgets';

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const SPEC: BudgetSpec = {
  name: 'Monthly compute',
  scope: { kind: 'account' },
  currency: 'USD',
  meters: ['compute'],
  basis: 'net_usage',
  limit_millicents: 1_000_000,
  notify_millicents: [],
  mode: 'monitored',
  action: 'notify',
  drain_seconds: 0,
  resume_rule: 'next_period',
  enabled: true,
};
const BUDGET = {
  id: '11111111-1111-4111-8111-111111111111',
  account_id: 'acct',
  revision: 3,
  spec: SPEC,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
  status: 'active',
  enforcement_ready: false,
  reasons: [],
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('useOperationKey', () => {
  it('keeps one key per request until the server answers it', () => {
    const { result } = renderHook(() => useOperationKey());
    const first = result.current.keyFor('a');
    expect(result.current.keyFor('a')).toBe(first);
    // A dropped connection leaves the outcome unknown: the retry replays.
    result.current.settle(new TypeError('Failed to fetch'));
    expect(result.current.keyFor('a')).toBe(first);
    // A changed request is a new operation; apid binds a key to its request.
    const second = result.current.keyFor('b');
    expect(second).not.toBe(first);
    // An answer, success or refusal, ends the operation: a 422 that can clear
    // must not be replayed from apid's cache on the next attempt.
    result.current.settle(
      new ApiError({ status: 422, code: 'financial_compute_not_ready', title: 'x' })
    );
    expect(result.current.keyFor('b')).not.toBe(second);
    const third = result.current.keyFor('b');
    result.current.settle();
    expect(result.current.keyFor('b')).not.toBe(third);
  });
});

describe('budget reads', () => {
  it('lists the account budgets only when enabled', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ budgets: [BUDGET] }));
    const off = renderHook(() => useBudgets('acct', false), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
    const on = renderHook(() => useBudgets('acct', true), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.data).toEqual([BUDGET]));
    expect(get).toHaveBeenCalledWith('/v1/billing/budgets', expect.anything());
  });

  it('pages revisions by next_revision', async () => {
    const get = spyApi('GET')
      .mockResolvedValueOnce(
        ok({ revisions: [{ revision: 1 }, { revision: 2 }], next_revision: 2 })
      )
      .mockResolvedValueOnce(ok({ revisions: [{ revision: 3 }] }));
    const { result } = renderHook(() => useBudgetRevisions('acct', BUDGET.id, 2), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
    expect(get.mock.calls[1]?.[1]).toMatchObject({
      params: { path: { id: BUDGET.id }, query: { after_revision: 2, limit: 2 } },
    });
  });
});

describe('budget writes', () => {
  it('creates with the caller’s Idempotency-Key', async () => {
    const post = spyApi('POST').mockResolvedValue(ok(BUDGET));
    const { result } = renderHook(() => useCreateBudget('acct'), { wrapper: wrapper() });
    await act(() => result.current.mutateAsync({ spec: SPEC, key: 'k1' }));
    expect(post).toHaveBeenCalledWith('/v1/billing/budgets', {
      params: { header: { 'Idempotency-Key': 'k1' } },
      body: { spec: SPEC },
    });
  });

  it('replaces and deletes at the expected revision', async () => {
    const put = spyApi('PUT').mockResolvedValue(ok(BUDGET));
    const del = spyApi('DELETE').mockResolvedValue(ok({ ...BUDGET, status: 'deleted' }));
    const update = renderHook(() => useUpdateBudget('acct'), { wrapper: wrapper() });
    await act(() =>
      update.result.current.mutateAsync({ id: BUDGET.id, revision: 3, spec: SPEC, key: 'k2' })
    );
    expect(put).toHaveBeenCalledWith('/v1/billing/budgets/{id}', {
      params: { path: { id: BUDGET.id }, header: { 'Idempotency-Key': 'k2' } },
      body: { expected_revision: 3, spec: SPEC },
    });
    const remove = renderHook(() => useDeleteBudget('acct'), { wrapper: wrapper() });
    await act(() => remove.result.current.mutateAsync({ id: BUDGET.id, revision: 3, key: 'k3' }));
    expect(del).toHaveBeenCalledWith('/v1/billing/budgets/{id}', {
      params: { path: { id: BUDGET.id }, header: { 'Idempotency-Key': 'k3' } },
      body: { expected_revision: 3 },
    });
  });

  it('replaces the channel set', async () => {
    const put = spyApi('PUT').mockResolvedValue(ok({ policy_id: BUDGET.id, channels: [] }));
    const { result } = renderHook(() => useSetBudgetChannels('acct'), { wrapper: wrapper() });
    await act(() => result.current.mutateAsync({ id: BUDGET.id, channelIds: ['c1'], key: 'k4' }));
    expect(put).toHaveBeenCalledWith('/v1/billing/budgets/{id}/channels', {
      params: { path: { id: BUDGET.id }, header: { 'Idempotency-Key': 'k4' } },
      body: { channel_ids: ['c1'] },
    });
  });
});
