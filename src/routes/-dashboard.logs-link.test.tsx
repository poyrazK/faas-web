import { act, render, screen, waitFor } from '@testing-library/react';
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
import { Route as Logs } from './dashboard.logs';
const instance = 'c'.repeat(32);
const historical = 'd'.repeat(32);
const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  deployments: vi.fn(),
  apps: [
    { id: '1', slug: 'alpha' },
    { id: '2', slug: 'beta' },
  ],
}));
vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({ data: mocks.apps, isPending: false, error: null }),
  useAppDeployments: (slug: string) => {
    mocks.deployments(slug);
    return {
      data: {
        pages: [{ items: [{ id: 'dep', app_id: '1', status: 'live', created_at: '2026-09-01' }] }],
      },
      isPending: false,
      error: null,
    };
  },
  useAppInstances: () => ({ data: [{ id: 'c'.repeat(32), state: 'running' }] }),
}));
vi.mock('@/lib/api/logs', async (original) => ({
  ...(await original<typeof import('@/lib/api/logs')>()),
  useLogStream: (source: unknown, connected: boolean) => {
    mocks.stream(source, connected);
    return {
      lines: [],
      status: 'streaming',
      truncated: false,
      clear: vi.fn(),
      canRetry: false,
      retry: vi.fn(),
    };
  },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { plan: 'pro' } }) }));
beforeEach(() => {
  localStorage.clear();
  mocks.stream.mockClear();
  mocks.deployments.mockClear();
});
async function mount(entry: string) {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const logs = createRoute({
    getParentRoute: () => dashboard,
    path: 'logs',
    component: Logs.options.component,
    validateSearch: Logs.options.validateSearch,
  });
  const history = createMemoryHistory({ initialEntries: [entry] });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([logs])]),
    history,
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return { router, history };
}
describe('shared log investigations', () => {
  it('restores every archive coordinate and keeps a historical instance absent from the live list', async () => {
    await mount(
      `/dashboard/logs?app=beta&mode=archive&level=error&q=timeout%20%26%20retry&instance=${historical}&date=2026-09-28`
    );
    expect(screen.getByLabelText('Instance to read')).toHaveValue(historical);
    expect(screen.getByLabelText('Archive date')).toHaveValue('2026-09-28');
    expect(screen.getByLabelText('Filter log text')).toHaveValue('timeout & retry');
    expect(mocks.stream).toHaveBeenLastCalledWith(
      {
        kind: 'archive',
        slug: 'beta',
        instance: historical,
        date: '2026-09-28',
        level: 'error',
        grep: 'timeout & retry',
      },
      true
    );
    expect(mocks.deployments).not.toHaveBeenCalledWith('alpha');
  });
  it('applies text on Enter and restores controls and source on back/forward without losing pause', async () => {
    const { router, history } = await mount('/dashboard/logs?app=alpha&q=old');
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    const input = screen.getByLabelText('Filter log text');
    await userEvent.clear(input);
    await userEvent.type(input, 'new');
    expect(router.state.location.search.q).toBe('old');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.search.q).toBe('new'));
    await act(async () => {
      history.back();
    });
    await waitFor(() => expect(screen.getByLabelText('Filter log text')).toHaveValue('old'));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(mocks.stream).toHaveBeenLastCalledWith(
      { kind: 'live', slug: 'alpha', level: '', grep: 'old' },
      false
    );
    await act(async () => {
      history.forward();
    });
    await waitFor(() => expect(screen.getByLabelText('Filter log text')).toHaveValue('new'));
  });
  it('pins archive defaults in the URL and writes explicit date changes to history', async () => {
    const { router, history } = await mount('/dashboard/logs?app=alpha');
    await userEvent.click(screen.getByRole('button', { name: 'archive' }));
    await waitFor(() => expect(router.state.location.search.instance).toBe(instance));
    expect(router.state.location.search.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const date = router.state.location.search.date;
    await act(async () => {
      history.back();
    });
    await waitFor(() => expect(router.state.location.search.mode).toBeUndefined());
    await act(async () => {
      history.forward();
    });
    await waitFor(() => expect(screen.getByLabelText('Archive date')).toHaveValue(date));
  });
  it('never substitutes the remembered app for an unavailable target', async () => {
    localStorage.setItem('gregale.selectedApp', 'alpha');
    await mount('/dashboard/logs?app=deleted&mode=archive');
    expect(screen.getByText(/The app “deleted” is unavailable/)).toBeInTheDocument();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.deployments).not.toHaveBeenCalledWith('alpha');
    expect(mocks.deployments).not.toHaveBeenCalledWith('deleted');
  });
  it('validates stale saved filters and restores archive instance and date', async () => {
    localStorage.setItem(
      'gregale.logs.views',
      JSON.stringify([
        {
          name: 'Incident',
          app: 'beta',
          mode: 'archive',
          instance: historical,
          date: '2026-09-28',
          level: 'error',
          q: 'failed',
        },
        { name: 'Old', app: 'alpha', level: 'bogus', date: 'bad' },
      ])
    );
    const { router } = await mount('/dashboard/logs?app=alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Views' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Incident/ }));
    await waitFor(() => expect(router.state.location.search.instance).toBe(historical));
    expect(screen.getByLabelText('Archive date')).toHaveValue('2026-09-28');
    expect(screen.getByLabelText('Filter log text')).toHaveValue('failed');
    await userEvent.click(screen.getByRole('button', { name: 'Views' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Old/ }));
    await waitFor(() => expect(router.state.location.search.app).toBe('alpha'));
    expect(router.state.location.search.level).toBeUndefined();
    expect(router.state.location.search.date).toBeUndefined();
  });
});
