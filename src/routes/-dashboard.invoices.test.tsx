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
    expect(reads).toEqual(['/v1/orgs/{slug}/invoices']);
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
