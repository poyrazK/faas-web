import { describe, expect, it } from 'vitest';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { movedTo } from './moved-route';

function routerAt(entry: string) {
  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: 'dashboard/apps' }),
    createRoute({ getParentRoute: () => root, path: 'dashboard/apps/$appSlug' }),
    createRoute({ getParentRoute: () => root, path: 'dashboard/instances' }),
    createRoute({
      getParentRoute: () => root,
      path: 'dashboard/workflows',
      beforeLoad: movedTo('/dashboard/workflows', '/dashboard/apps'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: 'dashboard/workflows/$',
      beforeLoad: movedTo('/dashboard/workflows', '/dashboard/apps'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: 'dashboard/workers',
      beforeLoad: movedTo('/dashboard/workers', '/dashboard/instances'),
    }),
  ];
  return createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
}

describe('movedTo', () => {
  it.each([
    ['/dashboard/workflows', '/dashboard/apps'],
    ['/dashboard/workflows?q=api&view=deleted', '/dashboard/apps?q=api&view=deleted'],
    [
      '/dashboard/workflows/alpha?tab=Logs&q=timeout#context',
      '/dashboard/apps/alpha?tab=Logs&q=timeout#context',
    ],
    ['/dashboard/workers?instance=i-1', '/dashboard/instances?instance=i-1'],
  ])('sends %s to %s', async (from, to) => {
    const router = routerAt(from);
    await router.load();
    expect(router.state.location.href).toBe(to);
  });

  it('replaces the old entry rather than adding one Back would return to', async () => {
    const router = routerAt('/dashboard/workflows/alpha');
    await router.load();
    expect(router.history.length).toBe(1);
  });
});
