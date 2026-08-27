import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS } from '@/components/dashboard/nav-config';

describe('customer surface boundary', () => {
  it('does not publish operator navigation', () => {
    expect(NAV_GROUPS.some((group) => group.title === 'Operations')).toBe(false);
    expect(NAV_ITEMS.some((item) => item.to.startsWith('/dashboard/operator'))).toBe(false);
  });

  it('does not contain customer routes in the operator namespace', () => {
    const operatorRoutes = import.meta.glob('../routes/dashboard.operator*', { eager: false });
    expect(Object.keys(operatorRoutes)).toEqual([]);
  });
});
