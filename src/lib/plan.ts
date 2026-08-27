import type { Account, Plan } from './auth';

export type PlanSnapshot = Pick<Account, 'plan' | 'app_count'> & {
  limits: Pick<Account['limits'], 'ram_mb' | 'deployed_apps'>;
};

/** Paid-only capabilities are currently enabled for every non-free plan. */
export function isPaidPlan(plan: Plan | null | undefined): boolean {
  return plan !== null && plan !== undefined && plan !== 'free';
}

export function appQuotaRemaining(account: PlanSnapshot | null): number | null {
  if (!account) return null;
  return Math.max(0, account.limits.deployed_apps - account.app_count);
}

export function appQuotaExceeded(account: PlanSnapshot | null): boolean {
  return account !== null && account.app_count >= account.limits.deployed_apps;
}

export function memoryAllowed(account: PlanSnapshot | null, memoryMb: number): boolean {
  return account === null || memoryMb <= account.limits.ram_mb;
}
