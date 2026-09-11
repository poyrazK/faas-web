import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { Route as Domains } from './dashboard.domains';

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
let empty: boolean;
let doctorFails: boolean;
let noApps: boolean;
let appFails: boolean;
beforeEach(() => {
  empty = doctorFails = noApps = appFails = false;
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/v1/domains/{domain}/doctor' && doctorFails) throw new Error('DNS probe offline');
    if (path === '/v1/apps' && appFails) throw new Error('App lookup offline');
    const data =
      path === '/v1/apps'
        ? noApps
          ? []
          : [{ id: 'app-1', slug: 'api' }]
        : path === '/v1/domains'
          ? empty
            ? []
            : [
                {
                  domain: 'alpha.example.com',
                  app_id: 'app-1',
                  verified: false,
                  txt_record: 'verify-alpha',
                },
                { domain: 'beta.example.com', app_id: 'app-1', verified: true },
              ]
          : { checks: [], stale: true, observed_at: '2026-09-11T00:00:00Z' };
    return { data, response: new Response() } as never;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function mount(
  entry = '/dashboard/domains',
  cachedEmptyApps = false,
  previousEntry?: string
) {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const route = createRoute({
    getParentRoute: () => dashboard,
    path: 'domains',
    component: Domains.options.component,
    validateSearch: Domains.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([route])]),
    history: createMemoryHistory({
      initialEntries: previousEntry ? [previousEntry, entry] : [entry],
    }),
  });
  await router.load();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  if (cachedEmptyApps) client.setQueryData(['apps'], []);
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  return router;
}

describe('Domains operational state', () => {
  it('does not turn a failed app refresh with cached emptiness into a create-app suggestion', async () => {
    empty = noApps = appFails = true;
    await mount('/dashboard/domains', true);
    expect(await screen.findByRole('alert')).toHaveTextContent('App lookup offline');
    expect(screen.queryByRole('link', { name: 'Create an app' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add domain' })).toBeDisabled();
  });
  it('shows and retries the failed app lookup before enabling domain creation', async () => {
    appFails = true;
    await mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('App lookup offline');
    expect(screen.getByRole('button', { name: 'Add domain' })).toBeDisabled();
    appFails = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add domain' })).toBeEnabled());
  });
  it('restores search, verification status and doctor through copied URLs and Back/Forward', async () => {
    const router = await mount('/dashboard/domains?q=example&status=pending&campaign=handoff#dns');
    const query = screen.getByRole('searchbox');
    expect(query).toHaveValue('example');
    expect(screen.getByRole('combobox', { name: 'Domain status' })).toHaveValue('pending');
    expect(await screen.findByText('alpha.example.com')).toBeInTheDocument();
    expect(screen.queryByText('beta.example.com')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Diagnose alpha.example.com' }));
    expect(
      await screen.findByRole('heading', { name: 'Doctor — alpha.example.com' })
    ).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({
      q: 'example',
      status: 'pending',
      doctor: 'alpha.example.com',
      campaign: 'handoff',
    });
    expect(router.state.location.hash).toBe('dns');
    const copied = router.state.location.href;
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(router.state.location.search.doctor).toBeUndefined();
    await act(async () => router.history.back());
    expect(
      await screen.findByRole('heading', { name: 'Doctor — alpha.example.com' })
    ).toBeInTheDocument();
    await act(async () => router.history.back());
    await act(async () => router.history.forward());
    expect(
      await screen.findByRole('heading', { name: 'Doctor — alpha.example.com' })
    ).toBeInTheDocument();
    cleanup();
    await mount(copied);
    expect(screen.getByRole('searchbox')).toHaveValue('example');
    expect(
      await screen.findByRole('heading', { name: 'Doctor — alpha.example.com' })
    ).toBeInTheDocument();
  });

  it('skips sequential text edits on Back while retaining status steps and foreign URL context', async () => {
    const router = await mount(
      '/dashboard/domains?status=pending&campaign=handoff#dns',
      false,
      '/dashboard'
    );
    for (const query of ['a', 'al', 'alp', 'alph', 'alpha']) {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
      await waitFor(() => expect(router.state.location.search.q).toBe(query));
      expect(router.state.location.search).toMatchObject({
        status: 'pending',
        campaign: 'handoff',
      });
      expect(router.state.location.hash).toBe('dns');
    }
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Domain status' }),
      'verified'
    );
    expect(router.state.location.search.status).toBe('verified');
    await act(async () => router.history.back());
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Domain status' })).toHaveValue('pending')
    );
    expect(screen.getByRole('searchbox')).toHaveValue('alpha');
    await act(async () => router.history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    await act(async () => router.history.forward());
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('alpha'));
    expect(router.state.location.search).toMatchObject({ status: 'pending', campaign: 'handoff' });
    expect(router.state.location.hash).toBe('dns');
  });

  it('offers an actionable empty state that focuses the add form', async () => {
    empty = true;
    await mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add your first domain' }));
    expect(screen.getByRole('textbox', { name: 'Hostname' })).toHaveFocus();
  });

  it('directs accounts without apps to create one before adding a domain', async () => {
    empty = noApps = true;
    await mount();
    expect(await screen.findByRole('link', { name: 'Create an app' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/new'
    );
    expect(screen.getByRole('button', { name: 'Add domain' })).toBeDisabled();
  });

  it('keeps TXT evidence available in compact details and exposes operational tooltips', async () => {
    await mount();
    expect(await screen.findByRole('columnheader', { name: 'TXT record' })).toHaveClass(
      'hidden',
      'md:table-cell'
    );
    await userEvent.click(screen.getByText('More details for alpha.example.com'));
    expect(screen.getAllByText('verify-alpha')).toHaveLength(2);
    await userEvent.hover(screen.getByRole('button', { name: 'Diagnose alpha.example.com' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Diagnose alpha.example.com');
  });

  it('shows the actual doctor error and retries it', async () => {
    doctorFails = true;
    await mount('/dashboard/domains?doctor=alpha.example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent('DNS probe offline');
    doctorFails = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('Cached reading was stale, so this was re-probed just now.')
    ).toBeInTheDocument();
  });
});
