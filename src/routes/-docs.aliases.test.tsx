import { render, screen, waitFor } from '@testing-library/react';
import {
  type AnyRoute,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { Route as DocSlug } from './docs.$slug';
import { Route as DocSplat } from './docs.$';

/**
 * The catalog paths the API emits must land on a page, not on the SPA's
 * not-found panel. The edge redirects first in production; this covers the
 * router's own behaviour, which is what `npm run dev` and in-app links see.
 */
function mount(initial: string) {
  const root = createRootRoute({ component: Outlet });
  const slug = createRoute({
    getParentRoute: () => root,
    path: '/docs/$slug',
    loader: DocSlug.options.loader as never,
    component: function Page() {
      return <h1>page:{slug.useParams().slug}</h1>;
    },
  });
  const splat = createRoute({
    getParentRoute: () => root,
    path: '/docs/$',
    loader: DocSplat.options.loader as never,
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([slug as unknown as AnyRoute, splat as unknown as AnyRoute]),
    history: createMemoryHistory({ initialEntries: [initial] }),
    defaultNotFoundComponent: () => <p>not found</p>,
  });
  render(<RouterProvider router={router as never} />);
  return router;
}

describe('docs aliases', () => {
  it('redirects a single-segment catalog alias to its page', async () => {
    const router = mount('/docs/orgs');
    await waitFor(() => expect(router.state.location.pathname).toBe('/docs/account'));
    expect(await screen.findByText('page:account')).toBeInTheDocument();
  });

  it('redirects a nested catalog path', async () => {
    const router = mount('/docs/build/source-ref');
    await waitFor(() => expect(router.state.location.pathname).toBe('/docs/deploy-from-source'));
  });

  it('collapses a child path onto the parent guide', async () => {
    const router = mount('/docs/domains/verify');
    await waitFor(() => expect(router.state.location.pathname).toBe('/docs/custom-domains'));
  });

  it('is a real not-found for an unknown path', async () => {
    mount('/docs/no-such-page/at-all');
    expect(await screen.findByText('not found')).toBeInTheDocument();
  });
});
