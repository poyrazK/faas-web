import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as Apps } from './dashboard.apps.index';

let empty = true;
let metricsUnavailable = false;
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account-a' } }) }));
vi.mock('@/lib/store', () => ({
  useData: () => ({
    workflows: empty
      ? []
      : [
          {
            id: 'alpha',
            name: 'alpha',
            runtime: 'node',
            state: 'running',
            memoryMb: 256,
            invocations24h: 3,
            avgDurationMs: 42,
            errorRatePct: 0,
            lastDeployedAt: Date.now() - 86_400_000,
            metricsUnavailable,
          },
          {
            id: 'beta',
            name: 'beta',
            runtime: 'node',
            state: 'running',
            memoryMb: 256,
            invocations24h: 0,
            avgDurationMs: 0,
            errorRatePct: 0,
            lastDeployedAt: Date.now(),
            metricsUnavailable,
          },
        ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
beforeEach(() => {
  empty = true;
  metricsUnavailable = false;
});
async function mount(entry = '/dashboard/apps') {
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/apps/',
    component: Apps.options.component,
    validateSearch: Apps.options.validateSearch,
  });
  const create = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/apps/new',
    component: () => <h1>New app wizard</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([route, create]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}
describe('Apps polish', () => {
  it.each(['text', 'state', 'runtime'])(
    'preserves foreign search and hash when changing %s',
    async (filter) => {
      empty = false;
      const router = await mount('/dashboard/apps?campaign=handoff#apps');
      if (filter === 'text') await userEvent.type(screen.getByRole('searchbox'), 'alpha');
      if (filter === 'state')
        await userEvent.click(screen.getByRole('button', { name: 'Running' }));
      if (filter === 'runtime')
        await userEvent.selectOptions(
          screen.getByRole('combobox', { name: 'Filter by runtime' }),
          'node'
        );
      expect(router.state.location.search.campaign).toBe('handoff');
      expect(router.state.location.hash).toBe('apps');
    }
  );
  it('clears only App filters and preserves unrelated URL context', async () => {
    empty = false;
    const router = await mount('/dashboard/apps?state=error&q=missing&campaign=handoff#apps');
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(router.state.location.search.campaign).toBe('handoff');
    expect(router.state.location.hash).toBe('apps');
    expect(router.state.location.search.q).toBeUndefined();
    expect(router.state.location.search.state).toBeUndefined();
    expect(screen.getByRole('button', { name: /alpha/ })).toBeInTheDocument();
  });
  it('takes the empty-state next action into New App', async () => {
    const router = await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Create your first app' }));
    expect(await screen.findByRole('heading', { name: 'New app wizard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/dashboard/apps/new');
  });
  it('uses the App noun and compact detail access without hiding state', async () => {
    empty = false;
    await mount();
    expect(screen.getByRole('columnheader', { name: 'App' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'p50 latency' })).toHaveClass(
      'hidden',
      'md:table-cell'
    );
    expect(screen.getByRole('columnheader', { name: 'State' })).not.toHaveClass('hidden');
    expect(screen.getByText('More details for alpha')).toBeInTheDocument();
  });
  it('shows unknown request metrics as missing, not as zero traffic', async () => {
    empty = false;
    metricsUnavailable = true;
    await mount();
    const row = screen.getByRole('button', { name: /alpha/ }).closest('tr')!;
    expect(row).not.toHaveTextContent('0.00%');
    expect(row).not.toHaveTextContent('42ms');
    expect(row.textContent).toContain('—');
  });
  it('orders apps by latest deploy when request metrics are unknown', async () => {
    empty = false;
    metricsUnavailable = true;
    await mount();
    const names = screen
      .getAllByRole('button', { name: /^(alpha|beta)/ })
      .map((b) => b.textContent);
    expect(names[0]).toMatch(/^beta/);
  });
});
