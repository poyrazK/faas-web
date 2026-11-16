import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import type { FinancialCosts, FinancialMeterCosts } from '@/lib/api/billing-costs';
import { CostBreakdown, CostBreakdownPersonalOnly, costSentence } from './billing-costs';

const mfa = vi.hoisted(() => ({
  openMfa: vi.fn(),
}));
vi.mock('@/components/auth/mfa-provider', () => ({ useMfa: () => ({ openMfa: mfa.openMfa }) }));

const MB_SECONDS_PER_GB_HOUR = 1024 * 3600;

function meter(
  name: string,
  overrides: {
    unit: string;
    quantity: number;
    included?: number;
    gross?: number;
    allowance?: number;
    net?: number;
    coverage?: Partial<FinancialMeterCosts['coverage']>;
    mode?: 'live' | 'shadow' | 'off';
  }
): FinancialMeterCosts {
  const price = {
    version: `${name}-v1`,
    meter: name,
    currency: 'USD' as const,
    unit: overrides.unit,
    unit_quantity: name === 'compute' ? MB_SECONDS_PER_GB_HOUR : 1,
    millicents_per_unit: name === 'compute' ? 1_000 : 0,
    included_quantity: overrides.included ?? 0,
  };
  const live = (overrides.mode ?? 'live') === 'live';
  return {
    meter: name,
    coverage: {
      complete: true,
      fresh: true,
      expected_minutes: 3_480,
      complete_minutes: 3_480,
      unpriced_quantity: 0,
      non_billable_quantity: 0,
      reasons: [],
      ...overrides.coverage,
    },
    accrued: {
      meter: name,
      quantity: live ? overrides.quantity : 0,
      included_quantity: overrides.included ?? 0,
      net_millicents: overrides.net ?? 0,
      allowance_method: 'shared_monthly_allowance',
      contracts: live
        ? [
            {
              price,
              quantity: overrides.quantity,
              included_quantity: overrides.included ?? 0,
              gross_millicents: overrides.gross ?? 0,
              allowance_millicents: overrides.allowance ?? 0,
              net_millicents: overrides.net ?? 0,
              allocation_method: 'quantity_share',
              allocations: [],
            },
          ]
        : [],
    },
    forecast: {
      method: 'elapsed_time_run_rate_v1',
      available: false,
      reason: 'meter_not_billed',
      account_id: 'acct-1',
      period_start: '2026-11-01T00:00:00Z',
      period_end: '2026-12-01T00:00:00Z',
      complete_through: '2026-11-03T10:00:00Z',
      price_version: price.version,
      meter: name,
      currency: 'USD',
    },
    price_contracts: [
      {
        price,
        plan: 'pro',
        effective_from: '2026-09-10T06:00:00Z',
        delivery_mode: overrides.mode ?? 'live',
      },
    ],
  };
}

function report(month = '2026-11', overrides: Partial<FinancialCosts> = {}): FinancialCosts {
  const [y, m] = month.split('-').map(Number);
  return {
    account_id: 'acct-1',
    currency: 'USD',
    period_start: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    period_end: new Date(Date.UTC(y, m, 1)).toISOString(),
    as_of: '2026-11-03T10:00:00Z',
    retained_from: '2026-09-10T06:00:00Z',
    evidence_through_id: 42,
    // 132 GB-hours used, 100 included: 32 GB-hours at $0.01 = $0.32.
    known_usage_millicents: 32_000,
    meters: [
      meter('compute', {
        unit: 'mb_seconds',
        quantity: 132 * MB_SECONDS_PER_GB_HOUR,
        included: 100 * MB_SECONDS_PER_GB_HOUR,
        gross: 132_000,
        allowance: 100_000,
        net: 32_000,
      }),
      meter('egress', {
        unit: 'interface_bytes',
        quantity: 5 * 2 ** 30,
        mode: 'off',
        coverage: {
          complete: false,
          complete_minutes: 2_900,
          non_billable_quantity: 5 * 2 ** 30,
          reasons: ['missing_sampling_windows'],
        },
      }),
    ],
    scope: 'retained_compute_and_interface_egress',
    invoices: [
      {
        id: 'inv-1',
        provider: 'stripe',
        provider_invoice_id: 'in_1',
        number: 'GRG-202611-1042',
        status: 'open',
        period_start: '2026-10-01T00:00:00Z',
        period_end: '2026-11-01T00:00:00Z',
        subtotal_cents: 4_900,
        tax_cents: 931,
        total_cents: 5_831,
        amount_paid_cents: 0,
        currency: 'eur',
        pdf_available: false,
        created_at: '2026-11-01T00:00:00Z',
      },
    ],
    invoice_reconciliation: 'not_reconciled',
    missing_bill_components: [
      'subscription_and_addons',
      'credits_and_adjustments',
      'tax',
      'external_and_managed_resource_meters',
    ],
    ...overrides,
  };
}

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const refused = (code: string, status = 403) =>
  ({
    error: { status, code, title: code, detail: `${code} detail` },
    response: new Response(null, { status }),
  }) as never;

