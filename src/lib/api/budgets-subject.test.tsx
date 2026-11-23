import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import {
  budgetKeys,
  useBudgetChannels,
  useBudgetRevisions,
  useBudgets,
  useCreateBudget,
  useDeleteBudget,
  usePreviewBudget,
  useUpdateBudget,
  type BudgetSubject,
} from './budgets';

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
afterEach(() => vi.restoreAllMocks());

const account: BudgetSubject = { kind: 'account', accountId: 'a1' };
const org: BudgetSubject = { kind: 'org', slug: 'acme', accountId: 'a1' };
const spec = { name: 'Previews', enabled: true } as never;

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
const calls = (spy: ReturnType<typeof spyApi>) =>
  (spy.mock.calls as unknown as [string, Record<string, unknown>][]).map(([path, init]) => [
    path,
    init,
  ]);

describe('budget subjects', () => {
  it('an organization reads, previews and writes its own budget routes', async () => {
    const get = spyApi('GET').mockImplementation(async (path) =>
      path.endsWith('/revisions')
        ? ok({ revisions: [], next_revision: undefined })
        : ok({ budgets: [] })
    );
    const post = spyApi('POST').mockResolvedValue(ok({ id: 'b1', spec, revision: 1 }));
    const put = spyApi('PUT').mockResolvedValue(ok({ id: 'b1', spec, revision: 2 }));
    const del = spyApi('DELETE').mockResolvedValue(ok({ id: 'b1', spec, revision: 3 }));
    const w = wrapper();
    const list = renderHook(() => useBudgets(org, true), { wrapper: w });
    const history = renderHook(() => useBudgetRevisions(org, 'b1'), { wrapper: w });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(history.result.current.isSuccess).toBe(true));
    const preview = renderHook(() => usePreviewBudget(org), { wrapper: w });
    const create = renderHook(() => useCreateBudget(org), { wrapper: w });
    const update = renderHook(() => useUpdateBudget(org), { wrapper: w });
    const remove = renderHook(() => useDeleteBudget(org), { wrapper: w });
    await act(() => preview.result.current.mutateAsync(spec));
    await act(() => create.result.current.mutateAsync({ spec, key: 'k1' }));
    await act(() => update.result.current.mutateAsync({ id: 'b1', revision: 1, spec, key: 'k2' }));
    await act(() => remove.result.current.mutateAsync({ id: 'b1', revision: 2, key: 'k3' }));
    expect(calls(get)).toEqual(
      expect.arrayContaining([
        [
          '/v1/orgs/{slug}/billing/budgets',
          expect.objectContaining({ params: { path: { slug: 'acme' } } }),
        ],
        [
          '/v1/orgs/{slug}/billing/budgets/{id}/revisions',
          expect.objectContaining({
            params: { path: { slug: 'acme', id: 'b1' }, query: { after_revision: 0, limit: 20 } },
          }),
        ],
      ])
    );
    expect(calls(post)).toEqual([
      [
        '/v1/orgs/{slug}/billing/budgets/preview',
        { params: { path: { slug: 'acme' } }, body: { spec } },
      ],
      [
        '/v1/orgs/{slug}/billing/budgets',
        { params: { path: { slug: 'acme' }, header: { 'Idempotency-Key': 'k1' } }, body: { spec } },
      ],
    ]);
    expect(calls(put)).toEqual([
      [
        '/v1/orgs/{slug}/billing/budgets/{id}',
        {
          params: { path: { slug: 'acme', id: 'b1' }, header: { 'Idempotency-Key': 'k2' } },
          body: { expected_revision: 1, spec },
        },
      ],
    ]);
    expect(calls(del)).toEqual([
      [
        '/v1/orgs/{slug}/billing/budgets/{id}',
        {
          params: { path: { slug: 'acme', id: 'b1' }, header: { 'Idempotency-Key': 'k3' } },
          body: { expected_revision: 2 },
        },
      ],
    ]);
  });

  it('the personal account keeps its routes and keys', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ budgets: [] }));
    const list = renderHook(() => useBudgets(account, true), { wrapper: wrapper() });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(calls(get)[0][0]).toBe('/v1/billing/budgets');
    expect(budgetKeys.all(account)).toEqual(['account', 'a1', 'budgets']);
  });

  it('subjects never share a cache', async () => {
    spyApi('GET').mockImplementation(async (path) =>
      ok({ budgets: path === '/v1/billing/budgets' ? [{ id: 'p' }] : [{ id: 'o' }] })
    );
    const w = wrapper();
    const personal = renderHook(() => useBudgets(account, true), { wrapper: w });
    const company = renderHook(() => useBudgets(org, true), { wrapper: w });
    await waitFor(() => expect(personal.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(company.result.current.isSuccess).toBe(true));
    expect(personal.result.current.data).toEqual([{ id: 'p' }]);
    expect(company.result.current.data).toEqual([{ id: 'o' }]);
    expect(budgetKeys.all(org)).toEqual(['orgs', 'acme', 'budgets']);
  });

  it('an organization has no channel reads', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ channels: [] }));
    const channels = renderHook(() => useBudgetChannels(org, 'b1'), { wrapper: wrapper() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(channels.result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });
});
