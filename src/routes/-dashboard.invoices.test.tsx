import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route as Invoices } from './dashboard.invoices';
import { spyApi } from '@/test/api';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/auth/mfa-provider', () => ({ useMfa: () => ({ openMfa: vi.fn() }) }));
const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));

const invoice = {
  id: 'invoice-1',
  number: 'INV-001',
  provider: 'stripe',
  provider_invoice_id: 'provider-1',
  status: 'paid',
  period_start: '2026-08-01T00:00:00Z',
  period_end: '2026-08-31T23:59:59Z',
  total_cents: 900,
  currency: 'eur',
  created_at: '2026-09-01T00:00:00Z',
};
const olderInvoice = { ...invoice, id: 'invoice-2', number: 'INV-002' };
let reads: string[];

async function mount() {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const route = createRoute({
    getParentRoute: () => dashboard,
    path: 'invoices',
    component: Invoices.options.component,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([route])]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/invoices'] }),
  });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
}

let firstPage: Record<string, unknown>[];
let billingStatus: Record<string, unknown>;

beforeEach(() => {
  reads = [];
  toast.mockReset();
  firstPage = [invoice];
  billingStatus = {
    mode: 'live',
    enabled: true,
    provider: 'stripe',
    plan: 'pro',
    account_status: 'active',
    customer_configured: true,
    subscription_configured: true,
    usage_reconciliation_enabled: false,
  };
  spyApi('GET').mockImplementation(async (path, options) => {
    const query = (options as { params?: { query?: { before?: string; limit?: number } } })?.params
      ?.query;
    reads.push(`${path}:${JSON.stringify(query ?? {})}`);
    if (path === '/v1/invoices') {
      return {
        data: query?.before
          ? { items: [olderInvoice], next_before: null }
          : { items: firstPage, next_before: 'invoice-cursor-1' },
        response: new Response(),
      } as never;
    }
    if (path === '/v1/billing/status') {
      return { data: billingStatus, response: new Response() } as never;
    }
    if (path === '/v1/account') {
      return {
        data: { id: 'acct-1', email: 'design@gregale.dev', business_name: 'Gregale Labs GmbH' },
        response: new Response(),
      } as never;
    }
    throw new Error(`Unexpected GET ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('opens with the state of the invoices in one sentence, statuses in words', async () => {
  firstPage = [{ ...invoice, status: 'open' }];
  await mount();
  expect(await screen.findByRole('status', { name: 'Invoices status' })).toHaveTextContent(
    /^Invoice INV-001 for €9\.00 is awaiting payment\.$/
  );
  expect(screen.getByTitle('open')).toHaveTextContent('Awaiting payment');
});

it('loads older invoices without losing the current page', async () => {
  await mount();
  expect(await screen.findByText('INV-001')).toBeInTheDocument();

  await userEvent.click(await screen.findByRole('button', { name: 'Load older invoices' }));
  expect(await screen.findByText('INV-002')).toBeInTheDocument();
  expect(reads).toContain('/v1/invoices:{"limit":50,"before":"invoice-cursor-1"}');
});

it("says who can see a company's invoices when the member's role cannot", async () => {
  workspace.org = 'acme';
  workspace.label = 'Acme';
  spyApi('GET').mockImplementation(async (path) => {
    reads.push(path);
    return {
      error: { code: 'org_role_forbidden', title: 'Forbidden', status: 403 },
      response: new Response(
        JSON.stringify({ code: 'org_role_forbidden', title: 'Forbidden', status: 403 }),
        { status: 403, headers: { 'content-type': 'application/problem+json' } }
      ),
    } as never;
  });
  try {
    await mount();
    expect(
      await screen.findByText("Only Acme's owners and billing admins can see its invoices.")
    ).toBeInTheDocument();
    // Only company routes: nothing personal is read in a company workspace.
    expect(new Set(reads)).toEqual(
      new Set(['/v1/orgs/{slug}/invoices', '/v1/orgs/{slug}/billing/status'])
    );
    // The list already says who can see billing; the status line adds no second error.
    expect(screen.getAllByText(/owners and billing admins/)).toHaveLength(1);
    // The FOCUS export reads the signed-in account's own costs.
    expect(screen.queryByText(/FOCUS/)).toBeNull();
    // The company portal needs the owner and a fresh step-up (faas
    // server.go:4709, OrgActionChangePlan); it is not offered here yet.
    expect(screen.queryByRole('button', { name: 'Billing portal' })).toBeNull();
    expect(screen.getByText(/Acme's owner opens its billing portal/)).toBeInTheDocument();
  } finally {
    workspace.org = null;
    workspace.label = 'Personal';
  }
});

it('shows where invoices come from, the refresh action and the billing identity', async () => {
  await mount();
  expect(await screen.findByText('Billed through Stripe')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh invoices' })).toBeInTheDocument();
  expect(await screen.findByText('Gregale Labs GmbH')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit billing identity' })).toBeInTheDocument();
});

it("shows a company's billing source without the account-only refresh or identity", async () => {
  workspace.org = 'acme';
  workspace.label = 'Acme';
  spyApi('GET').mockImplementation(async (path) => {
    reads.push(path);
    if (path === '/v1/orgs/{slug}/invoices')
      return { data: { items: [invoice], next_before: null }, response: new Response() } as never;
    if (path === '/v1/orgs/{slug}/billing/status')
      return {
        data: {
          mode: 'live',
          enabled: true,
          provider: 'stripe',
          plan: 'team',
          account_status: 'active',
          customer_configured: true,
          subscription_configured: true,
          usage_reconciliation_enabled: false,
        },
        response: new Response(),
      } as never;
    throw new Error(`Unexpected GET ${path}`);
  });
  try {
    await mount();
    expect(await screen.findByText('Billed through Stripe')).toBeInTheDocument();
    expect(screen.getByText('INV-001')).toBeInTheDocument();
    // Backfill and the billing identity act on the signed-in account only
    // (faas handlers_invoice_backfill.go:98, handlers_billing_identity.go:62).
    expect(screen.queryByRole('button', { name: /refresh invoices/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit billing identity' })).toBeNull();
    // Per-invoice refresh reads the signed-in account's own invoices only;
    // a company's answers 404 (faas handlers_invoice_refresh.go:44).
    expect(screen.queryByRole('button', { name: /Refresh details for/ })).toBeNull();
    expect(reads).not.toContain('/v1/billing/status');
    expect(reads).not.toContain('/v1/account');
  } finally {
    workspace.org = null;
    workspace.label = 'Personal';
  }
});

const problem = (code: string, status: number, detail = code) => ({
  error: { code, title: code, detail, status },
  response: new Response(JSON.stringify({ code, title: code, detail, status }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  }),
});

function refreshReplies(reply: () => unknown) {
  const posts: { path: string; init: unknown }[] = [];
  spyApi('POST').mockImplementation(async (path, init) => {
    posts.push({ path, init });
    return reply() as never;
  });
  return posts;
}

it("refreshes one invoice's provider facts and says its lines are complete", async () => {
  const posts = refreshReplies(() => ({
    data: {
      invoice_id: 'invoice-1',
      provider: 'stripe',
      detailed: true,
      line_items: 12,
      updated_at: '2026-11-03T10:00:00Z',
    },
    response: new Response(),
  }));
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Refresh details for INV-001' }));
  await vi.waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        title: 'INV-001 refreshed from Stripe',
        description:
          '12 line items, complete and reconciled. Amounts and payment state are unchanged.',
      })
    )
  );
  expect(posts).toEqual([
    { path: '/v1/invoices/{id}/refresh', init: { params: { path: { id: 'invoice-1' } } } },
  ]);
  // The list is read again so any lifecycle change shows.
  expect(reads.filter((r) => r.startsWith('/v1/invoices:'))).toHaveLength(2);
});

it('names the gap when the provider lines cannot be reconciled', async () => {
  refreshReplies(() => ({
    data: {
      invoice_id: 'invoice-1',
      provider: 'stripe',
      detailed: false,
      line_items: 3,
      source_gap: 'totals_mismatch',
      updated_at: '2026-11-03T10:00:00Z',
    },
    response: new Response(),
  }));
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Refresh details for INV-001' }));
  await vi.waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'info',
        description:
          "3 line items, but they do not add up to the invoice's total, so it is kept as one total. Amounts and payment state are unchanged.",
      })
    )
  );
});

it.each([
  ['not_implemented', 501, 'Your billing provider does not support refreshing invoice details.'],
  [
    'conflict',
    409,
    "The invoice changed while it was refreshing, or the provider's copy no longer matches it. Try again in a moment.",
  ],
  ['not_found', 404, 'This invoice is no longer in your billing history.'],
  [
    'capacity_unavailable',
    503,
    'The provider could not be reached, so the invoice was not changed. Try again later.',
  ],
])('explains %s by its code', async (code, status, description) => {
  refreshReplies(() => problem(code, status, 'prose that may change'));
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Refresh details for INV-001' }));
  await vi.waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', title: 'Could not refresh INV-001', description })
    )
  );
});

it('passes the limit through when an invoice is too large to refresh', async () => {
  refreshReplies(() =>
    problem('validation_failed', 422, 'invoice refresh exceeds 1000 line items')
  );
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Refresh details for INV-001' }));
  await vi.waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        description: 'invoice refresh exceeds 1000 line items',
      })
    )
  );
});

it('offers refresh only where apid can answer it', async () => {
  // Another provider's invoice answers 409 (handlers_invoice_refresh.go:58).
  firstPage = [invoice, { ...invoice, id: 'invoice-3', number: 'INV-003', provider: 'paddle' }];
  await mount();
  expect(
    await screen.findByRole('button', { name: 'Refresh details for INV-001' })
  ).toBeInTheDocument();
  expect(screen.getByText('INV-003')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Refresh details for INV-003' })).toBeNull();
});

it.each([
  ['billing is off', { enabled: false, mode: 'disabled' }],
  ['no provider customer is linked', { customer_configured: false }],
])('offers no refresh when %s', async (_, patch) => {
  billingStatus = { ...billingStatus, ...patch };
  await mount();
  expect(await screen.findByText('INV-001')).toBeInTheDocument();
  await screen.findByText(/Billed through|Billing is off/);
  expect(screen.queryByRole('button', { name: /Refresh details for/ })).toBeNull();
});
