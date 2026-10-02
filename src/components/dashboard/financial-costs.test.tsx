import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancialCosts } from '@/lib/api/financial';

const useFinancialCosts = vi.fn();
vi.mock('@/lib/api/financial', async (original) => ({
  ...(await original<typeof import('@/lib/api/financial')>()),
  useFinancialCosts: (month: string) => useFinancialCosts(month) as unknown,
}));

const { FinancialCostsPanel } = await import('./financial-costs');
const { financialMoney } = await import('@/lib/api/financial');

function report(): FinancialCosts {
  const price = {
    version: 'compute-v1',
    meter: 'compute',
    currency: 'EUR' as const,
    unit: 'mb_seconds',
    unit_quantity: 3686400,
    millicents_per_unit: 1000,
    included_quantity: 184320000,
  };
  return {
    account_id: 'account',
    currency: 'EUR',
    period_start: '2026-10-01T00:00:00Z',
    period_end: '2026-11-01T00:00:00Z',
    as_of: '2026-10-02T00:00:00Z',
    retained_from: '2026-10-01T01:00:00Z',
    evidence_through_id: 4,
    known_usage_millicents: 12345,
    scope: 'retained_compute_and_interface_egress',
    invoices: [],
    invoice_reconciliation: 'not_reconciled',
    missing_bill_components: ['tax'],
    meters: [
      {
        meter: 'compute',
        coverage: {
          complete: false,
          fresh: true,
          expected_minutes: 1440,
          complete_minutes: 1380,
          unpriced_quantity: 0,
          non_billable_quantity: 0,
          reasons: ['retention_started_during_or_after_period'],
        },
        accrued: {
          meter: 'compute',
          quantity: 500,
          included_quantity: 50,
          net_millicents: 12345,
          allowance_method: 'maximum_period_grant_quantity_share_v1',
          contracts: [
            {
              price,
              quantity: 500,
              included_quantity: 50,
              gross_millicents: 12445,
              allowance_millicents: 100,
              net_millicents: 12345,
              allocation_method: 'quantity_share_largest_remainder_v1',
              allocations: [
                {
                  attribution: { app_id: 'deleted-app', name: 'Original application name' },
                  quantity: 500,
                  gross_millicents: 12445,
                  allowance_millicents: 100,
                  net_millicents: 12345,
                },
              ],
            },
          ],
        },
        forecast: {
          account_id: 'account',
          period_start: '2026-10-01T00:00:00Z',
          period_end: '2026-11-01T00:00:00Z',
          complete_through: '2026-10-02T00:00:00Z',
          method: 'elapsed_time_run_rate_v1',
          price_version: price.version,
          meter: 'compute',
          currency: 'EUR',
          available: false,
          reason: 'incomplete_coverage',
        },
        price_contracts: [
          { price, plan: 'hobby', effective_from: '2026-10-01T01:00:00Z', delivery_mode: 'live' },
        ],
      },
    ],
  };
}

beforeEach(() =>
  useFinancialCosts.mockReset().mockReturnValue({ data: report(), isPending: false, error: null })
);

describe('recorded financial costs', () => {
  it('shows retained names, exact costs, and unavailable forecasts without inventing a full bill', () => {
    render(<FinancialCostsPanel />);
    const table = screen.getByRole('table', { name: 'Attributed usage costs' });
    expect(within(table).getByText('Original application name')).toBeInTheDocument();
    expect(within(table).getByText('EUR 0.12345')).toBeInTheDocument();
    expect(screen.getByText(/Partial usage coverage/)).toBeInTheDocument();
    expect(
      screen.getByText(/Forecast unavailable: A complete usage history is needed/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Month-end projection/)).not.toBeInTheDocument();
    expect(screen.getByText(/A full bill estimate is unavailable/)).toBeInTheDocument();
  });

  it('requests the selected usage month and renders an available server projection', async () => {
    const data = report();
    data.meters[0].forecast = {
      ...data.meters[0].forecast,
      available: true,
      projected_net_millicents: 50000,
    };
    useFinancialCosts.mockReturnValue({ data, isPending: false, error: null });
    render(<FinancialCostsPanel />);
    expect(screen.getByText(/Month-end projection: EUR 0.50/)).toBeInTheDocument();
    const month = screen.getByLabelText('Usage month (UTC)');
    await userEvent.clear(month);
    await userEvent.type(month, '2026-09');
    expect(useFinancialCosts).toHaveBeenLastCalledWith('2026-09');
  });

  it('handles loading without presenting zero costs', () => {
    useFinancialCosts.mockReturnValue({ data: undefined, isPending: true, error: null });
    render(<FinancialCostsPanel />);
    expect(screen.getByText('Reading recorded costs…')).toBeInTheDocument();
    expect(screen.queryByText('EUR 0.00')).not.toBeInTheDocument();
  });

  it('preserves millicents and refuses unsafe integer amounts', () => {
    expect(financialMoney(12345)).toBe('EUR 0.12345');
    expect(financialMoney(0)).toBe('EUR 0.00');
    expect(financialMoney(Number.MAX_SAFE_INTEGER + 1)).toBe('Amount unavailable');
  });
});
