import { render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/lib/mock-data';
import { Route } from './dashboard.index';

const fixtures = vi.hoisted(() => ({ empty: false, error: null as Error | null }));
const ready = (data: unknown) => ({
  data,
  isPending: false,
  isRefetching: false,
  error: null,
  refetch: vi.fn(),
});
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { plan: 'free', status: 'active' }, user: { name: 'Ada' } }),
}));
vi.mock('@/lib/store', () => ({
  useData: () => ({
    workflows: fixtures.empty
      ? []
      : ([{ id: 'alpha', name: 'alpha', state: 'error', errorRatePct: 0 }] as Workflow[]),
    deployments: [],
    loading: false,
    error: fixtures.error,
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
  useApps: () =>
    ready(fixtures.empty ? [] : [{ id: 'app-alpha', slug: 'alpha', status: 'failed' }]),
  useDeployments: () => ready({ items: [] }),
  useAppsMetrics: () => ready(undefined),
  useInstances: () => ready({ instances: [] }),
  useUsageSummary: () =>
    ready({ month: '2026-10', used_gb_hours: 45, included_gb_hours: 50, overage_gb_hours: 0 }),
}));

async function mount() {
  const root = createRootRoute({ component: Outlet });
  const overview = Route.update({
    id: '/dashboard/',
    path: '/dashboard/',
    getParentRoute: () => root,
  } as never);
  const leaf = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([
      overview,
      leaf('/dashboard/workflows'),
      leaf('/dashboard/workflows/$workflowId'),
      leaf('/dashboard/workflows/new'),
      leaf('/dashboard/deployments'),
      leaf('/dashboard/usage'),
    ]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  fixtures.empty = false;
  fixtures.error = null;
});

describe('overview attention entry point', () => {
  it('leaves attention checks to the global modal rather than duplicating them in overview', async () => {
    await mount();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(screen.getByText('Apps')).toBeInTheDocument();
  });

  it('keeps first-run instructions without an inline attention panel', async () => {
    fixtures.empty = true;
    await mount();
    expect(screen.getByRole('heading', { name: 'Deploy your first app' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument();
  });

  it('keeps overview errors separate from the global attention modal', async () => {
    fixtures.error = new Error('Latest deployment read failed');
    await mount();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument();
  });
});
