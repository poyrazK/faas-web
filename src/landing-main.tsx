import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root';
import { Route as indexRouteImport } from './routes/index';
import { RouteError, RoutePending } from './components/route-status';
import './index.css';

const indexRoute = indexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRoute,
} as never);

const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
  defaultErrorComponent: RouteError,
  defaultPendingComponent: RoutePending,
  defaultPendingMs: 200,
  defaultPendingMinMs: 400,
  scrollRestoration: true,
});

async function start() {
  const mount = document.getElementById('root')!;
  await router.load();
  // The compact landing router deliberately has a different route tree from
  // the full prerender router. React cannot hydrate across that structural
  // difference reliably, so keep the already-visible static HTML in place
  // until this small graph is ready, then replace it in one commit.
  createRoot(mount).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}

void start();