let get: ReturnType<typeof spyApi>;
beforeEach(() => {
  mfa.openMfa.mockReset();
  get = spyApi('GET').mockImplementation(async (path, init) => {
    if (path !== '/v1/billing/costs') throw new Error(`Unexpected GET ${path}`);
    const month = (init as { params: { query: { month?: string } } }).params.query.month;
    return ok(report(month));
  });
});
afterEach(() => vi.restoreAllMocks());

async function mount(ui = <CostBreakdown />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
}

/** The meter table, coverage, omissions, prices and invoices sit behind one disclosure. */
async function openDetails() {
  await userEvent.click(await screen.findByText('Show cost details'));
}

const costCalls = () => get.mock.calls.filter(([path]) => path === '/v1/billing/costs');

describe('known usage cost', () => {
  it('shows the known total and each meter from millicents, with the scope in words', async () => {
    await mount();
    expect(
      await screen.findByText('$0.32', { selector: '[data-testid="known-usage"]' })
    ).toBeVisible();
    const table = screen.getByRole('region', { name: 'Cost by meter' });
    const compute = within(table).getByRole('row', { name: /Compute/ });
    expect(compute).toHaveTextContent('132 GB-hours');
    expect(compute).toHaveTextContent('$0.32');
    expect(compute).toHaveTextContent('Complete');
    expect(screen.getByText(/November 2026 · as of/)).toBeVisible();
    // The answer first, in words; the detail closed until asked for.
    expect(
      screen.getByText(
        'What usage has cost, at the price in force when it happened. One meter has gaps, so it counts only what is known. It isn’t your bill: it leaves out the subscription, credits, tax and other services.'
      )
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Cost by meter' })).not.toBeVisible();
    await openDetails();
    expect(screen.getByRole('region', { name: 'Cost by meter' })).toBeVisible();
    // The scope and the not-an-invoice caveat are one hover away.
    await userEvent.click(screen.getByRole('button', { name: 'About known usage cost' }));
    expect(
      await screen.findByText(
        /Priced usage of compute and interface egress for November 2026 \(UTC\)/
      )
    ).toBeVisible();
    // The current month is read without a month, so the server decides it.
    expect(costCalls()[0][1]).toMatchObject({ params: { query: {} } });
  });
});

describe('coverage gaps', () => {
  it('states a gap as a gap and never fills it in', async () => {
    await mount();
    await openDetails();
    const table = await screen.findByRole('region', { name: 'Cost by meter' });
    const egress = within(table).getByRole('row', { name: /Interface egress/ });
    // Colour, icon and a label: the status never rests on hue.
    expect(within(egress).getByText('Coverage gap')).toBeInTheDocument();
    // The egress price is off: its traffic is reported, not billed, and not costed.
    expect(egress).toHaveTextContent('5 GiB not billed');
    expect(egress).toHaveTextContent('$0.00');

    const gaps = screen.getByRole('list', { name: 'Coverage gaps' });
    expect(gaps).toHaveTextContent('Interface egress');
    expect(gaps).toHaveTextContent('2,900 of 3,480 sampling minutes are recorded');
    expect(gaps).toHaveTextContent('Missing minutes are not counted as zero usage');
    expect(within(gaps).queryByText(/Compute/)).toBeNull();
    // The headline says it is incomplete rather than presenting a whole figure.
    expect(screen.getByText('1 meter incomplete')).toBeVisible();
  });

  it('names unpriced usage and the retention start, and keeps the reported amount', async () => {
    const data = report('2026-09');
    data.meters[0].coverage = {
      ...data.meters[0].coverage,
      complete: false,
      unpriced_quantity: 10 * MB_SECONDS_PER_GB_HOUR,
      reasons: ['retention_started_during_or_after_period', 'missing_historical_prices'],
    };
    get.mockResolvedValue(ok(data));
    await mount();
    await openDetails();
    const gaps = await screen.findByRole('list', { name: 'Coverage gaps' });
    expect(gaps).toHaveTextContent('Usage history starts');
    expect(gaps).toHaveTextContent('10 GB-hours is unpriced and not in the known cost');
    expect(gaps).toHaveTextContent("not priced at today's rate");
    expect(screen.getByTestId('known-usage')).toHaveTextContent('$0.32');
  });

  it('says so when every meter is complete, fresh and priced', async () => {
    const data = report();
    data.meters = [data.meters[0]];
    get.mockResolvedValue(ok(data));
    await mount();
    await openDetails();
    expect(
      await screen.findByText('Every meter is fully sampled, fresh and priced for this month.')
    ).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Coverage gaps' })).toBeNull();
  });
});

describe('costSentence', () => {
  it('names only what the report leaves out, and says nothing of gaps it does not have', () => {
    expect(costSentence({ missing_bill_components: ['tax'] }, 0)).toBe(
      'What usage has cost, at the price in force when it happened. It isn’t your bill: it leaves out tax.'
    );
    expect(costSentence({ missing_bill_components: [] }, 2)).toBe(
      'What usage has cost, at the price in force when it happened. 2 meters have gaps, so it counts only what is known. It isn’t an invoice.'
    );
  });
});

describe('missing bill components', () => {
  it('names each part of the bill the report leaves out', async () => {
    await mount();
    await openDetails();
    const missing = await screen.findByRole('list', { name: 'Not in this report' });
    for (const name of [
      'Subscription and add-ons',
      'Credits and adjustments',
      'Tax',
      'External and managed resource meters',
    ])
      expect(within(missing).getByText(name)).toBeVisible();
    expect(screen.getByText(/so the known usage cost is not a bill estimate/)).toBeVisible();
  });
});

describe('invoices', () => {
  it('lists invoices as separate, unreconciled facts and never adds them to usage', async () => {
    await mount();
    await openDetails();
    const invoices = await screen.findByRole('region', { name: 'Invoices' });
    expect(within(invoices).getByText('GRG-202611-1042')).toBeInTheDocument();
    expect(within(invoices).getByText('€58.31')).toBeInTheDocument();
    expect(screen.getByText('Not reconciled')).toBeVisible();
    expect(screen.getByText(/not added to the known usage cost/)).toBeVisible();
    // $0.32 of usage and €58.31 invoiced: no figure anywhere combines them.
    expect(screen.queryByText(/58\.63/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/58\.63/);
  });

  it('says when no invoice period ends in the month', async () => {
    get.mockResolvedValue(ok(report('2026-11', { invoices: [] })));
    await mount();
    await openDetails();
    expect(
      await screen.findByText('No provider invoice has a period ending in this month.')
    ).toBeVisible();
  });
});

describe('month selector', () => {
  it('offers the current month back to the retention start and reads the chosen one', async () => {
    await mount();
    const select = await screen.findByRole('combobox', { name: 'Month' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['November 2026 (current)', 'October 2026', 'September 2026']);
    await userEvent.selectOptions(select, 'October 2026');
    await waitFor(() =>
      expect(costCalls().at(-1)?.[1]).toMatchObject({ params: { query: { month: '2026-10' } } })
    );
    expect(await screen.findByText(/October 2026 · as of/)).toBeVisible();
    await userEvent.selectOptions(select, 'November 2026 (current)');
    expect(await screen.findByText(/November 2026 · as of/)).toBeVisible();
  });
});

describe('the session MFA gate', () => {
  it('prompts once, then retries the read after verification', async () => {
    get.mockResolvedValueOnce(refused('mfa_required')).mockResolvedValue(ok(report()));
    mfa.openMfa.mockImplementation((_mode, opts: { onVerified: () => void }) => opts.onVerified());
    await mount();
    expect(await screen.findByTestId('known-usage')).toHaveTextContent('$0.32');
    expect(mfa.openMfa).toHaveBeenCalledTimes(1);
    expect(mfa.openMfa).toHaveBeenCalledWith(
      'choose',
      expect.objectContaining({ allowRecovery: true })
    );
    expect(costCalls()).toHaveLength(2);
  });

  it('does not prompt again by itself when the retry is refused too', async () => {
    get.mockResolvedValue(refused('mfa_required'));
    mfa.openMfa.mockImplementation((_mode, opts: { onVerified: () => void }) => opts.onVerified());
    await mount();
    expect(
      await screen.findByText(/Costs are shown only to a session verified with your second factor/)
    ).toBeVisible();
    await waitFor(() => expect(costCalls()).toHaveLength(2));
    expect(mfa.openMfa).toHaveBeenCalledTimes(1);
    // Asking again is the person's choice.
    mfa.openMfa.mockReset();
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(mfa.openMfa).toHaveBeenCalledTimes(1);
  });

  it('leaves a dismissed prompt as a notice, with no retry', async () => {
    get.mockResolvedValue(refused('mfa_required'));
    await mount();
    expect(await screen.findByRole('button', { name: 'Verify' })).toBeVisible();
    expect(mfa.openMfa).toHaveBeenCalledTimes(1);
    expect(costCalls()).toHaveLength(1);
    expect(screen.queryByTestId('known-usage')).toBeNull();
  });

  it('shows any other refusal as the API worded it', async () => {
    get.mockResolvedValue(refused('insufficient_scope'));
    await mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('insufficient_scope detail');
    expect(mfa.openMfa).not.toHaveBeenCalled();
  });
});

describe('in a company workspace', () => {
  it('says the breakdown is personal-only and reads nothing', async () => {
    await mount(<CostBreakdownPersonalOnly label="Acme" />);
    expect(
      screen.getByText(/There is no cost breakdown for an organization, so none is shown for Acme/)
    ).toBeVisible();
    expect(screen.getByText(/Your personal costs are not shown in its place/)).toBeVisible();
    expect(costCalls()).toHaveLength(0);
  });
});
