import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { useAuth } from '../auth';

export type FinancialCosts = components['schemas']['FinancialCostsResponse'];
export type FinancialBudget = components['schemas']['FinancialBudgetResponse'];
export type FinancialBudgetSpec = components['schemas']['FinancialBudgetSpec'];

export function useBudgetProjects(enabled: boolean) {
  const { account } = useAuth();
  return useQuery({
    queryKey: ['financial', account?.id, 'scope-projects'],
    queryFn: ({ signal }) => unwrap(api.GET('/v1/projects', { signal })),
    enabled: enabled && !!account?.id,
  });
}

export function useBudgetEnvironments(slug: string) {
  const { account } = useAuth();
  return useQuery({
    queryKey: ['financial', account?.id, 'scope-environments', slug],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/projects/{slug}/environments', { params: { path: { slug } }, signal })),
    enabled: !!account?.id && !!slug,
  });
}

export function useFinancialBudgets() {
  const { account } = useAuth();
  return useQuery({
    queryKey: ['financial', account?.id, 'budgets'],
    queryFn: ({ signal }) => unwrap(api.GET('/v1/billing/budgets', { signal })),
    enabled: !!account?.id,
  });
}

export function useFinancialBudgetHistory(id: string, after = 0) {
  const { account } = useAuth();
  return useQuery({
    queryKey: ['financial', account?.id, 'budget-history', id, after],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/billing/budgets/{id}/revisions', {
          params: { path: { id }, query: { after_revision: after, limit: 100 } },
          signal,
        })
      ),
    enabled: !!account?.id && !!id,
  });
}

export function useFinancialBudgetPreview() {
  return useMutation({
    mutationFn: (spec: FinancialBudgetSpec) =>
      unwrap(api.POST('/v1/billing/budgets/preview', { body: { spec } })),
  });
}

export function useSaveFinancialBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      budget,
      spec,
      key,
    }: {
      budget?: FinancialBudget;
      spec: FinancialBudgetSpec;
      key: string;
    }) =>
      budget
        ? unwrap(
            api.PUT('/v1/billing/budgets/{id}', {
              params: { path: { id: budget.id }, header: { 'Idempotency-Key': key } },
              body: { expected_revision: budget.revision, spec },
            })
          )
        : unwrap(
            api.POST('/v1/billing/budgets', {
              params: { header: { 'Idempotency-Key': key } },
              body: { spec },
            })
          ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['financial'] }),
  });
}

export function useDeleteFinancialBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ budget, key }: { budget: FinancialBudget; key: string }) =>
      unwrap(
        api.DELETE('/v1/billing/budgets/{id}', {
          params: { path: { id: budget.id }, header: { 'Idempotency-Key': key } },
          body: { expected_revision: budget.revision },
        })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['financial'] }),
  });
}

export function useFinancialCosts(month: string) {
  const { account } = useAuth();
  return useQuery({
    queryKey: ['financial', account?.id, 'costs', month],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/billing/costs', { params: { query: { month } }, signal })),
    enabled: !!account?.id && !!month,
    refetchInterval: 60_000,
  });
}

export function financialMoney(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return 'Amount unavailable';
  const n = BigInt(value);
  const whole = n / 100_000n;
  const fraction = (n % 100_000n).toString().padStart(5, '0').replace(/0+$/, '').padEnd(2, '0');
  return `EUR ${whole}.${fraction}`;
}

/** Exact EUR text to millicents; fractional precision and safe-integer bounds
 * are checked before passing money to the JSON contract. */
export function parseFinancialMoney(text: string): number | undefined {
  const match = /^(\d+)(?:\.(\d{1,5}))?$/.exec(text.trim());
  if (!match) return undefined;
  const value = BigInt(match[1]) * 100_000n + BigInt((match[2] ?? '').padEnd(5, '0'));
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}
