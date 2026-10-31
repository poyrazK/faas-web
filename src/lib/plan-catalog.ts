import source from '../../content/docs/plans.md?raw';
import { parsePlanCatalog } from './plan-catalog-parser';

export const PLAN_CATALOG = parsePlanCatalog(source);
export const FREE_PLAN = PLAN_CATALOG.plans[0];
export const FREE_ALLOWANCE = `${FREE_PLAN.includedGbHours} GB-RAM-hours included per month on Free`;

/** en-US renders the catalog's USD as a bare "$"; other English locales
 * disambiguate it as "US$", which is not how the generated page shows it. */
export function formatPlanPrice(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: PLAN_CATALOG.currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
}
