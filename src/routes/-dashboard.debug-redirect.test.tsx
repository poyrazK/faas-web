import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route } from './dashboard.debug';

const inventory = vi.hoisted(() => ({ apps: [{ slug: 'alpha' }, { slug: 'beta' }] }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({
    access: 'on',
    capability: { id: 'debug', stage: 'beta' },
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
  useApps: () => ({ data: inventory.apps, isPending: false, error: null, refetch: vi.fn() }),
}));
beforeEach(() => {
  inventory.apps = [{ slug: 'alpha' }, { slug: 'beta' }];
});

afterEach(() => window.localStorage.clear());

function mount(entry: string) {
  const root = createRootRoute();
  const debug = Route.update({
    id: '/dashboard/debug',
    path: '/dashboard/debug',
    getParentRoute: () => root,
  } as never);
  const app = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/apps/$appSlug',
    component: () => <h1>App page</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([debug, app]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

it('opens the named app’s Debugger with the investigation intact', async () => {
  const router = mount('/dashboard/debug?app=alpha&debugFilter=slow');
  expect(await screen.findByRole('heading', { name: 'App page' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/dashboard/apps/alpha');
  expect(router.state.location.search).toEqual({ tab: 'Debugger', debugFilter: 'slow' });
});

it('falls back to the app picked last', async () => {
  window.localStorage.setItem('gregale.selectedApp', 'beta');
  const router = mount('/dashboard/debug');
  expect(await screen.findByRole('heading', { name: 'App page' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/dashboard/apps/beta');
});

it('falls back to an available app when the remembered one was deleted', async () => {
  window.localStorage.setItem('gregale.selectedApp', 'deleted');
  const router = mount('/dashboard/debug?debugFilter=slow&request=req-1');
  expect(await screen.findByRole('heading', { name: 'App page' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/dashboard/apps/alpha');
  expect(router.state.location.search).toEqual({
    tab: 'Debugger',
    debugFilter: 'slow',
    request: 'req-1',
  });
});

it('keeps the empty workspace picker when the remembered app no longer exists', async () => {
  inventory.apps = [];
  window.localStorage.setItem('gregale.selectedApp', 'deleted');
  const router = mount('/dashboard/debug');
  expect(await screen.findByText(/this workspace has none yet/)).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/dashboard/debug');
});
