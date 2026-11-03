import { act, render, screen, waitFor, within } from '@testing-library/react';
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
import { beforeEach, expect, it, vi } from 'vitest';
import { bindWorkspaceAccount, setActiveOrg } from '@/lib/workspace';
import { api } from '@/lib/api/client';
import { Route as Plans } from './dashboard.plans';
import { Route as Usage } from './dashboard.usage';
import { mockedApi, spyApi } from '@/test/api';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    account: {
      plan: 'pro',
      app_count: 1,
      limits: { deployed_apps: 25, ram_mb: 2048, included_gb_hours: 100 },
    },
    refreshAccount: vi.fn(),
  }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/auth/mfa-provider', () => ({ useMfa: () => ({ openMfa: vi.fn() }) }));
vi.mock('@/components/dashboard/object-storage-usage', () => ({
  ObjectStorageUsagePanel: () => null,
}));
let cap: number | null;
let readFails: boolean;
beforeEach(() => {
  // The shell binds the workspace to the signed-in account; these pages wait for it.
  bindWorkspaceAccount('account-spend-cap');
  cap = 1000;
  readFails = false;
  spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/account/overage-cap') {
      if (readFails) throw new Error('Cap read unavailable');
      return { data: { overage_cap_cents: cap }, response: new Response() } as never;
    }
    const compute = {
      month: '2026-09',
      used_gb_hours: 1,
      included_gb_hours: 100,
      overage_gb_hours: 0,
      overage_cents: 0,
    };
    const data =
      path === '/v1/usage/summary'
        ? compute
        : path === '/v1/account/usage'
          ? { month: '2026-09', compute }
          : path === '/v1/billing/forecast'
            ? {
                period_start: '2026-09-01T00:00:00Z',
                period_end: '2026-10-01T00:00:00Z',
                as_of: '2026-09-15T00:00:00Z',
                currency: 'EUR',
                meters: [],
                bill_estimate_available: false,
                missing_bill_components: [],
              }
            : path === '/v1/audit-events'
              ? { events: [], limit: 20 }
              : path === '/v1/billing/costs'
                ? {
                    account_id: 'acct-1',
                    currency: 'USD',
                    period_start: '2026-09-01T00:00:00Z',
                    period_end: '2026-10-01T00:00:00Z',
                    as_of: '2026-09-15T00:00:00Z',
                    retained_from: '2026-09-01T00:00:00Z',
                    evidence_through_id: 1,
                    known_usage_millicents: 0,
                    meters: [],
                    scope: 'retained_compute_and_interface_egress',
                    invoices: [],
                    invoice_reconciliation: 'not_reconciled',
                    missing_bill_components: [],
                  }
                : [];
    return { data, response: new Response() } as never;
  });
  spyApi('POST').mockImplementation(async (path, options) => {
    if (path !== '/v1/account/overage-cap') throw new Error('Unexpected write');
    cap = (options as unknown as { body: { overage_cap_cents: number | null } }).body
      .overage_cap_cents;
    return { data: { id: 'acct-1' }, response: new Response() } as never;
  });
});
async function mount(
  entry = '/dashboard/usage',
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
) {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const routes = [Usage, Plans].map((route, i) =>
    createRoute({
      getParentRoute: () => dashboard,
      path: ['usage', 'plans'][i],
      component: route.options.component,
    })
  );
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren(routes)]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  return router;
}
it('shows the cap standing on Usage and edits the cap in a modal', async () => {
  await mount();
  expect(await screen.findByText('$0.00 of $10.00 overage used.')).toBeInTheDocument();
  expect(screen.getByText('Within the cap')).toBeInTheDocument();
  expect(screen.queryByRole('spinbutton', { name: 'Cap (USD)' })).not.toBeInTheDocument();
  const manage = screen.getByRole('button', { name: 'Change cap' });
  await userEvent.click(manage);
  expect(
    within(screen.getByRole('dialog', { name: 'Spend cap' })).getByRole('spinbutton', {
      name: 'Cap (USD)',
    })
  ).toHaveValue(10);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(manage).toHaveFocus();
});
it('edits the same cap on Plans and reflects it back on Usage', async () => {
  const router = await mount('/dashboard/plans');
  const input = await screen.findByRole('spinbutton', { name: 'Cap (USD)' });
  expect(input).toHaveValue(10);
  await userEvent.clear(input);
  await userEvent.type(input, '12.50');
  await userEvent.click(screen.getByRole('button', { name: 'Set cap' }));
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith('/v1/account/overage-cap', {
      body: { overage_cap_cents: 1250 },
    })
  );
  await act(async () => {
    await router.navigate({ to: '/dashboard/usage' });
  });
  expect(await screen.findByText('$0.00 of $12.50 overage used.')).toBeInTheDocument();
});
it('distinguishes zero overage from no cap and updates after clearing', async () => {
  cap = 0;
  await mount();
  expect(await screen.findByText('Workloads paused')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Change cap' }));
  await userEvent.click(screen.getByRole('button', { name: 'Clear cap' }));
  expect(await screen.findByText('No cap')).toBeInTheDocument();
  expect(api.POST).toHaveBeenCalledWith('/v1/account/overage-cap', {
    body: { overage_cap_cents: null },
  });
});
it('does not claim there is no cap when reading fails and permits retry', async () => {
  readFails = true;
  await mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Cap read unavailable');
  expect(screen.queryByText('No cap')).not.toBeInTheDocument();
  readFails = false;
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('$0.00 of $10.00 overage used.')).toBeInTheDocument();
});

