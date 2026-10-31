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

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
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

beforeEach(() => {
  reads = [];
  spyApi('GET').mockImplementation(async (path, options) => {
    const query = (options as { params?: { query?: { before?: string; limit?: number } } })?.params
      ?.query;
    reads.push(`${path}:${JSON.stringify(query ?? {})}`);
    if (path === '/v1/invoices') {
      return {
        data: query?.before
          ? { items: [olderInvoice], next_before: null }
          : { items: [invoice], next_before: 'invoice-cursor-1' },
        response: new Response(),
      } as never;
    }
    if (path === '/v1/billing/status') {
      return {
        data: {
          mode: 'live',
          enabled: true,
          provider: 'stripe',
          plan: 'pro',
          account_status: 'active',
          customer_configured: true,
          subscription_configured: true,
          usage_reconciliation_enabled: false,
        },
        response: new Response(),
      } as never;
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
    expect(reads).not.toContain('/v1/billing/status');
    expect(reads).not.toContain('/v1/account');
  } finally {
    workspace.org = null;
    workspace.label = 'Personal';
  }
});
