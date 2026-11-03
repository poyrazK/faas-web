import { describe, expect, it } from 'vitest';
import { mockDailyUsage, mockInvoiceRefresh, orgOverageCap, setOrgOverageCap } from './billing';

const NOW = Date.parse('2026-11-20T10:00:00Z');

describe('mockDailyUsage', () => {
  it('seeds the current month only, oldest first, under the live total', () => {
    const days = mockDailyUsage(100, '2026-11', NOW, ['api', 'web']);
    expect(days[0].date).toBe('2026-11-01');
    expect(days.at(-1)?.date).toBe('2026-11-20');
    // Day 5 has no rollup row, so the console's caption for it can be seen.
    expect(days.some((d) => d.date === '2026-11-05')).toBe(false);
    const sum = days.reduce((s, d) => s + d.gb_hours, 0);
    expect(sum).toBeGreaterThan(90);
    expect(sum).toBeLessThan(100);
    expect(mockDailyUsage(100, '2026-10', NOW, [])).toEqual([]);
    expect(mockDailyUsage(0, '2026-11', NOW, [])).toEqual([]);
  });
});

describe('mockInvoiceRefresh', () => {
  it('reports an open invoice as one total and a paid one as detailed', () => {
    const base = { id: 'i', provider: 'stripe' as const };
    expect(mockInvoiceRefresh({ ...base, status: 'open' } as never)).toMatchObject({
      detailed: false,
      source_gap: 'incomplete',
    });
    expect(mockInvoiceRefresh({ ...base, status: 'paid' } as never)).toMatchObject({
      detailed: true,
    });
  });
});

describe('orgOverageCap', () => {
  it("starts at the plan's default and keeps what the owner sets", () => {
    expect(orgOverageCap('cap-test', 'pro')).toBe(1000);
    setOrgOverageCap('cap-test', null);
    expect(orgOverageCap('cap-test', 'pro')).toBeNull();
    expect(orgOverageCap('cap-free', 'free')).toBeNull();
  });
});
