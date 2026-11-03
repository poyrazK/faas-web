import { useCallback, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError } from './errors';
import { retryPolicy } from './queries';
import type { Budget, BudgetSpec } from '../budgets';

/**
 * Budgets over `/v1/billing/budgets` (faas handlers_financial_budgets.go,
 * handlers_financial_budget_channels.go, handlers_financial.go:110).
 *
 * Every route belongs to the signed-in account: none reads X-Active-Org
 * (server.go:4785-4793 mount them without loadOrg), so a company workspace
 * must not call them at all. Reads need usage:read, writes admin, both
 * session MFA; every write needs an Idempotency-Key.
 */

export const budgetKeys = {
  all: (accountId: string) => ['account', accountId, 'budgets'] as const,
  detail: (accountId: string, id: string) => [...budgetKeys.all(accountId), id] as const,
  channels: (accountId: string, id: string) =>
    [...budgetKeys.detail(accountId, id), 'channels'] as const,
  revisions: (accountId: string, id: string, limit: number) =>
    [...budgetKeys.detail(accountId, id), 'revisions', limit] as const,
};

export function useBudgets(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: budgetKeys.all(accountId),
    queryFn: async ({ signal }) =>
      (await unwrap(api.GET('/v1/billing/budgets', { signal }))).budgets,
    enabled: enabled && Boolean(accountId),
    retry: retryPolicy,
  });
}

/** One budget, fresh: runtime evaluation, alerts, stops and compute balance. */
export function useBudget(accountId: string, id: string) {
  return useQuery({
    queryKey: budgetKeys.detail(accountId, id),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/billing/budgets/{id}', { params: { path: { id } }, signal })),
    enabled: Boolean(accountId && id),
    retry: retryPolicy,
  });
}

export function useBudgetChannels(accountId: string, id: string) {
  return useQuery({
    queryKey: budgetKeys.channels(accountId, id),
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api.GET('/v1/billing/budgets/{id}/channels', { params: { path: { id } }, signal })
        )
      ).channels,
    enabled: Boolean(accountId && id),
    retry: retryPolicy,
  });
}

/** Immutable revisions, oldest first; `next_revision` continues a full page. */
export function useBudgetRevisions(accountId: string, id: string, limit = 20) {
  return useInfiniteQuery({
    queryKey: budgetKeys.revisions(accountId, id, limit),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/billing/budgets/{id}/revisions', {
          params: { path: { id }, query: { after_revision: pageParam, limit } },
          signal,
        })
      ),
    initialPageParam: 0,
    getNextPageParam: (page) => page.next_revision,
    enabled: Boolean(accountId && id),
    retry: retryPolicy,
  });
}

/** What a spec would do this month. No writes (billing/financial_budget_preview.go:14). */
export function usePreviewBudget() {
  return useMutation({
    mutationFn: (spec: BudgetSpec) =>
      unwrap(api.POST('/v1/billing/budgets/preview', { body: { spec } })),
  });
}

/**
 * One Idempotency-Key per distinct write, kept until the server answers it.
 *
 * apid binds a key to its request (server.go:6071) and replays 4xx answers
 * (server.go:6136), and a create derives the budget's id from it
 * (handlers_financial_budgets.go:102). So a retry after a dropped connection
 * must reuse the key, a changed request must not, and once apid has answered
 * (a 422 that can clear, say) the next attempt is a new operation.
 */
export function useOperationKey() {
  const last = useRef<{ identity: string; key: string } | null>(null);
  const keyFor = useCallback((identity: string) => {
    if (last.current?.identity !== identity) last.current = { identity, key: crypto.randomUUID() };
    return last.current.key;
  }, []);
  const settle = useCallback((error?: unknown) => {
    if (error === undefined || (error instanceof ApiError && !error.isUnreachable))
      last.current = null;
  }, []);
  return { keyFor, settle };
}

function useBudgetWrite<V>(accountId: string, write: (vars: V) => Promise<Budget>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (budget) => {
      qc.setQueryData(budgetKeys.detail(accountId, budget.id), budget);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: budgetKeys.all(accountId) }),
  });
}

export function useCreateBudget(accountId: string) {
  return useBudgetWrite(accountId, ({ spec, key }: { spec: BudgetSpec; key: string }) =>
    unwrap(
      api.POST('/v1/billing/budgets', {
        params: { header: { 'Idempotency-Key': key } },
        body: { spec },
      })
    )
  );
}

export function useUpdateBudget(accountId: string) {
  return useBudgetWrite(
    accountId,
    ({
      id,
      revision,
      spec,
      key,
    }: {
      id: string;
      revision: number;
      spec: BudgetSpec;
      key: string;
    }) =>
      unwrap(
        api.PUT('/v1/billing/budgets/{id}', {
          params: { path: { id }, header: { 'Idempotency-Key': key } },
          body: { expected_revision: revision, spec },
        })
      )
  );
}

/** Tombstones the budget; its revision history stays readable. */
export function useDeleteBudget(accountId: string) {
  return useBudgetWrite(
    accountId,
    ({ id, revision, key }: { id: string; revision: number; key: string }) =>
      unwrap(
        api.DELETE('/v1/billing/budgets/{id}', {
          params: { path: { id }, header: { 'Idempotency-Key': key } },
          body: { expected_revision: revision },
        })
      )
  );
}

/** Replaces the channels a budget's alerts also go to. Not a revision. */
export function useSetBudgetChannels(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, channelIds, key }: { id: string; channelIds: string[]; key: string }) =>
      unwrap(
        api.PUT('/v1/billing/budgets/{id}/channels', {
          params: { path: { id }, header: { 'Idempotency-Key': key } },
          body: { channel_ids: channelIds },
        })
      ),
    onSuccess: (out, { id }) => qc.setQueryData(budgetKeys.channels(accountId, id), out.channels),
  });
}
