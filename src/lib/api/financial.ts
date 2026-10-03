import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

export type FinancialCosts = components['schemas']['FinancialCostsResponse'];
export type FinancialBudget = components['schemas']['FinancialBudgetResponse'];
export type FinancialBudgetSpec = components['schemas']['FinancialBudgetSpec'];

export function useBudgetProjects(enabled: boolean) {
  return useQuery({
    queryKey: ['financial', 'scope-projects'],
    queryFn: () => unwrap(api.GET('/v1/projects')),
    enabled,
  });
}

export function useBudgetEnvironments(slug: string) {
  return useQuery({
    queryKey: ['financial', 'scope-environments', slug],
    queryFn: () =>
      unwrap(api.GET('/v1/projects/{slug}/environments', { params: { path: { slug } } })),
    enabled: !!slug,
  });
}

export function useFinancialBudgets() {
  return useQuery({
    queryKey: ['financial', 'budgets'],
    queryFn: () => unwrap(api.GET('/v1/billing/budgets')),
  });
}

export function useFinancialBudgetHistory(id: string, after = 0) {
  return useQuery({
    queryKey: ['financial', 'budget-history', id, after],
    queryFn: () =>
      unwrap(
        api.GET('/v1/billing/budgets/{id}/revisions', {
          params: { path: { id }, query: { after_revision: after, limit: 100 } },
        })
      ),
    enabled: !!id,
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
  return useQuery({
    queryKey: ['financial', 'costs', month],
    queryFn: () => unwrap(api.GET('/v1/billing/costs', { params: { query: { month } } })),
    enabled: !!month,
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
