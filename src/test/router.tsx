import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';

/**
 * Renders `ui` inside a throwaway memory router so components that use the
 * typed `Link` can be tested without the app's route tree. The routes the
 * landing page links to exist so hrefs resolve rather than warn.
 */
export function withRouter(ui: ReactNode) {
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({ getParentRoute: () => root, path: '/', component: () => ui });
  const leaf = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([index, leaf('/signup'), leaf('/docs'), leaf('/docs/$slug')]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  // The app registers its own route tree's types; this router is untyped.
  return <RouterProvider router={router as never} />;
}
