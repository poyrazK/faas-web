import { act, render, screen, within } from '@testing-library/react';
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
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
vi.mock('@/lib/auth', () => ({
  readWorkspace: () => 'console label',
  useAuth: () => ({
    account: { id: 'a', plan: 'free' },
    apiReachable: true,
    refreshAccount: vi.fn(),
    signOut: vi.fn(),
    user: { email: 'test@example.com', initials: 'TE', name: 'Test' },
  }),
}));
vi.mock('@/lib/store', () => ({ useData: () => ({ workflows: [] }) }));
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
beforeEach(() => vi.restoreAllMocks());
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
  const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
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
it('browses multiple projects without GitHub or a paid capability gate', async () => {
  await mount('/dashboard/projects');
  const table = await screen.findByRole('table', { name: 'Projects' });
  expect(within(table).getByRole('link', { name: 'shop' })).toHaveAttribute(
    'href',
    '/dashboard/projects/shop'
  );
  expect(within(table).getByText('team/shop')).toBeInTheDocument();
  expect(within(table).getByText('Not connected')).toBeInTheDocument();
  expect(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Projects' })
  ).toHaveAttribute('aria-current', 'page');
});
it('bounds inventory and expands on request', async () => {
  await mount(
    '/dashboard/projects',
    Array.from({ length: 24 }, (_, i) => ({ ...summary, id: `project-${i}`, slug: `project-${i}` }))
  );
  const table = await screen.findByRole('table', { name: 'Projects' });
  expect(within(table).getAllByRole('row')).toHaveLength(11);
  await userEvent.click(screen.getByRole('button', { name: 'Show 10 more projects' }));
  expect(within(table).getAllByRole('row')).toHaveLength(21);
});
it('links an empty inventory to import, not empty project creation', async () => {
  await mount('/dashboard/projects', []);
  expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Import a project' })).toHaveAttribute(
    'href',
    '/dashboard/workflows/new?source=import'
  );
});
it('loads a direct detail URL with actual partial status, not invented Ready', async () => {
  await mount('/dashboard/projects/shop');
  const table = await screen.findByRole('table', { name: 'Project workloads' });
  expect(within(table).getByText('failed')).toBeInTheDocument();
  expect(within(table).getByText('Unknown')).toBeInTheDocument();
  expect(within(table).getByRole('link', { name: 'api' })).toHaveAttribute(
    'href',
    '/dashboard/workflows/api'
  );
  expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('shop')
  ).toBeInTheDocument();
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
  await screen.findByRole('table', { name: 'Projects' });
  await userEvent.type(screen.getByLabelText('Search projects'), 'shop');
  await userEvent.click(screen.getByRole('link', { name: 'shop' }));
  expect(await screen.findByRole('link', { name: 'All projects' })).toHaveAttribute(
    'href',
    '/dashboard/projects?q=shop'
  );
  await userEvent.click(screen.getByRole('link', { name: 'All projects' }));
  expect(await screen.findByLabelText('Search projects')).toHaveValue('shop');
});
