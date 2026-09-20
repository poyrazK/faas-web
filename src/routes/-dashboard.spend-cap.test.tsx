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
import { api } from '@/lib/api/client';
import { Route as Plans } from './dashboard.plans';
import { Route as Usage } from './dashboard.usage';

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
vi.mock('@/components/dashboard/object-storage-usage', () => ({
  ObjectStorageUsagePanel: () => null,
}));
let cap: number | null;
let readFails: boolean;
beforeEach(() => {
  cap = 1000;
  readFails = false;
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/v1/account/overage-cap') {
      if (readFails) throw new Error('Cap read unavailable');
      return { data: { overage_cap_cents: cap }, response: new Response() } as never;
    }
    return {
      data:
        path === '/v1/usage/summary'
          ? { month: '2026-09', used_gb_hours: 1, included_gb_hours: 100, overage_gb_hours: 0 }
          : [],
      response: new Response(),
    } as never;
  });
  vi.spyOn(api, 'POST').mockImplementation(async (path, options) => {
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
it('keeps Usage compact and opens the current cap in a modal', async () => {
  await mount();
  expect(await screen.findByText('€10.00')).toBeInTheDocument();
  expect(screen.queryByRole('spinbutton', { name: 'Cap (EUR)' })).not.toBeInTheDocument();
  const manage = screen.getByRole('button', { name: 'Manage spend cap' });
  await userEvent.click(manage);
  expect(
    within(screen.getByRole('dialog', { name: 'Spend cap' })).getByRole('spinbutton', {
      name: 'Cap (EUR)',
    })
  ).toHaveValue(10);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(manage).toHaveFocus();
});
it('edits the same cap on Plans and reflects it back on Usage', async () => {
  const router = await mount('/dashboard/plans');
  const input = await screen.findByRole('spinbutton', { name: 'Cap (EUR)' });
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
  expect(await screen.findByText('€12.50')).toBeInTheDocument();
});
it('distinguishes zero overage from no cap and updates after clearing', async () => {
  cap = 0;
  await mount();
  expect(await screen.findByText('€0.00 · No overage allowed')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Manage spend cap' }));
  await userEvent.click(screen.getByRole('button', { name: 'Clear cap' }));
  expect(await screen.findByText('No cap set')).toBeInTheDocument();
  expect(api.POST).toHaveBeenCalledWith('/v1/account/overage-cap', {
    body: { overage_cap_cents: null },
  });
});
it('does not claim there is no cap when reading fails and permits retry', async () => {
  readFails = true;
  await mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Cap read unavailable');
  expect(screen.queryByText('No cap set')).not.toBeInTheDocument();
  readFails = false;
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('€10.00')).toBeInTheDocument();
});

it('refreshes a pristine cached editor but preserves an unsaved draft', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(['account', 'overage-cap'], { overage_cap_cents: 1000 });
  cap = 0;
  await mount('/dashboard/plans', client);
  expect(await screen.findByText('€0.00 · No overage allowed')).toBeInTheDocument();
  const input = screen.getByRole('spinbutton', { name: 'Cap (EUR)' });
  expect(input).toHaveValue(0);
  await userEvent.clear(input);
  await userEvent.type(input, '5.50');
  cap = 2500;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['account', 'overage-cap'] });
  });
  expect(await screen.findByText('€25.00')).toBeInTheDocument();
  expect(input).toHaveValue(5.5);
});

it('keeps the saved cap and draft unchanged when saving fails', async () => {
  await mount('/dashboard/plans');
  const input = await screen.findByRole('spinbutton', { name: 'Cap (EUR)' });
  await userEvent.clear(input);
  await userEvent.type(input, '5.50');
  vi.mocked(api.POST).mockRejectedValueOnce(new Error('Save unavailable'));
  await userEvent.click(screen.getByRole('button', { name: 'Set cap' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
  expect(screen.getByText('€10.00')).toBeInTheDocument();
  expect(input).toHaveValue(5.5);
});
