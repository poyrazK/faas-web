import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';
import { DashboardShell } from './shell';
import type { Workflow } from '@/lib/mock-data';
import { OverviewSearch } from './overview-search';
import { validateSettingsSearch } from './settings-search';
import type { ReactNode } from 'react';

const app: Workflow = {
  id: 'api',
  name: 'Public API',
  runtime: 'node24',
  memoryMb: 256,
  state: 'running',
  url: 'https://api.example.test',
  invocations24h: 10,
  avgDurationMs: 20,
  coldStartP50Ms: 100,
  errorRatePct: 0,
  lastDeployedAt: 0,
  version: '1',
};

vi.mock('@/lib/store', () => ({ useData: () => ({ workflows: [app] }) }));
vi.mock('@/lib/auth', () => ({
  readWorkspace: () => 'acme',
  useAuth: () => ({
    apiReachable: true,
    refreshAccount: vi.fn(),
    signOut: vi.fn(),
    user: { email: 'operator@example.com', initials: 'OP', name: 'Operator' },
  }),
}));
vi.mock('@/components/sweep-link', () => ({ useSweepNavigate: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
// The decorative beam injects animated CSS custom properties that jsdom cannot
// parse reliably. Keep the real search, results and router beneath that wrapper.
vi.mock('border-beam', () => ({
  BorderBeam: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function Page() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return <p data-testid="page">{pathname}</p>;
}

async function renderShell(initialEntry = '/dashboard', content?: ReactNode) {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    component: () => (
      <DashboardShell>
        {content}
        <Outlet />
      </DashboardShell>
    ),
  });
  const index = createRoute({ getParentRoute: () => dashboard, path: '/', component: Page });
  const page = createRoute({ getParentRoute: () => dashboard, path: '$', component: Page });
  const settings = createRoute({
    getParentRoute: () => dashboard,
    path: 'settings',
    component: Page,
    validateSearch: validateSettingsSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([index, settings, page])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(<RouterProvider router={router as never} />);
  await screen.findByTestId('page');
  return router;
}

/**
 * Every rail row, in order — hubs and the sections nested under them.
 *
 * Consolidating pages into hubs must not consolidate navigation: a destination
 * that exists only after guessing which hub owns it is a destination nobody
 * finds. This list is the contract that the second level stays visible.
 */
const RAIL = [
  'Overview',
  'All apps',
  'Templates',
  'Import',
  'Jobs',
  'Releases',
  'Instances',
  'Domains',
  'Storage',
  'Postgres',
  'Debugger',
  'Invocations',
  'Audit Log',
  'Usage',
  'Invoices',
  'Plans',
  'Settings',
];

/**
 * Hubs that disclose a group rather than link to one.
 *
 * Their landing page rides along as the group's first child, which is what lets
 * the parent be a button: the router marks every active link
 * `aria-current="page"` last and unconditionally, so a second link to the same
 * URL would be a second current page that no prop can suppress.
 */
const RAIL_PARENTS = ['Apps', 'Data', 'Observe', 'Billing'];

/** The group headings that give the rail its scent. */
const RAIL_GROUPS = ['Build', 'Operate', 'Account'];

/**
 * Where a hub's sections live. They are rail rows for every hub but Settings,
 * whose eight `?section=` panels stay the page's own tabs.
 */
function sectionsNav(hub: string) {
  return screen.getByRole('navigation', {
    name: hub === 'Settings' ? 'Settings sections' : 'Main',
  });
}
const GROUPS = [
  {
    hub: 'Apps',
    anchor: '/dashboard/workflows',
    links: [
      ['All apps', '/dashboard/workflows'],
      ['Templates', '/dashboard/templates'],
      ['Import', '/dashboard/import'],
    ],
  },
  {
    hub: 'Data',
    anchor: '/dashboard/storage',
    links: [
      ['Storage', '/dashboard/storage'],
      ['Postgres', '/dashboard/postgres'],
    ],
  },
  {
    hub: 'Observe',
    anchor: '/dashboard/debug',
    links: [
      ['Debugger', '/dashboard/debug'],
      ['Invocations', '/dashboard/traces'],
      ['Audit Log', '/dashboard/audit'],
    ],
  },
  {
    hub: 'Billing',
    anchor: '/dashboard/usage',
    links: [
      ['Usage', '/dashboard/usage'],
      ['Invoices', '/dashboard/invoices'],
      ['Plans', '/dashboard/plans'],
    ],
  },
  {
    hub: 'Settings',
    anchor: '/dashboard/settings',
    links: [
      ['General', '/dashboard/settings?section=general'],
      ['Organization', '/dashboard/settings?section=organization'],
      ['Members', '/dashboard/settings?section=members'],
      ['API keys', '/dashboard/settings?section=api-keys'],
      ['Security', '/dashboard/settings?section=security'],
      ['Integrations', '/dashboard/settings?section=integrations'],
      ['Platform limits', '/dashboard/settings?section=platform-limits'],
      ['Data and privacy', '/dashboard/settings?section=data-and-privacy'],
    ],
  },
];

describe('dashboard navigation foundation', () => {
  it('keeps every hub and section visible in desktop and mobile navigation', async () => {
    await renderShell();
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(main)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label') ?? link.textContent)
    ).toEqual(RAIL);
    for (const title of [...RAIL_GROUPS, ...RAIL_PARENTS])
      expect(within(main).getByText(title)).toBeInTheDocument();
    for (const parent of RAIL_PARENTS) {
      expect(within(main).queryByRole('link', { name: parent })).toBeNull();
      expect(within(main).getByRole('button', { name: parent })).toHaveAttribute(
        'aria-expanded',
        'true'
      );
    }
    expect(within(main).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(main.querySelectorAll('[aria-current="page"]')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    const mobile = within(drawer).getByRole('navigation', { name: 'Main' });
    expect(
      within(mobile)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(RAIL);
    await userEvent.click(within(mobile).getByRole('link', { name: 'Postgres' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('page')).toHaveTextContent('/dashboard/postgres');
  });

  it('shuts a disclosure, remembers it, and leaves the others open', async () => {
    await renderShell();
    const main = screen.getByRole('navigation', { name: 'Main' });
    const observe = within(main).getByRole('button', { name: 'Observe' });

    expect(within(main).getByRole('link', { name: 'Invocations' })).toBeInTheDocument();
    await userEvent.click(observe);
    expect(observe).toHaveAttribute('aria-expanded', 'false');
    // The panel collapses on an exit animation, so the rows leave the document
    // when it finishes rather than on the click. aria-expanded flips at once,
    // which is what assistive tech reads.
    await waitFor(() =>
      expect(within(main).queryByRole('link', { name: 'Invocations' })).toBeNull()
    );
    // Shutting one group must not shut its neighbours.
    expect(within(main).getByRole('link', { name: 'Storage' })).toBeInTheDocument();

    // Stored as the closed set, so a hub nobody has shut stays open — including
    // one that does not exist yet.
    expect(JSON.parse(window.localStorage.getItem('gregale.sidebar.closedGroups') ?? '[]')).toEqual(
      ['/dashboard/debug']
    );

    await userEvent.click(observe);
    expect(observe).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(within(main).getByRole('link', { name: 'Invocations' })).toBeInTheDocument()
    );
    expect(JSON.parse(window.localStorage.getItem('gregale.sidebar.closedGroups') ?? '[]')).toEqual(
      []
    );
  });

  it.each(GROUPS)(
    'keeps every $hub destination accessible and marks its hub active',
    async ({ hub, anchor, links }) => {
      await renderShell(anchor);
      const user = userEvent.setup();
      for (const [label, path] of links) {
        const link = within(sectionsNav(hub)).getByRole('link', { name: label });
        expect(link).toHaveAttribute('href', path);
        await user.click(link);
        await waitFor(() =>
          expect(screen.getByTestId('page').textContent).toBe(path.split('?')[0])
        );
        expect(within(sectionsNav(hub)).getByRole('link', { name: label })).toHaveAttribute(
          'aria-current',
          'page'
        );
        // One marker, on the page itself. Marking the hub too would leave a
        // screen reader with two current pages and no way to tell them apart.
        const main = screen.getByRole('navigation', { name: 'Main' });
        expect(main.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      }
    }
  );

  it('makes standalone app sections, including Edge rules, discoverable from Apps', async () => {
    await renderShell('/dashboard/workflows');
    await userEvent.click(screen.getByText('App sections', { selector: 'summary' }));
    const sections = screen.getByRole('navigation', { name: 'App sections' });
    for (const [label, path] of [
      ['Logs', 'logs'],
      ['Routes', 'apis'],
      ['Upstreams', 'databases'],
      ['Edge rules', 'edge-rules'],
      ['OpenAPI', 'openapi'],
    ]) {
      expect(within(sections).getByRole('link', { name: label })).toHaveAttribute(
        'href',
        `/dashboard/${path}`
      );
    }
    await userEvent.click(within(sections).getByRole('link', { name: 'Edge rules' }));
    await waitFor(() =>
      expect(screen.getByTestId('page')).toHaveTextContent('/dashboard/edge-rules')
    );
    // Edge rules is an app section with no rail row of its own, so the rail
    // shows the branch rather than claiming a current page it does not have.
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Apps' })
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'App sections' })).getByRole('link', {
        name: 'Edge rules',
      })
    ).toHaveAttribute('aria-current', 'page');
  });

  it('uses link keyboard navigation and restores hub selection with browser Back', async () => {
    const router = await renderShell('/dashboard/storage');
    const user = userEvent.setup();
    const sections = screen.getByRole('navigation', { name: 'Main' });
    const storage = within(sections).getByRole('link', { name: 'Storage' });
    storage.focus();
    await user.tab();
    expect(within(sections).getByRole('link', { name: 'Postgres' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard/postgres'));
    await act(async () => router.history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard/storage'));
    expect(within(sections).getByRole('link', { name: 'Storage' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('keeps a primary link focused when focusing the collapsed rail expands it', async () => {
    const router = await renderShell('/dashboard');
    const main = screen.getByRole('navigation', { name: 'Main' });
    await act(async () => within(main).getByRole('link', { name: 'Jobs' }).focus());
    const jobs = within(main).getByRole('link', { name: 'Jobs' });
    expect(jobs).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard/jobs'));
  });

  it('preserves search and hash state when the current section is reselected', async () => {
    const router = await renderShell('/dashboard/storage?q=assets&campaign=handoff#buckets');
    const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: 'Storage',
    });
    await userEvent.click(link);
    expect(router.state.location.href).toBe('/dashboard/storage?q=assets&campaign=handoff#buckets');
  });

  it('identifies only the current page in a hub anchor breadcrumb', async () => {
    await renderShell('/dashboard/deployments');
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByText('Releases')).toBeInTheDocument();
    expect(within(breadcrumb).getByText('Deployments')).toHaveAttribute('aria-current', 'page');
    expect(breadcrumb.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('preserves an Apps list bookmark when its primary destination is reselected', async () => {
    const router = await renderShell('/dashboard/workflows?q=api&state=running#list');
    const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: 'All apps',
    });
    expect(link).toHaveAttribute('href', '/dashboard/workflows?q=api&state=running#list');
    await userEvent.click(link);
    expect(router.state.location.href).toBe('/dashboard/workflows?q=api&state=running#list');
  });

  it('exposes app sections from a trailing-slash Apps bookmark', async () => {
    await renderShell('/dashboard/workflows/');
    expect(screen.getByText('App sections', { selector: 'summary' })).toBeInTheDocument();
  });

  it('keeps saved legacy page commands available as recent commands', async () => {
    window.localStorage.setItem(
      'gregale.palette.recent',
      JSON.stringify(['nav-/dashboard/builds', 'nav-app-logs'])
    );
    await renderShell();
    await userEvent.keyboard('{Control>}k{/Control}');
    await screen.findByRole('combobox', { name: 'Search commands' });
    expect(screen.getByText('Recent', { exact: true })).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options.slice(0, 2).map((option) => option.textContent)).toEqual(['Builds', 'Logs']);
  });

  it('restores saved Team and Keys commands as canonical Settings destinations', async () => {
    window.localStorage.setItem(
      'gregale.palette.recent',
      JSON.stringify(['nav-/dashboard/team', 'nav-/dashboard/keys'])
    );
    const router = await renderShell();
    await userEvent.keyboard('{Control>}k{/Control}');
    await screen.findByRole('combobox', { name: 'Search commands' });
    expect(
      screen
        .getAllByRole('option')
        .slice(0, 2)
        .map((option) => option.textContent)
    ).toEqual(['Members', 'API keys']);
    await userEvent.click(screen.getAllByRole('option')[0]);
    await waitFor(() => expect(router.state.location.search).toEqual({ section: 'members' }));
  });

  it('retains the selected organization, key scope, extra search and hash between Settings palette commands', async () => {
    const router = await renderShell(
      '/dashboard/settings?section=organization&org=bravo&scope=organization&campaign=handoff#details'
    );
    for (const [label, section] of [
      ['Members', 'members'],
      ['API keys', 'api-keys'],
    ]) {
      await userEvent.keyboard('{Control>}k{/Control}');
      await userEvent.type(await screen.findByRole('combobox', { name: 'Search commands' }), label);
      await userEvent.click(
        screen.getAllByRole('option').find((option) => option.textContent === `${label}Go to`)!
      );
      await waitFor(() =>
        expect(router.state.location.search).toEqual({
          section,
          org: 'bravo',
          scope: 'organization',
          campaign: 'handoff',
        })
      );
      expect(router.state.location.pathname).toBe('/dashboard/settings');
      expect(router.state.location.hash).toBe('details');
      await waitFor(() =>
        expect(screen.queryByRole('combobox', { name: 'Search commands' })).not.toBeInTheDocument()
      );
    }
    await act(async () => router.history.back());
    await waitFor(() => expect(router.state.location.search.section).toBe('members'));
    expect(router.state.location.search.org).toBe('bravo');
    expect(router.state.location.hash).toBe('details');
    await act(async () => router.history.forward());
    await waitFor(() => expect(router.state.location.search.section).toBe('api-keys'));
    expect(router.state.location.search.scope).toBe('organization');
  });

  it('does not copy another route search or hash into a Settings palette destination', async () => {
    const router = await renderShell(
      '/dashboard/jobs?org=foreign&scope=organization&campaign=jobs&q=retry#tasks'
    );
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(
      await screen.findByRole('combobox', { name: 'Search commands' }),
      'Members'
    );
    await userEvent.click(
      screen.getAllByRole('option').find((option) => option.textContent === 'MembersGo to')!
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard/settings'));
    expect(router.state.location.search).toEqual({ section: 'members' });
    expect(router.state.location.hash).toBe('');
  });

  it('keeps overview search results unique while changing between hub and page searches', async () => {
    await renderShell('/dashboard', <OverviewSearch workflows={[app]} />);
    const user = userEvent.setup();
    const input = screen.getByRole('combobox', { name: 'Search apps, pages, and actions' });
    await user.type(input, 't');
    await user.clear(input);
    await user.type(input, 'Data');
    expect(
      screen
        .getAllByRole('option')
        .map((option) => option.textContent)
        .filter((text) => text?.endsWith('Page'))
    ).toEqual(['DataPage', 'Data and privacyPage']);
    await user.clear(input);
    await user.type(input, 'Storage');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'StoragePage',
    ]);
    await user.clear(input);
    await user.type(input, 'Observe');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'ObservePage',
    ]);
  });

  it.each([
    ['/dashboard/builds', 'Releases', 'Builds', '/dashboard/deployments'],
    ['/dashboard/team', 'Settings', 'Team', '/dashboard/settings'],
    ['/dashboard/workflows/api', 'Apps', 'Public API', '/dashboard/workflows'],
    ['/dashboard/workflows/missing', 'Apps', 'App', '/dashboard/workflows'],
    ['/dashboard/workflows/new', 'Apps', 'New app', '/dashboard/workflows'],
  ])(
    'shows a linked parent hub and meaningful current breadcrumb at %s',
    async (path, hub, current, anchor) => {
      await renderShell(path);
      const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(within(breadcrumb).getByRole('link', { name: hub })).toHaveAttribute('href', anchor);
      expect(within(breadcrumb).getByText(current, { exact: true })).toHaveAttribute(
        'aria-current',
        'page'
      );
    }
  );

  it('names apps consistently in the palette and keeps app action deep links', async () => {
    const router = await renderShell();
    const user = userEvent.setup();
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: 'Search commands' });
    expect(input).toHaveAttribute('placeholder', 'Search apps, jump to a page, run an action…');
    expect(screen.queryByText('Workflows', { exact: true })).not.toBeInTheDocument();
    await user.type(input, 'Tail logs');
    const command = screen
      .getAllByRole('option')
      .find((option) => option.textContent === 'Tail logs — Public APIApp actions');
    expect(command).toBeDefined();
    await user.click(command!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard/workflows/api'));
    expect(router.state.location.search).toEqual({ tab: 'Logs' });
  });

  it.each([
    ['Releases', '/dashboard/deployments'],
    ['Builds', '/dashboard/builds'],
    ['Data', '/dashboard/storage'],
    ['Observe', '/dashboard/debug'],
    ['Billing', '/dashboard/usage'],
  ])('opens %s from the command palette without duplicate results', async (label, path) => {
    const router = await renderShell();
    const user = userEvent.setup();
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: 'Search commands' });
    await user.type(input, label);
    const options = screen
      .queryAllByRole('option')
      .filter((option) => option.textContent === `${label}Go to`);
    expect(options).toHaveLength(1);
    await user.click(options[0]);
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
  });
});
