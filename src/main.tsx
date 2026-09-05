import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { RouteError, RoutePending } from './components/route-status';
import './index.css';

/**
 * `defaultPreload: 'intent'` warms a route's code-split chunk and loaders on
 * hover or focus, so by the time the click lands the page is usually already
 * there. The delay keeps a cursor merely crossing a nav item from fetching
 * twenty chunks; `preloadStaleTime` stops a re-hover from refetching what we
 * just pulled.
 */
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadDelay: 80,
  defaultPreloadStaleTime: 30_000,
  // Every route inherits these, so a route that throws degrades to a scoped
  // error panel instead of a blank document. `defaultPendingMs` swallows the
  // fast cases entirely: a chunk that arrives inside 200ms never flashes a
  // loader, and one that does show stays up long enough not to strobe.
  defaultErrorComponent: RouteError,
  defaultPendingComponent: RoutePending,
  defaultPendingMs: 200,
  defaultPendingMinMs: 400,
  // Back/forward returns to where the reader was — a deep-scrolled table into
  // a detail page and back should not land mid-page or at the top.
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

async function start() {
  const mount = document.getElementById('root')!;
  await router.load();

  const app = (
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );

  // Prerendered public pages carry their source path. Hydrate only when it
  // matches the current URL; an SPA fallback serving the home document for a
  // private or unknown path must be replaced instead.
  const prerenderedPath = mount.dataset.prerenderPath;
  if (prerenderedPath === window.location.pathname) hydrateRoot(mount, app);
  else createRoot(mount).render(app);
}

void start();
