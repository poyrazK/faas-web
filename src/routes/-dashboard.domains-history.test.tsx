import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { Route as Domains } from './dashboard.domains';
import { spyApi } from '@/test/api';

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
const doctor = vi.hoisted(() => ({ access: 'on' }));
// The add form's plan gate and environment choice (domain-add-form.tsx).
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1', plan: 'pro' } }) }));
vi.mock('@/lib/api/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/projects')>()),
  useProjectMembership: () => ({
    projectOfApp: new Map(),
    state: 'ready',
    list: { error: null },
    details: [],
    retry: () => {},
  }),
  useProjectEnvironments: () => ({
    data: undefined,
    isPending: true,
    error: null,
    refetch: () => {},
  }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: doctor.access, refresh: () => {} }),
}));
let empty: boolean;
let doctorFails: boolean;
let noApps: boolean;
let appFails: boolean;
let betaDefault: boolean;
beforeEach(() => {
  empty = doctorFails = noApps = appFails = betaDefault = false;
  spyApi('GET').mockImplementation(async (path) => {
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
                {
                  domain: 'beta.example.com',
                  app_id: 'app-1',
                  verified: true,
                  default: betaDefault,
                },
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
  it('marks the domain that is already its app default', async () => {
    betaDefault = true;
    await mount();
    const beta = await screen.findByRole('article', { name: 'beta.example.com' });
    const alpha = screen.getByRole('article', { name: 'alpha.example.com' });
    expect(within(beta).getByText('Main address')).toHaveAttribute(
      'title',
      expect.stringContaining('Default domain')
    );
    expect(within(alpha).queryByText('Main address')).not.toBeInTheDocument();
  });
  it('offers no Diagnose action when the domain doctor is not enabled for the account', async () => {
    doctor.access = 'off';
    try {
      await mount('/dashboard/domains');
      expect(await screen.findByText('alpha.example.com')).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: 'More actions for alpha.example.com' })
      );
      expect(await screen.findByRole('menuitem', { name: /Remove domain/ })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Diagnose/ })).toBeNull();
    } finally {
      doctor.access = 'on';
    }
  });

  it('opens diagnostics in a modal and restores focus and filters on Escape', async () => {
    const router = await mount('/dashboard/domains?q=alpha&campaign=handoff#dns');
    const trigger = await screen.findByRole('button', {
      name: 'More actions for alpha.example.com',
    });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Diagnose DNS and HTTPS/ }));
    expect(
      await screen.findByRole('dialog', { name: 'Diagnose alpha.example.com' })
    ).toHaveAttribute('aria-modal', 'true');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.search).toMatchObject({ q: 'alpha', campaign: 'handoff' });
    expect(router.state.location.search.doctor).toBeUndefined();
    expect(router.state.location.hash).toBe('dns');
    expect(trigger).toHaveFocus();
  });
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
    await userEvent.click(
      screen.getByRole('button', { name: 'More actions for alpha.example.com' })
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: /Diagnose DNS and HTTPS/ }));
    expect(
      await screen.findByRole('heading', { name: 'Diagnose alpha.example.com' })
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
      await screen.findByRole('heading', { name: 'Diagnose alpha.example.com' })
    ).toBeInTheDocument();
    await act(async () => router.history.back());
    await act(async () => router.history.forward());
    expect(
      await screen.findByRole('heading', { name: 'Diagnose alpha.example.com' })
    ).toBeInTheDocument();
    cleanup();
    await mount(copied);
    expect(screen.getByRole('searchbox')).toHaveValue('example');
    expect(
      await screen.findByRole('heading', { name: 'Diagnose alpha.example.com' })
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
      '/dashboard/apps/new'
    );
    expect(screen.getByRole('button', { name: 'Add domain' })).toBeDisabled();
  });

  it('opens with a plain answer and gives the waiting domain its one next step', async () => {
    await mount();
    expect(
      await screen.findByText('1 domain is verified and routing traffic.')
    ).toBeInTheDocument();
    expect(screen.getByText('1 is waiting for a DNS record.')).toBeInTheDocument();
    const alpha = screen.getByRole('article', { name: 'alpha.example.com' });
    expect(within(alpha).getByText('Waiting for DNS')).toBeInTheDocument();
    expect(within(alpha).getByText('Add this TXT record at your DNS provider')).toBeInTheDocument();
    expect(within(alpha).getByText('verify-alpha')).toBeInTheDocument();
    expect(within(alpha).getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    // A verified domain needs nothing, so it has no step.
    const beta = screen.getByRole('article', { name: 'beta.example.com' });
    expect(within(beta).getByText('Verified')).toBeInTheDocument();
    expect(within(beta).queryByRole('button', { name: 'Check again' })).toBeNull();
    // The full record and the removal stay one click away.
    expect(
      within(alpha).getByRole('button', { name: 'Details for alpha.example.com' })
    ).toBeInTheDocument();
  });

  it('keeps the filters out of the way until there are many domains', async () => {
    await mount();
    await screen.findByText('alpha.example.com');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('opens the add form from a link', async () => {
    const router = await mount('/dashboard/domains?add=1');
    expect(await screen.findByRole('textbox', { name: 'Hostname' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.search.add).toBeUndefined());
  });

  it('lets the TXT verification value be copied', async () => {
    await mount();
    expect(
      await screen.findByRole('button', { name: 'Copy: TXT record verify-alpha' })
    ).toBeInTheDocument();
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
