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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { spyApi } from '@/test/api';
import { Route as Apps } from './dashboard.apps.index';

let empty = true;
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
            lastDeployedAt: Date.now(),
          },
        ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
beforeEach(() => {
  empty = true;
  spyApi('GET').mockResolvedValue({
    data: { account_id: 'account-a', apps: [], evaluated_at: '2026-10-31T12:00:00Z' },
    response: new Response(),
  });
});
afterEach(() => vi.restoreAllMocks());
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
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </QueryClientProvider>
    );
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
    expect(screen.getByRole('columnheader', { name: 'Avg duration' })).toHaveClass(
      'hidden',
      'md:table-cell'
    );
    expect(screen.getByRole('columnheader', { name: 'State' })).not.toHaveClass('hidden');
    expect(screen.getByText('More details for alpha')).toBeInTheDocument();
  });
  it('keeps recently deleted apps restorable from the Apps page', async () => {
    await mount();
    expect(screen.getByRole('heading', { name: 'Recently deleted' })).toBeInTheDocument();
    expect(await screen.findByText('No apps deleted in the last 7 days.')).toBeInTheDocument();
  });
});
