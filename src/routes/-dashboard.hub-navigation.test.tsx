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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardShell } from '@/components/dashboard/shell';
import { Route as Releases } from './dashboard.deployments';
import { Route as Builds } from './dashboard.builds';
import { Route as Jobs } from './dashboard.jobs';
import { Route as Crons } from './dashboard.crons';
import { Route as Triggers } from './dashboard.triggers';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/lib/api/client', async (original) => ({ ...(await original<object>()), api }));
vi.mock('@/lib/store', () => ({ useData: () => ({ workflows: [] }) }));
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

beforeEach(() => {
  api.GET.mockReset().mockImplementation(async (path: string) => {
    const data: Record<string, unknown> = {
      '/v1/apps': [],
      '/v1/deployments': { items: [], limit: 50 },
      '/v1/builds': { items: [], limit: 50 },
      '/v1/jobs': { jobs: [], next_offset: -1 },
      '/v1/crons': [],
      '/v1/triggers': [],
    };
    if (!(path in data)) throw new Error(`Unexpected read ${path}`);
    return { data: data[path], response: new Response(null, { status: 200 }) };
  });
});

async function mount(entry: string) {
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
  const routes = [Releases, Builds, Jobs, Crons, Triggers].map((route, index) =>
    createRoute({
      getParentRoute: () => dashboard,
      path: ['deployments', 'builds', 'jobs', 'crons', 'triggers'][index],
      component: route.options.component,
      validateSearch: route.options.validateSearch,
      beforeLoad: (context) => route.options.beforeLoad?.(context as never),
    })
  );
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren(routes)]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

function expectActiveHub(label: string) {
  const main = screen.getByRole('navigation', { name: 'Main' });
  expect(within(main).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  expect(main.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
}

describe('canonical hub navigation inside the dashboard shell', () => {
  it.each([
    '/dashboard/deployments?view=builds&q=alpha&campaign=handoff#evidence',
    '/dashboard/builds?q=alpha&campaign=handoff#evidence',
  ])('switches Releases views without competing legacy links from %s', async (entry) => {
    const router = await mount(entry);
    const expectView = async (view: 'releases' | 'builds', label: string) => {
      expect(
        await screen.findByText(view === 'builds' ? 'No builds yet.' : 'No releases yet.')
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/dashboard/deployments');
      expect(router.state.location.search).toMatchObject({ view, q: 'alpha', campaign: 'handoff' });
      expect(router.state.location.hash).toBe('evidence');
      expect(screen.getByRole('searchbox', { name: 'Filter resources' })).toHaveValue('alpha');
      expect(
        screen.queryByRole('navigation', { name: 'Releases sections' })
      ).not.toBeInTheDocument();
      const views = screen.getByRole('navigation', { name: 'Releases views' });
      expect(within(views).getByRole('link', { name: label })).toHaveAttribute(
        'aria-current',
        'page'
      );
      expect(views.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expectActiveHub('Releases');
    };
    await expectView('builds', 'Builds');
    const views = screen.getByRole('navigation', { name: 'Releases views' });
    await userEvent.click(within(views).getByRole('link', { name: 'Releases' }));
    await expectView('releases', 'Releases');
    await act(async () => router.history.back());
    await expectView('builds', 'Builds');
    await act(async () => router.history.forward());
    await expectView('releases', 'Releases');
    await userEvent.click(within(views).getByRole('link', { name: 'Builds' }));
    await expectView('builds', 'Builds');
  });

  it.each([
    [
      '/dashboard/jobs?section=scheduled&q=alpha&campaign=handoff#evidence',
      'scheduled',
      'Scheduled requests',
    ],
    ['/dashboard/crons?q=alpha&campaign=handoff#evidence', 'scheduled', 'Scheduled requests'],
    ['/dashboard/triggers?q=alpha&campaign=handoff#evidence', 'triggers', 'Triggers'],
  ])(
    'switches Jobs sections through one canonical navigation from %s',
    async (entry, section, label) => {
      const router = await mount(entry);
      const expectSection = async (value: string, name: string) => {
        await waitFor(() => expect(router.state.location.search.section).toBe(value));
        expect(screen.getByRole('heading', { name })).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/dashboard/jobs');
        expect(router.state.location.search).toMatchObject({ q: 'alpha', campaign: 'handoff' });
        expect(router.state.location.hash).toBe('evidence');
        expect(screen.getAllByRole('navigation', { name: 'Jobs sections' })).toHaveLength(1);
        const sections = screen.getByRole('navigation', { name: 'Jobs sections' });
        expect(
          within(sections)
            .getAllByRole('link')
            .map((link) => link.textContent)
        ).toEqual(['Workloads', 'Scheduled requests', 'Triggers']);
        expect(within(sections).getByRole('link', { name })).toHaveAttribute(
          'aria-current',
          'page'
        );
        expect(sections.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
        expectActiveHub('Jobs');
      };
      await expectSection(section, label);
      for (const [value, name] of [
        ['workloads', 'Workloads'],
        ['scheduled', 'Scheduled requests'],
        ['triggers', 'Triggers'],
      ]) {
        await userEvent.click(
          within(screen.getByRole('navigation', { name: 'Jobs sections' })).getByRole('link', {
            name,
          })
        );
        await expectSection(value, name);
      }
      await act(async () => router.history.back());
      await expectSection('scheduled', 'Scheduled requests');
      await act(async () => router.history.forward());
      await expectSection('triggers', 'Triggers');
    }
  );
});
