import { render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, expect, it } from 'vitest';
import { Route } from './dashboard.debug';

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
  render(<RouterProvider router={router} />);
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
