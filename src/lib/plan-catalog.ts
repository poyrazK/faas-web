import source from '../../content/docs/plans.md?raw';
import { formatCatalogPrice, parsePlanCatalog } from './plan-catalog-parser';

export const PLAN_CATALOG = parsePlanCatalog(source);
export const FREE_PLAN = PLAN_CATALOG.plans[0];
export const FREE_ALLOWANCE = `${FREE_PLAN.includedGbHours} GB-RAM-hours included per month on Free`;

export function formatPlanPrice(amount: number): string {
  return formatCatalogPrice(amount, PLAN_CATALOG.currency);
}
