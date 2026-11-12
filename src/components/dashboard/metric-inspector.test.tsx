import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { expect, it, vi } from 'vitest';
import { MetricInspectorProvider, useMetricInspector } from './metric-inspector';
import { validateMetricDetailSearch } from './metric-detail-search';

vi.mock('./metric-detail', () => ({ default: () => <p>Selected metric history</p> }));
function Entry() {
  const inspect = useMetricInspector();
  return (
    <button onClick={() => inspect({ metric: 'p95', app: 'api', since: '7d' })}>
      Inspect response time
    </button>
  );
}
it('opens and closes on the same app URL, preserves page filters, and restores focus', async () => {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    validateSearch: validateMetricDetailSearch,
    component: () => (
      <MetricInspectorProvider>
        <Outlet />
      </MetricInspectorProvider>
    ),
  });
  const app = createRoute({
    getParentRoute: () => dashboard,
    path: '/apps/$appSlug',
    validateSearch: (search: Record<string, unknown>) => ({
      analyticsSince: search.analyticsSince === '7d' ? '7d' : '24h',
    }),
    component: Entry,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([app])]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/apps/api?analyticsSince=7d'] }),
  });
  render(<RouterProvider router={router as never} />);
  const trigger = await screen.findByRole('button', { name: 'Inspect response time' });
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  await screen.findByRole('dialog', { name: 'Response time p95 · api' });
  expect(router.state.location.pathname).toBe('/dashboard/apps/api');
  expect(router.state.location.search).toMatchObject({
    inspect: 'p95',
    inspectApp: 'api',
    inspectSince: '7d',
    analyticsSince: '7d',
  });
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(router.state.location.pathname).toBe('/dashboard/apps/api');
  expect(router.state.location.search).toEqual({ analyticsSince: '7d' });
  expect(trigger).toHaveFocus();
});
