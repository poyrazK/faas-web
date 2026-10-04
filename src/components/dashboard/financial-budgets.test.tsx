import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancialBudget } from '@/lib/api/financial';

const methods = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account' } }) }));
vi.mock('@/lib/api/client', async (original) => ({ ...(await original<object>()), api: methods }));
const { FinancialBudgetsPanel } = await import('./financial-budgets');
const { parseFinancialMoney } = await import('@/lib/api/financial');

function policy(): FinancialBudget {
  return {
    id: '6dc4f678-5766-4a06-a061-845c2b133fdd',
    account_id: 'account',
    revision: 7,
    spec: {
      name: 'Preview guard',
      scope: { kind: 'account' },
      currency: 'EUR',
      meters: ['compute'],
      basis: 'net_usage',
      limit_millicents: 1000000,
      notify_millicents: [800000],
      mode: 'monitored',
      action: 'stop_previews',
      drain_seconds: 30,
      resume_rule: 'manual',
      enabled: false,
    },
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    status: 'draft',
    enforcement_ready: false,
    reasons: ['enforcement_integration_pending'],
  };
}
function ok(data: unknown) {
  return Promise.resolve({ data, response: new Response() });
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <FinancialBudgetsPanel />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  Object.values(methods).forEach((method) => method.mockReset());
  methods.GET.mockImplementation(() => ok({ budgets: [] }));
});

describe('scoped budget drafts', () => {
  it('previews consequences and saves exact money as disabled intent', async () => {
    const user = userEvent.setup();
    methods.POST.mockImplementation((path, options) => {
      const spec = options.body.spec;
      if (path.endsWith('/preview'))
        return ok({
          spec,
          known_millicents: 75,
          coverage_complete: false,
          fresh: true,
          enforcement_ready: false,
          reasons: ['compute:missing_scope_attribution'],
          targets: [{ kind: 'app', id: 'a', name: 'Selected preview', effect: 'stop' }],
          continuing_targets: [
            { kind: 'app', id: 'b', name: 'Critical production', effect: 'compute_can_continue' },
          ],
        });
      const saved = { ...policy(), spec };
      methods.GET.mockImplementation(() => ok({ budgets: [saved] }));
      return ok(saved);
    });
    mount();
    expect(await screen.findByText('No budget drafts saved.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New budget draft' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Budget name'), 'New preview guard');
    await user.clear(within(dialog).getByLabelText('Monthly limit (EUR)'));
    await user.type(within(dialog).getByLabelText('Monthly limit (EUR)'), '123.00001');
    await user.clear(within(dialog).getByLabelText('Notify at (EUR, comma separated)'));
    await user.type(within(dialog).getByLabelText('Notify at (EUR, comma separated)'), '8');
    await user.click(within(dialog).getByRole('button', { name: 'Preview response' }));
    expect(await within(dialog).findByText('Selected preview · Stop previews')).toBeInTheDocument();
    expect(within(dialog).getByText('Critical production')).toBeInTheDocument();
    expect(within(dialog).getByText(/Partial coverage/)).toBeInTheDocument();
    expect(
      within(dialog).getByText('Some recorded usage cannot be attributed to this scope.')
    ).toBeInTheDocument();
    expect(methods.POST.mock.calls[0][1].body.spec).toMatchObject({
      enabled: true,
      limit_millicents: 12300001,
      notify_millicents: [800000],
    });
    await user.click(within(dialog).getByRole('button', { name: 'Save disabled draft' }));
    await screen.findByText(/saved as a draft. Spending protection is unavailable/);
    expect(methods.POST.mock.calls[1][0]).toBe('/v1/billing/budgets');
    expect(methods.POST.mock.calls[1][1]).toMatchObject({
      body: { spec: { enabled: false, limit_millicents: 12300001 } },
      params: { header: { 'Idempotency-Key': expect.any(String) } },
    });
    await screen.findByRole('button', { name: 'Edit New preview guard' });
  });

  it('keeps a failed revision edit open, preserves the retry key, and sends no fallback creation', async () => {
    methods.GET.mockImplementation(() => ok({ budgets: [policy()] }));
    methods.PUT.mockImplementation(() =>
      Promise.resolve({
        error: {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          code: 'conflict',
          detail: 'Read the current policy before retrying.',
        },
        response: new Response(null, { status: 409 }),
      })
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit Preview guard' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save disabled draft' }));
    await within(dialog).findByRole('alert');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(methods.PUT.mock.calls[0][1].body.expected_revision).toBe(7);
    expect(methods.PUT.mock.calls[0][1].body.spec.enabled).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Save disabled draft' }));
    await waitFor(() => expect(methods.PUT).toHaveBeenCalledTimes(2));
    expect(methods.PUT.mock.calls[0][1].params.header).toEqual(
      methods.PUT.mock.calls[1][1].params.header
    );
    expect(methods.POST).not.toHaveBeenCalled();
  });

  it('retains history after deletion and walks its revision cursor', async () => {
    const budget = policy();
    methods.GET.mockImplementation((path, options) => {
      if (path.endsWith('/revisions')) {
        const after = options.params.query.after_revision;
        return ok({
          revisions: [
            {
              policy_id: budget.id,
              revision: after ? 101 : 1,
              actor: 'account:human',
              mutation: after ? 'deleted' : 'created',
              spec: budget.spec,
              recorded_at: budget.updated_at,
            },
          ],
          ...(after ? {} : { next_revision: 100 }),
        });
      }
      return ok({ budgets: [budget] });
    });
    methods.DELETE.mockImplementation(() =>
      ok({ ...budget, status: 'deleted', revision: 8, deleted_at: budget.updated_at })
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Delete draft' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/Revision 1 · created/);
    expect(methods.DELETE.mock.calls[0][1].body).toEqual({ expected_revision: 7 });
    await user.click(within(dialog).getByRole('button', { name: 'Next revisions' }));
    await within(dialog).findByText(/Revision 101 · deleted/);
    expect(methods.GET).toHaveBeenLastCalledWith('/v1/billing/budgets/{id}/revisions', {
      params: { path: { id: budget.id }, query: { after_revision: 100, limit: 100 } },
      signal: expect.any(AbortSignal),
    });
    expect(
      within(dialog).getByText(/does not establish that a workload stopped/)
    ).toBeInTheDocument();
  });

  it('rejects overprecision and unsafe amounts before calling the preview API', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('No budget drafts saved.');
    await user.click(screen.getByRole('button', { name: 'New budget draft' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Budget name'), 'Precision');
    await user.clear(within(dialog).getByLabelText('Monthly limit (EUR)'));
    await user.type(within(dialog).getByLabelText('Monthly limit (EUR)'), '1.000001');
    await user.click(within(dialog).getByRole('button', { name: 'Preview response' }));
    await within(dialog).findByRole('alert');
    expect(methods.POST).not.toHaveBeenCalled();
    expect(parseFinancialMoney('0.00001')).toBe(1);
    expect(parseFinancialMoney('90071992547.40991')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseFinancialMoney('90071992547.40992')).toBeUndefined();
    expect(parseFinancialMoney('-1')).toBeUndefined();
    expect(parseFinancialMoney('1e3')).toBeUndefined();
  });
});
