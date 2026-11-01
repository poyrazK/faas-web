import { describe, expect, it } from 'vitest';
import { FREE_ALLOWANCE, PLAN_CATALOG, formatPlanPrice } from './plan-catalog';

describe('plan catalog presentation', () => {
  it('formats catalog prices with a plain dollar sign', () => {
    expect(PLAN_CATALOG.currency).toBe('USD');
    expect(PLAN_CATALOG.plans.map((plan) => formatPlanPrice(plan.monthly))).toEqual([
      '$0',
      '$10',
      '$30',
      '$99',
    ]);
    expect(formatPlanPrice(PLAN_CATALOG.overagePerGbHour)).toBe('$0.01');
  });
  it('derives the signup allowance line from the Free plan', () => {
    expect(FREE_ALLOWANCE).toBe('20 GB-RAM-hours included per month on Free');
  });
});
