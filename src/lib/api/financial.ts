import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

export type FinancialCosts = components['schemas']['FinancialCostsResponse'];

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
