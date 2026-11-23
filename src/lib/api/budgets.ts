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
 * The account routes ignore X-Active-Org (server.go:4785-4793 mount them
 * without loadOrg), so a company workspace uses the organization routes
 * instead, through a `BudgetSubject`. Reads need usage:read, writes admin
 * (an organization's also its owner or billing role), both session MFA;
 * every write needs an Idempotency-Key.
 */

/**
 * Whose budgets: the signed-in account's (`/v1/billing/budgets`), or an
 * organization's that owns its resources (`/v1/orgs/{slug}/billing/budgets`,
 * ADR-20261031211500: same bodies; notify and stop previews only, no
 * channels). The subject picks the routes and keeps the caches apart.
 */
export type BudgetSubject =
  | { kind: 'account'; accountId: string }
  | { kind: 'org'; slug: string; accountId: string; label?: string };

/** Ready once the account (and, for an organization, its slug) is known. */
export const subjectReady = (s: BudgetSubject) =>
  Boolean(s.accountId) && (s.kind === 'account' || Boolean(s.slug));

const root = (s: BudgetSubject) =>
  s.kind === 'org'
    ? (['orgs', s.slug, 'budgets'] as const)
    : (['account', s.accountId, 'budgets'] as const);

export const budgetKeys = {
  all: (s: BudgetSubject) => root(s),
  detail: (s: BudgetSubject, id: string) => [...root(s), id] as const,
  channels: (s: BudgetSubject, id: string) => [...root(s), id, 'channels'] as const,
  revisions: (s: BudgetSubject, id: string, limit: number) =>
    [...root(s), id, 'revisions', limit] as const,
};

export function useBudgets(subject: BudgetSubject, enabled: boolean) {
  return useQuery({
    queryKey: budgetKeys.all(subject),
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          subject.kind === 'org'
            ? api.GET('/v1/orgs/{slug}/billing/budgets', {
                params: { path: { slug: subject.slug } },
                signal,
              })
            : api.GET('/v1/billing/budgets', { signal })
        )
      ).budgets,
    enabled: enabled && subjectReady(subject),
    retry: retryPolicy,
  });
}

/** One budget, fresh: runtime evaluation, alerts, stops and compute balance. */
export function useBudget(subject: BudgetSubject, id: string) {
  return useQuery({
    queryKey: budgetKeys.detail(subject, id),
    queryFn: ({ signal }) =>
      unwrap(
        subject.kind === 'org'
          ? api.GET('/v1/orgs/{slug}/billing/budgets/{id}', {
              params: { path: { slug: subject.slug, id } },
              signal,
            })
          : api.GET('/v1/billing/budgets/{id}', { params: { path: { id } }, signal })
      ),
    enabled: subjectReady(subject) && Boolean(id),
    retry: retryPolicy,
  });
}

/** Alert channels belong to account budgets; an organization's go to its billing contact. */
export function useBudgetChannels(subject: BudgetSubject, id: string) {
  return useQuery({
    queryKey: budgetKeys.channels(subject, id),
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api.GET('/v1/billing/budgets/{id}/channels', { params: { path: { id } }, signal })
        )
      ).channels,
    enabled: subject.kind === 'account' && subjectReady(subject) && Boolean(id),
    retry: retryPolicy,
  });
}

/** Immutable revisions, oldest first; `next_revision` continues a full page. */
export function useBudgetRevisions(subject: BudgetSubject, id: string, limit = 20) {
  return useInfiniteQuery({
    queryKey: budgetKeys.revisions(subject, id, limit),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        subject.kind === 'org'
          ? api.GET('/v1/orgs/{slug}/billing/budgets/{id}/revisions', {
              params: {
                path: { slug: subject.slug, id },
                query: { after_revision: pageParam, limit },
              },
              signal,
            })
          : api.GET('/v1/billing/budgets/{id}/revisions', {
              params: { path: { id }, query: { after_revision: pageParam, limit } },
              signal,
            })
      ),
    initialPageParam: 0,
    getNextPageParam: (page) => page.next_revision,
    enabled: subjectReady(subject) && Boolean(id),
    retry: retryPolicy,
  });
}

/** What a spec would do this month. No writes (billing/financial_budget_preview.go:14). */
export function usePreviewBudget(subject: BudgetSubject) {
  return useMutation({
    mutationFn: (spec: BudgetSpec) =>
      unwrap(
        subject.kind === 'org'
          ? api.POST('/v1/orgs/{slug}/billing/budgets/preview', {
              params: { path: { slug: subject.slug } },
              body: { spec },
            })
          : api.POST('/v1/billing/budgets/preview', { body: { spec } })
      ),
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

function useBudgetWrite<V>(subject: BudgetSubject, write: (vars: V) => Promise<Budget>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (budget) => {
      qc.setQueryData(budgetKeys.detail(subject, budget.id), budget);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: budgetKeys.all(subject) }),
  });
}

export function useCreateBudget(subject: BudgetSubject) {
  return useBudgetWrite(subject, ({ spec, key }: { spec: BudgetSpec; key: string }) =>
    unwrap(
      subject.kind === 'org'
        ? api.POST('/v1/orgs/{slug}/billing/budgets', {
            params: { path: { slug: subject.slug }, header: { 'Idempotency-Key': key } },
            body: { spec },
          })
        : api.POST('/v1/billing/budgets', {
            params: { header: { 'Idempotency-Key': key } },
            body: { spec },
          })
    )
  );
}

export function useUpdateBudget(subject: BudgetSubject) {
  return useBudgetWrite(
    subject,
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
        subject.kind === 'org'
          ? api.PUT('/v1/orgs/{slug}/billing/budgets/{id}', {
              params: { path: { slug: subject.slug, id }, header: { 'Idempotency-Key': key } },
              body: { expected_revision: revision, spec },
            })
          : api.PUT('/v1/billing/budgets/{id}', {
              params: { path: { id }, header: { 'Idempotency-Key': key } },
              body: { expected_revision: revision, spec },
            })
      )
  );
}

/** Tombstones the budget; its revision history stays readable. */
export function useDeleteBudget(subject: BudgetSubject) {
  return useBudgetWrite(
    subject,
    ({ id, revision, key }: { id: string; revision: number; key: string }) =>
      unwrap(
        subject.kind === 'org'
          ? api.DELETE('/v1/orgs/{slug}/billing/budgets/{id}', {
              params: { path: { slug: subject.slug, id }, header: { 'Idempotency-Key': key } },
              body: { expected_revision: revision },
            })
          : api.DELETE('/v1/billing/budgets/{id}', {
              params: { path: { id }, header: { 'Idempotency-Key': key } },
              body: { expected_revision: revision },
            })
      )
  );
}

/** Replaces the channels an account budget's alerts also go to. Not a revision. */
export function useSetBudgetChannels(subject: BudgetSubject) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, channelIds, key }: { id: string; channelIds: string[]; key: string }) => {
      if (subject.kind !== 'account')
        throw new Error('Organization budgets have no alert channels.');
      return unwrap(
        api.PUT('/v1/billing/budgets/{id}/channels', {
          params: { path: { id }, header: { 'Idempotency-Key': key } },
          body: { channel_ids: channelIds },
        })
      );
    },
    onSuccess: (out, { id }) => qc.setQueryData(budgetKeys.channels(subject, id), out.channels),
  });
}
