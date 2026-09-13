import { act, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { Route as Triggers } from './dashboard.triggers';

describe('legacy trigger route', () => {
  it('does not redirect the create and detail child routes into the Jobs hub', async () => {
    const root = createRootRoute({ component: Outlet });
    const dashboard = createRoute({
      getParentRoute: () => root,
      path: 'dashboard',
      component: Outlet,
    });
    const triggers = createRoute({
      getParentRoute: () => dashboard,
      path: 'triggers',
      component: Triggers.options.component,
      validateSearch: Triggers.options.validateSearch,
      beforeLoad: (context) => Triggers.options.beforeLoad?.(context as never),
    });
    const create = createRoute({
      getParentRoute: () => triggers,
      path: 'new',
      component: () => <h1>Create trigger</h1>,
    });
    const router = createRouter({
      routeTree: root.addChildren([dashboard.addChildren([triggers.addChildren([create])])]),
      history: createMemoryHistory({ initialEntries: ['/dashboard/triggers/new'] }),
    });

    await router.load();
    await act(async () => render(<RouterProvider router={router} />));

    expect(router.state.location.pathname).toBe('/dashboard/triggers/new');
    expect(screen.getByRole('heading', { name: 'Create trigger' })).toBeInTheDocument();
  });
});
