import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { BACKFILL_MAX_PAGES } from '@/lib/api/billing-identity';
import { InvoiceSource } from './invoice-source';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

const ok = (data: unknown, status = 200) => ({
  data,
  response: new Response(null, { status }),
});
const problem = (status: number, code: string, detail = `${code} detail`) => ({
  error: { status, code, title: code, detail },
  response: new Response(null, { status }),
});

const live = {
  mode: 'live',
  enabled: true,
  provider: 'stripe',
  plan: 'pro',
  account_status: 'active',
  customer_configured: true,
  subscription_configured: true,
  usage_reconciliation_enabled: false,
};

let status: Record<string, unknown>;
let client: QueryClient;
let backfills: (Record<string, string> | undefined)[];

function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InvoiceSource />
    </QueryClientProvider>
  );
}

function backfillPages(pages: Record<string, unknown>[]) {
  spyApi('POST').mockImplementation(async (path, init) => {
    expect(path).toBe('/v1/invoices/backfill');
    const query = (init as { params?: { query?: Record<string, string> } })?.params?.query;
    backfills.push(query);
    const page = pages[Math.min(backfills.length - 1, pages.length - 1)];
    return ok(page) as never;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  status = { ...live };
  backfills = [];
  mocks.toast.mockReset();
  spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/billing/status') return ok(status) as never;
    throw new Error(`Unexpected GET ${path}`);
  });
});

describe('InvoiceSource', () => {
  it('summarises a live provider attachment in one line', async () => {
    mount();
    expect(await screen.findByText('Billed through Stripe')).toBeInTheDocument();
    expect(screen.getByText('Customer linked')).toBeInTheDocument();
    expect(screen.getByText('Subscription attached')).toBeInTheDocument();
    expect(screen.getByText('Usage reconciliation off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh invoices' })).toBeEnabled();
  });

  it('says billing is off and offers no provider action when the deployment disables it', async () => {
    status = { ...live, mode: 'disabled', enabled: false, usage_reconciliation_enabled: false };
    mount();
    expect(await screen.findByText(/Billing is off on this deployment/)).toBeInTheDocument();
    expect(screen.queryByText('Customer linked')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh invoices' })).not.toBeInTheDocument();
  });

  it('withholds the refresh until a provider customer exists', async () => {
    status = { ...live, customer_configured: false, subscription_configured: false };
    mount();
    expect(await screen.findByText('No billing customer yet')).toBeInTheDocument();
    expect(screen.getByText('No subscription')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh invoices' })).not.toBeInTheDocument();
  });

  it('flags an account whose payment is past due', async () => {
    status = { ...live, account_status: 'past_due', usage_reconciliation_enabled: true };
    mount();
    expect(await screen.findByText('Payment past due')).toBeInTheDocument();
    expect(screen.getByText('Usage reconciled')).toBeInTheDocument();
  });

  it('walks the provider history pages, reports the totals and refreshes the list', async () => {
    backfillPages([
      {
        provider: 'stripe',
        scanned: 25,
        imported: 3,
        skipped: 22,
        has_more: true,
        next_cursor: 'c1',
      },
      { provider: 'stripe', scanned: 4, imported: 1, skipped: 3, has_more: false },
    ]);
    const user = userEvent.setup();
    mount();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await user.click(await screen.findByRole('button', { name: 'Refresh invoices' }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(backfills).toEqual([{}, { cursor: 'c1' }]);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        title: '4 invoices imported',
        description: expect.stringContaining('25 already stored'),
      })
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invoices'] });
  });

  it('says when nothing was missing', async () => {
    backfillPages([{ provider: 'stripe', scanned: 6, imported: 0, skipped: 6, has_more: false }]);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Refresh invoices' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'Invoices are up to date' })
      )
    );
  });

  it('stops at the page budget and resumes from the cursor on the next refresh', async () => {
    backfillPages(
      Array.from({ length: BACKFILL_MAX_PAGES + 1 }, (_, i) => ({
        provider: 'stripe',
        scanned: 25,
        imported: 0,
        skipped: 25,
        has_more: true,
        next_cursor: `c${i + 1}`,
      }))
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Refresh invoices' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(backfills).toHaveLength(BACKFILL_MAX_PAGES);
    expect(mocks.toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/more provider history/i) })
    );

    await user.click(screen.getByRole('button', { name: 'Continue refreshing invoices' }));
    await waitFor(() => expect(backfills.length).toBeGreaterThan(BACKFILL_MAX_PAGES));
    expect(backfills[BACKFILL_MAX_PAGES]).toEqual({ cursor: `c${BACKFILL_MAX_PAGES}` });
  });

  it('reports a provider that cannot discover history', async () => {
    spyApi('POST').mockResolvedValue(
      problem(
        501,
        'not_implemented',
        'The active billing provider does not support invoice history discovery.'
      ) as never
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Refresh invoices' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'error',
          description: 'The active billing provider does not support invoice history discovery.',
        })
      )
    );
  });

  it('shows a failed status read inline, without a refresh action', async () => {
    spyApi('GET').mockResolvedValue(problem(403, 'insufficient_scope') as never);
    mount();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh invoices' })).not.toBeInTheDocument();
  });
});
