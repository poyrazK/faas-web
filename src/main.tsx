import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
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

/**
 * `createRoot`, not `hydrateRoot`, even though public routes ship prerendered
 * markup (see `scripts/prerender.mjs`).
 *
 * Hydration was tried and does not reconcile: the router wraps matches in
 * Suspense on the client, so React finds a boundary where the server wrote
 * real markup and bails out of hydration with a mismatch. Mounting fresh is
 * the same outcome without the warning, and React clears and paints in one
 * task, so there is no visible flash.
 *
 * The prerender is therefore aimed at consumers that never run this file at
 * all — crawlers, social unfurlers, and no-JS readers. That is what it was
 * added for; hydration would only have been a bonus.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
