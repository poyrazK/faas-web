import { describe, expect, it } from 'vitest';
import {
  mockDailyUsage,
  mockFinancialCosts,
  mockInvoiceRefresh,
  orgOverageCap,
  setOrgOverageCap,
} from './billing';

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

describe('mockFinancialCosts', () => {
  const costs = (month: string) =>
    mockFinancialCosts({
      month,
      now: NOW,
      accountId: 'acct',
      plan: 'pro',
      includedGbHours: 2000,
      invoices: [
        { id: 'ends-nov-1', period_end: '2026-11-01T00:00:00Z' },
        { id: 'ends-oct-1', period_end: '2026-10-01T00:00:00Z' },
      ] as never,
      apps: [
        { id: 'a', slug: 'api' },
        { id: 'b', slug: 'web' },
      ],
    });

  it('keeps known usage the sum of the integer meter nets, and allocations exact', () => {
    const report = costs('2026-10');
    expect(report.known_usage_millicents).toBe(
      report.meters.reduce((sum, m) => sum + m.accrued.net_millicents, 0)
    );
    // 1.18 of a 2,000 GB-hour allowance: 360 GB-hours of overage at $0.01.
    expect(report.known_usage_millicents).toBe(360_000);
    const [contract] = report.meters[0].accrued.contracts;
    for (const field of ['quantity', 'net_millicents', 'gross_millicents'] as const)
      expect(contract.allocations.reduce((sum, a) => sum + a[field], 0)).toBe(contract[field]);
    // By period end, as apid lists them (memstore ListInvoicesForAccount).
    expect(report.invoices.map((i) => i.id)).toEqual(['ends-oct-1']);
    expect(report.invoice_reconciliation).toBe('not_reconciled');
  });

  it('reports the retention month and the current egress as coverage gaps', () => {
    expect(costs('2026-08').retained_from).toBe('2026-08-10T06:00:00.000Z');
    expect(costs('2026-08').meters[0].coverage).toMatchObject({
      complete: false,
      reasons: ['retention_started_during_or_after_period', 'missing_sampling_windows'],
    });
    const current = costs('2026-11');
    expect(current.meters[0].coverage.complete).toBe(true);
    expect(current.meters[1].coverage).toMatchObject({
      complete: false,
      reasons: ['missing_sampling_windows'],
    });
    // Egress has no live price: observed, never costed.
    expect(current.meters[1].accrued.net_millicents).toBe(0);
    expect(current.meters[1].coverage.non_billable_quantity).toBeGreaterThan(0);
    expect(costs('2026-06').known_usage_millicents).toBe(0);
  });
});