it('refreshes a pristine cached editor but preserves an unsaved draft', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(['account', 'overage-cap'], { overage_cap_cents: 1000 });
  cap = 0;
  await mount('/dashboard/plans', client);
  expect(await screen.findByText('$0.00 · Workloads paused')).toBeInTheDocument();
  const input = screen.getByRole('spinbutton', { name: 'Cap (USD)' });
  expect(input).toHaveValue(0);
  await userEvent.clear(input);
  await userEvent.type(input, '5.50');
  cap = 2500;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['account', 'overage-cap'] });
  });
  expect(await screen.findByText('$25.00')).toBeInTheDocument();
  expect(input).toHaveValue(5.5);
});

it('keeps the saved cap and draft unchanged when saving fails', async () => {
  await mount('/dashboard/plans');
  const input = await screen.findByRole('spinbutton', { name: 'Cap (USD)' });
  await userEvent.clear(input);
  await userEvent.type(input, '5.50');
  mockedApi('POST').mockRejectedValueOnce(new Error('Save unavailable'));
  await userEvent.click(screen.getByRole('button', { name: 'Set cap' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
  expect(screen.getByText('$10.00')).toBeInTheDocument();
  expect(input).toHaveValue(5.5);
});

it("a company workspace reads and writes the organization's cap on Plans and Usage, never the account's", async () => {
  // ADR-20261030093512: an organization that owns its resources is capped
  // apart from its members, so its pages must never touch the personal cap.
  setActiveOrg('acme');
  const touched: string[] = [];
  let orgCap: number | null = 1000;
  const ok = (data: unknown) => ({ data, response: new Response() }) as never;
  spyApi('GET').mockImplementation(async (path) => {
    touched.push(`GET ${path}`);
    if (path === '/v1/orgs') return ok({ orgs: [{ slug: 'acme', name: 'Acme', personal: false }] });
    if (path === '/v1/orgs/{slug}/overage-cap') return ok({ overage_cap_cents: orgCap });
    if (path === '/v1/orgs/{slug}/billing/status') return ok({ plan: 'pro' });
    if (path === '/v1/orgs/{slug}/usage') return ok([]);
    if (path === '/v1/orgs/{slug}/apps') return ok({ apps: [] });
    throw new Error(`Unexpected GET ${path}`);
  });
  spyApi('POST').mockImplementation(async (path, options) => {
    touched.push(`POST ${path}`);
    orgCap = (options as unknown as { body: { overage_cap_cents: number | null } }).body
      .overage_cap_cents;
    return ok({ overage_cap_cents: orgCap });
  });
  try {
    const router = await mount('/dashboard/plans');
    expect(await screen.findByText("Acme's spend cap")).toBeInTheDocument();
    const input = await screen.findByRole('spinbutton', { name: 'Cap (USD)' });
    expect(input).toHaveValue(10);
    await userEvent.clear(input);
    await userEvent.type(input, '40');
    await userEvent.click(screen.getByRole('button', { name: 'Set cap' }));
    await waitFor(() => expect(touched).toContain('POST /v1/orgs/{slug}/overage-cap'));
    await act(async () => {
      await router.navigate({ to: '/dashboard/usage' });
    });
    expect(await screen.findByText('$40.00')).toBeInTheDocument();
    expect(touched.filter((t) => t.includes('/v1/account/'))).toEqual([]);
    expect(touched).not.toContain('GET /v1/audit-events');
    expect(touched).not.toContain('GET /v1/billing/forecast');
    expect(touched).not.toContain('GET /v1/billing/costs');
  } finally {
    setActiveOrg(null);
  }
});
