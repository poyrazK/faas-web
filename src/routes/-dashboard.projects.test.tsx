import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { Route as Projects } from './dashboard.projects';
import { Route as Index } from './dashboard.projects.index';
import { Route as Detail } from './dashboard.projects.$projectSlug';
import { DashboardShell } from '@/components/dashboard/shell';
import { ApiError } from '@/lib/api/errors';
import { spyApi } from '@/test/api';
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    account: { id: 'a', plan: 'free' },
    apiReachable: true,
    refreshAccount: vi.fn(),
    signOut: vi.fn(),
    user: { email: 'test@example.com', initials: 'TE', name: 'Test' },
  }),
}));
const store = vi.hoisted(() => ({
  workflows: [] as { id: string; name: string; runtime: string; state: string }[],
}));
vi.mock('@/lib/store', () => ({
  useData: () => ({ workflows: store.workflows, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('@/components/sweep-link', () => ({ useSweepNavigate: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const summary = {
  id: 'project-1',
  slug: 'shop',
  scan_source: 'compose',
  workload_count: 2,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-08T00:00:00Z',
  repo_full_name: 'team/shop',
  production_branch: 'main',
};
beforeEach(() => {
  vi.restoreAllMocks();
  store.workflows = [];
});
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
async function mount(
  entry: string,
  data: unknown[] = [
    summary,
    {
      ...summary,
      id: 'project-2',
      slug: 'tools',
      repo_full_name: undefined,
      production_branch: undefined,
    },
  ]
) {
  const get = spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/projects') return ok(data);
    if (path === '/v1/projects/{slug}')
      return ok({
        ...summary,
        workloads: [
          {
            slug: 'api',
            workload_name: 'web',
            status: 'parked',
            build_status: 'succeeded',
            deployment_status: 'failed',
          },
        ],
        exclusions: [],
      });
    return ok([]);
  });
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: () => (
      <DashboardShell>
        <Outlet />
      </DashboardShell>
    ),
  });
  const projects = createRoute({
    getParentRoute: () => dashboard,
    path: 'projects',
    component: Projects.options.component,
    validateSearch: Projects.options.validateSearch,
  });
  const index = createRoute({
    getParentRoute: () => projects,
    path: '/',
    component: Index.options.component,
  });
  const detail = createRoute({
    getParentRoute: () => projects,
    path: '$projectSlug',
    component: Detail.options.component,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([projects.addChildren([index, detail])])]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  return { router, get };
}
it('lists each project with its apps, without GitHub or a paid capability gate', async () => {
  await mount('/dashboard/projects');
  const apps = await screen.findByRole('list', { name: 'Apps in shop' });
  expect(within(apps).getByRole('link', { name: 'api' })).toHaveAttribute(
    'href',
    '/dashboard/apps/api'
  );
  expect(screen.getByText(/team\/shop/)).toBeInTheDocument();
  expect(screen.getByText(/No repository connected/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open project shop' })).toHaveAttribute(
    'href',
    '/dashboard/projects/shop'
  );
  expect(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: 'All projects',
    })
  ).toHaveAttribute('aria-current', 'page');
});
it('lists apps outside every project as standalone, and only once membership is known', async () => {
  store.workflows = [
    { id: 'api', name: 'api', runtime: 'node24', state: 'running' },
    { id: 'scratch', name: 'scratch', runtime: 'python313', state: 'idle' },
  ];
  await mount('/dashboard/projects');
  const standalone = await screen.findByRole('list', { name: 'Standalone apps' });
  expect(within(standalone).getByRole('link', { name: 'scratch' })).toBeInTheDocument();
  expect(within(standalone).queryByRole('link', { name: 'api' })).not.toBeInTheDocument();
});
it('bounds the project list and expands on request', async () => {
  await mount(
    '/dashboard/projects',
    Array.from({ length: 24 }, (_, i) => ({ ...summary, id: `project-${i}`, slug: `project-${i}` }))
  );
  await screen.findByRole('link', { name: 'Open project project-0' });
  expect(screen.getAllByRole('link', { name: /^Open project / })).toHaveLength(10);
  await userEvent.click(screen.getByRole('button', { name: 'Show 10 more projects' }));
  expect(screen.getAllByRole('link', { name: /^Open project / })).toHaveLength(20);
});
it('offers an import when nothing is deployed', async () => {
  await mount('/dashboard/projects', []);
  expect(await screen.findByText(/Nothing deployed yet/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Import a repository' })).toHaveAttribute(
    'href',
    '/dashboard/apps/new?source=import'
  );
});
it('loads a direct detail URL with actual partial status, not invented Ready', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await mount('/dashboard/projects/shop');
  const table = await screen.findByRole('table', { name: 'Project workloads' });
  expect(within(table).getByText('failed')).toBeInTheDocument();
  expect(within(table).getByText('Unknown')).toBeInTheDocument();
  expect(within(table).getByRole('link', { name: 'api' })).toHaveAttribute(
    'href',
    '/dashboard/apps/api'
  );
  expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('shop')
  ).toBeInTheDocument();
  expect(errors.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain('same key');
});
it('shows a read error rather than an empty inventory', async () => {
  const { get, router } = await mount('/dashboard/projects', []);
  get.mockRejectedValue(
    new ApiError({ status: 403, code: 'forbidden', title: 'Projects are not accessible' })
  );
  // Force a new identity to exercise a fresh protected detail read.
  await act(async () => {
    await router.navigate({
      to: '/dashboard/projects/$projectSlug',
      params: { projectSlug: 'denied' },
    });
  });
  expect(await screen.findByText('Projects are not accessible')).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Project workloads' })).not.toBeInTheDocument();
});
it('keeps the search in the URL across detail and return navigation', async () => {
  await mount('/dashboard/projects');
  await screen.findByRole('list', { name: 'Apps in shop' });
  await userEvent.type(screen.getByLabelText('Search projects and apps'), 'shop');
  await userEvent.click(screen.getByRole('link', { name: 'Open project shop' }));
  // The detail page's own back link, not the sidebar row of the same name.
  const pageBack = await waitFor(() => {
    const link = screen
      .getAllByRole('link', { name: 'All projects' })
      .find((item) => !item.closest('nav[aria-label="Main"]'));
    expect(link).toBeDefined();
    return link;
  });
  expect(pageBack).toHaveAttribute('href', '/dashboard/projects?q=shop');
  await userEvent.click(pageBack!);
  expect(await screen.findByLabelText('Search projects and apps')).toHaveValue('shop');
});
