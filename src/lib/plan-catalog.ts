import source from '../../content/docs/plans.md?raw';
import { parsePlanCatalog } from './plan-catalog-parser';

export const PLAN_CATALOG = parsePlanCatalog(source);
export const FREE_PLAN = PLAN_CATALOG.plans[0];
export const FREE_ALLOWANCE = `${FREE_PLAN.includedGbHours} GB-RAM-hours included per month on Free`;

export function formatPlanPrice(amount: number): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: PLAN_CATALOG.currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
}
