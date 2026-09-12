import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Route as Debug } from './dashboard.debug';
import { Route as App } from './dashboard.workflows.$workflowId';

const fixtures = vi.hoisted(() => ({
  requestState: 'ready',
  requestSample: 'normal',
  regressionState: 'ready',
  calls: [] as string[],
  compare: vi.fn(),
  retry: vi.fn(),
  requests: [
    {
      id: 'failed',
      deployment_id: 'dep-new',
      route: '/failed',
      method: 'GET',
      status: 500,
      latency_ms: 800,
      count: 1,
      cold_boot: false,
      trace_id: 'trace-1',
      received_at: '2026-09-11T09:00:00Z',
    },
    {
      id: 'slow',
      deployment_id: 'dep-new',
      route: '/slow',
      method: 'GET',
      status: 200,
      latency_ms: 1000,
      count: 1,
      cold_boot: false,
      received_at: '2026-09-11T09:00:00Z',
    },
    {
      id: 'cold',
      deployment_id: 'dep-new',
      route: '/cold',
      method: 'POST',
      status: 201,
      latency_ms: 40,
      count: 1,
      cold_boot: true,
      received_at: '2026-09-11T09:00:00Z',
    },
    {
      id: 'ordinary',
      deployment_id: 'dep-old',
      route: '/failed',
      method: 'GET',
      status: 200,
      latency_ms: 999,
      count: 1,
      cold_boot: false,
      received_at: '2026-09-11T09:00:00Z',
    },
  ],
  regression: {
    deployment_id: 'dep-new',
    route: '/failed',
    p95_ms: 800,
    p95_base_ms: 200,
    regression_factor: '4.00',
    affected_count: 8,
    first_detected_at: '2026-09-11T08:00:00Z',
    last_detected_at: '2026-09-11T09:00:00Z',
  },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { plan: 'pro' }, loading: false }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/store', () => ({
  useData: () => ({
    getWorkflow: () => ({
      id: 'alpha',
      name: 'alpha',
      runtime: 'node',
      memoryMb: 256,
      state: 'running',
    }),
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/api/queries', async (original) => {
  const actual = await original<object>();
  const ok = (data: unknown) => ({ data, isPending: false, error: null, refetch: fixtures.retry });
  const deployments = [
    {
      id: 'dep-new',
      app_id: 'app-1',
      status: 'active',
      kind: 'github',
      build_id: 'build-1',
      created_at: '2026-09-11T07:00:00Z',
    },
    {
      id: 'dep-old',
      app_id: 'app-1',
      status: 'superseded',
      kind: 'tarball',
      created_at: '2026-09-10T07:00:00Z',
    },
  ];
  return {
    ...actual,
    useApps: () =>
      ok([
        { id: 'app-1', slug: 'alpha' },
        { id: 'app-2', slug: 'beta' },
      ]),
    useAppDeployments: () => ({ ...ok({ pages: [{ items: deployments }] }), hasNextPage: false }),
    useDeployment: () => ok(deployments[0]),
    useBuilds: () => ok({ items: [] }),
    useAppMetrics: () => ok(undefined),
    useDebugRequests: (slug: string, _since: string, route?: string) => {
      fixtures.calls.push(slug);
      const requests =
        fixtures.requestSample === 'route-beyond-page'
          ? route === '/failed'
            ? [fixtures.requests[0]]
            : Array.from({ length: 20 }, (_, i) => ({
                ...fixtures.requests[1],
                id: `unrelated-${i}`,
              }))
          : fixtures.requestSample === 'other-deployment'
            ? [fixtures.requests[3]]
            : fixtures.requests;
      return {
        ...ok({ since: '1h', requests }),
        isPending: fixtures.requestState === 'loading',
        error: fixtures.requestState === 'error' ? new Error('Telemetry unavailable') : null,
      };
    },
    useDebugRegressions: () => ({
      ...ok({ since: '1h', regressions: [fixtures.regression] }),
      error:
        fixtures.regressionState === 'error' ? new Error('Regression lookup unavailable') : null,
    }),
    useDebugRequestEvidence: (_slug: string, id: string) =>
      ok(
        id
          ? {
              request: fixtures.requests.find((r) => r.id === id) ?? fixtures.requests[0],
              spans: [],
              spans_truncated: false,
              explanation: { status: 'unobserved', headline: 'No comparison evidence.' },
              generated_at: '2026-09-11T09:01:00Z',
            }
          : undefined
      ),
    useCompareDeployments: () => useMutation({ mutationFn: fixtures.compare }),
  };
});

async function mount(entry = '/dashboard/debug?app=alpha') {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const routes = [Debug, App].map((route, i) =>
    createRoute({
      getParentRoute: () => dashboard,
      path: ['debug', 'workflows/$workflowId'][i],
      component: route.options.component,
      validateSearch: route.options.validateSearch,
    })
  );
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren(routes)]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  return router;
}
beforeEach(() => {
  fixtures.requestState = 'ready';
  fixtures.requestSample = 'normal';
  fixtures.regressionState = 'ready';
  fixtures.calls = [];
  fixtures.compare.mockReset().mockResolvedValue({ routes: [] });
  fixtures.retry.mockClear();
  localStorage.clear();
});
afterEach(cleanup);

describe('Debugger investigation navigation', () => {
  it('restores quick filters and request detail through Back, Forward, and reload without losing unrelated context', async () => {
    const router = await mount('/dashboard/debug?app=alpha&debugFilter=failed&keep=yes#evidence');
    expect(screen.getByLabelText('Quick filter')).toHaveValue('failed');
    expect(screen.queryByText('/slow')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('/failed'));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ request: 'failed', keep: 'yes' })
    );
    expect(router.state.location.hash).toBe('evidence');
    expect(screen.getByRole('heading', { name: 'What happened' })).toBeInTheDocument();
    await act(async () => router.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => router.history.forward());
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    const href = router.state.location.href;
    cleanup();
    await mount(href);
    expect(screen.getByRole('heading', { name: 'What happened' })).toBeInTheDocument();
  });

  it.each([
    ['slow', '/slow'],
    ['cold', '/cold'],
    ['regressions', '/failed'],
  ])(
    'filters %s only from explicit telemetry or matched deployment and route',
    async (filter, route) => {
      await mount(`/dashboard/debug?app=alpha&debugFilter=${filter}`);
      expect(screen.getByText(route)).toBeInTheDocument();
      expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(1);
      expect(screen.getByText(/Slow:.*1,000 ms/)).toBeInTheDocument();
    }
  );

  it('uses the same investigation body and URL state in the app Debugger tab', async () => {
    const router = await mount(
      '/dashboard/workflows/alpha?tab=Debugger&debugFilter=cold&keep=yes#app-context'
    );
    expect(screen.getByLabelText('Quick filter')).toHaveValue('cold');
    fireEvent.click(screen.getByRole('button', { name: 'Regressions' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        tab: 'Debugger',
        debugView: 'regressions',
        keep: 'yes',
      })
    );
    expect(router.state.location.hash).toBe('app-context');
  });

  it('honors a linked app and clears app-owned IDs when switching the global app', async () => {
    const router = await mount(
      '/dashboard/debug?app=beta&request=failed&debugSource=dep-old&debugMirror=dep-new&keep=yes#context'
    );
    expect(fixtures.calls.every((slug) => slug === 'beta')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The app picker is a listbox, not a native <select>: open it and choose.
    await userEvent.click(screen.getByLabelText('Select an app'));
    await userEvent.click(await screen.findByRole('option', { name: 'alpha' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ app: 'alpha', keep: 'yes' })
    );
    expect(router.state.location.search).not.toHaveProperty('debugSource');
    expect(router.state.location.search).not.toHaveProperty('debugMirror');
  });

  it('does not silently investigate another app when the linked app is missing', async () => {
    await mount('/dashboard/debug?app=deleted&request=failed');
    expect(screen.getByText(/selected app is unavailable/i)).toBeInTheDocument();
    // A trigger carries its value as its label, not as a form value.
    expect(screen.getByLabelText('Select an app')).toHaveTextContent('deleted');
    expect(fixtures.calls).toEqual([]);
  });

  it('shows request read errors and does not turn failed regression lookups into an empty regression result', async () => {
    fixtures.requestState = 'error';
    await mount();
    expect(screen.getByText('Telemetry unavailable')).toBeInTheDocument();
    cleanup();
    fixtures.requestState = 'ready';
    fixtures.regressionState = 'error';
    await mount('/dashboard/debug?app=alpha&debugFilter=regressions');
    expect(screen.getByText('Regression lookup unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/No requests match/)).not.toBeInTheDocument();
  });

  it('opens a stable regression drilldown and selects the current deployment for comparison without inventing a baseline ID', async () => {
    const router = await mount('/dashboard/debug?app=alpha&debugView=regressions&keep=yes#context');
    fireEvent.click(screen.getByText('/failed'));
    await waitFor(() =>
      expect(router.state.location.search.regression).toBe('["dep-new","/failed"]')
    );
    const detail = screen.getByRole('region', { name: 'Regression details' });
    expect(within(detail).getByText('800 ms')).toBeInTheDocument();
    expect(within(detail).getByText('200 ms')).toBeInTheDocument();
    expect(within(detail).getByText('2026-09-11T08:00:00Z')).toBeInTheDocument();
    expect(within(detail).getByText('2026-09-11T09:00:00Z')).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: /failed.*500/ })).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: /ordinary/ })).not.toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: 'Compare this deployment' }));
    await waitFor(() => expect(screen.getByLabelText('Deployment B')).toHaveValue('dep-new'));
    expect(screen.getByLabelText('Deployment A')).toHaveValue('');
    expect(router.state.location.search).toMatchObject({
      debugView: 'compare',
      debugMirror: 'dep-new',
      debugRoute: '/failed',
      keep: 'yes',
    });
  });

  it('restores comparison IDs and displays available source and time in deployment labels', async () => {
    const router = await mount(
      '/dashboard/debug?app=alpha&debugView=compare&debugSource=dep-old&debugMirror=dep-new&debugRoute=%2Ffailed&debugWindow=6h&keep=yes#context'
    );
    expect(screen.getByLabelText('Deployment A')).toHaveValue('dep-old');
    expect(screen.getByLabelText('Deployment B')).toHaveValue('dep-new');
    expect(
      within(screen.getByLabelText('Deployment B')).getByRole('option', {
        name: /github.*2026-09-11/,
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    await waitFor(() =>
      expect(fixtures.compare.mock.calls[0]?.[0]).toEqual({
        source: 'dep-old',
        mirror: 'dep-new',
        since: '6h',
        route: '/failed',
      })
    );
    fireEvent.change(screen.getByLabelText('Compare window'), { target: { value: '1h' } });
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ debugWindow: '1h', keep: 'yes' })
    );
    expect(router.state.location.hash).toBe('context');
  });

  it('explains a missing regression selection without dropping the deep link', async () => {
    const router = await mount(
      '/dashboard/debug?app=alpha&debugView=regressions&regression=%5B%22missing%22%2C%22%2Fgone%22%5D'
    );
    expect(screen.getByText(/selected regression is not in this window/i)).toBeInTheDocument();
    expect(router.state.location.search.regression).toBe('["missing","/gone"]');
  });

  it('includes the resolved global app in a newly selected investigation URL', async () => {
    localStorage.setItem('gregale.selectedApp', 'beta');
    const router = await mount('/dashboard/debug?keep=yes#context');
    fireEvent.change(screen.getByLabelText('Quick filter'), { target: { value: 'cold' } });
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        app: 'beta',
        debugFilter: 'cold',
        keep: 'yes',
      })
    );
  });

  it('keeps investigation context when moving between app tabs and browser history', async () => {
    const router = await mount(
      '/dashboard/workflows/alpha?tab=Debugger&debugFilter=cold&keep=yes#context'
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        tab: 'Metrics',
        debugFilter: 'cold',
        keep: 'yes',
      })
    );
    expect(router.state.location.hash).toBe('context');
    await act(async () => router.history.back());
    expect(await screen.findByLabelText('Quick filter')).toHaveValue('cold');
  });

  it('does not label a zero current percentile as infinitely faster or a missing side as both sides missing', async () => {
    fixtures.compare.mockResolvedValue({
      source: 'dep-old',
      mirror: 'dep-new',
      routes: [
        { route: '/zero', source_p95_ms: 50, mirror_p95_ms: 0, source_count: 8, mirror_count: 2 },
        { route: '/missing', source_p95_ms: 50, source_count: 8 },
      ],
    });
    await mount(
      '/dashboard/debug?app=alpha&debugView=compare&debugSource=dep-old&debugMirror=dep-new'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    expect(await screen.findByText('/zero')).toBeInTheDocument();
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
    expect(screen.getByText('No comparable percentile on one or both sides')).toBeInTheDocument();
    expect(screen.getByText('Ratio unavailable at zero')).toBeInTheDocument();
  });

  it('clears comparison results on URL window changes and restores selections with Back', async () => {
    fixtures.compare.mockResolvedValue({
      source: 'dep-old',
      mirror: 'dep-new',
      routes: [{ route: '/previous-window', source_p95_ms: 50, mirror_p95_ms: 100 }],
    });
    const router = await mount(
      '/dashboard/debug?app=alpha&debugView=compare&debugSource=dep-old&debugMirror=dep-new'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    expect(await screen.findByText('/previous-window')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Compare window'), { target: { value: '1h' } });
    await waitFor(() => expect(screen.queryByText('/previous-window')).not.toBeInTheDocument());
    await act(async () => router.history.back());
    expect(screen.getByLabelText('Compare window')).toHaveValue('24h');
    expect(screen.getByLabelText('Deployment B')).toHaveValue('dep-new');
  });

  it('renders compare errors, missing deployment selection, loading telemetry and invalid URL values honestly', async () => {
    fixtures.compare.mockRejectedValue(new Error('Comparison unavailable'));
    await mount(
      '/dashboard/debug?app=alpha&debugView=compare&debugSource=dep-old&debugMirror=dep-new'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    expect(await screen.findByText('Comparison unavailable')).toBeInTheDocument();
    cleanup();
    await mount(
      '/dashboard/debug?app=alpha&debugView=compare&debugSource=deleted&debugMirror=dep-new'
    );
    expect(
      screen.getByText(/selected deployment is not in the loaded history/i)
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Compare' }).at(-1)).toBeDisabled();
    cleanup();
    fixtures.requestState = 'loading';
    await mount(
      '/dashboard/debug?app=alpha&debugView=invalid&debugWindow=forever&debugFilter=unknown&request=%7B%7D'
    );
    expect(screen.getByLabelText('Quick filter')).toHaveValue('all');
    expect(screen.getByLabelText('Window')).toHaveValue('1h');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('No requests recorded in this window.')).not.toBeInTheDocument();
  });

  it('falls back to Overview for an invalid app tab while preserving debugger and unrelated parameters', async () => {
    await mount('/dashboard/workflows/alpha?tab=invalid&debugFilter=slow&keep=yes');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('restores comparison result text filtering through Back, Forward, and copied URL reload after explicitly rerunning', async () => {
    fixtures.compare.mockResolvedValue({
      source: 'dep-old',
      mirror: 'dep-new',
      routes: [
        { route: '/orders', source_p95_ms: 50, mirror_p95_ms: 100 },
        { route: '/users', source_p95_ms: 20, mirror_p95_ms: 40 },
      ],
    });
    const router = await mount(
      '/dashboard/debug?app=alpha&debugView=compare&debugSource=dep-old&debugMirror=dep-new&keep=yes#context'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    expect(await screen.findByText('/orders')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Filter by route…'), {
      target: { value: 'orders' },
    });
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ debugQuery: 'orders', keep: 'yes' })
    );
    expect(router.state.location.hash).toBe('context');
    expect(screen.queryByText('/users')).not.toBeInTheDocument();
    await act(async () => router.history.back());
    expect(await screen.findByText('/users')).toBeInTheDocument();
    await act(async () => router.history.forward());
    await waitFor(() => expect(screen.queryByText('/users')).not.toBeInTheDocument());
    const copiedURL = router.state.location.href;
    cleanup();
    await mount(copiedURL);
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    expect(await screen.findByText('/orders')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter by route…')).toHaveValue('orders');
    expect(screen.queryByText('/users')).not.toBeInTheDocument();
  });

  it.each([
    ['Compare window', '1h'],
    ['Deployment A', 'dep-new'],
    ['Deployment B', 'dep-old'],
  ])(
    'keeps the focused %s control connected when its selection changes and removes stale results',
    async (label, value) => {
      fixtures.compare.mockResolvedValue({
        source: 'dep-old',
        mirror: 'dep-new',
        routes: [{ route: '/stale', source_p95_ms: 50, mirror_p95_ms: 100 }],
      });
      await mount(
        '/dashboard/debug?app=alpha&debugView=compare&debugSource=dep-old&debugMirror=dep-new'
      );
      fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
      expect(await screen.findByText('/stale')).toBeInTheDocument();
      const control = screen.getByLabelText(label);
      control.focus();
      fireEvent.keyDown(control, { key: 'ArrowDown' });
      fireEvent.change(control, { target: { value } });
      await waitFor(() => expect(screen.getByLabelText(label)).toHaveValue(value));
      expect(control).toHaveFocus();
      expect(control.isConnected).toBe(true);
      expect(screen.queryByText('/stale')).not.toBeInTheDocument();
    }
  );

  it('keeps keyboard focus while editing the exact route and hides the previous route result', async () => {
    const user = userEvent.setup();
    fixtures.compare.mockResolvedValue({
      source: 'dep-old',
      mirror: 'dep-new',
      routes: [{ route: '/stale-route', source_p95_ms: 50, mirror_p95_ms: 100 }],
    });
    const router = await mount(
      '/dashboard/debug?app=alpha&debugView=compare&debugSource=dep-old&debugMirror=dep-new&debugRoute=%2Forders'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    expect(await screen.findByText('/stale-route')).toBeInTheDocument();
    const control = screen.getByLabelText('Exact route');
    control.focus();
    await user.keyboard('{End}/new');
    await waitFor(() => expect(router.state.location.search.debugRoute).toBe('/orders/new'));
    expect(control).toHaveFocus();
    expect(screen.queryByText('/stale-route')).not.toBeInTheDocument();
  });

  it('discards errors without replacing the focused controls and ignores late responses for previous parameters', async () => {
    fixtures.compare.mockRejectedValueOnce(new Error('Old comparison failure'));
    await mount(
      '/dashboard/debug?app=alpha&debugView=compare&debugSource=dep-old&debugMirror=dep-new'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    expect(await screen.findByText('Old comparison failure')).toBeInTheDocument();
    const control = screen.getByLabelText('Compare window');
    control.focus();
    fireEvent.change(control, { target: { value: '1h' } });
    await waitFor(() =>
      expect(screen.queryByText('Old comparison failure')).not.toBeInTheDocument()
    );
    expect(control).toHaveFocus();
    let resolve!: (value: unknown) => void;
    fixtures.compare.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.change(control, { target: { value: '6h' } });
    await waitFor(() => expect(control).toHaveValue('6h'));
    await act(async () =>
      resolve({ routes: [{ route: '/late-old-window', source_p95_ms: 50, mirror_p95_ms: 100 }] })
    );
    expect(screen.queryByText('/late-old-window')).not.toBeInTheDocument();
  });

  it('requests the selected regression route before sampling so unrelated recent traffic cannot hide it', async () => {
    fixtures.requestSample = 'route-beyond-page';
    await mount(
      '/dashboard/debug?app=alpha&debugView=regressions&regression=%5B%22dep-new%22%2C%22%2Ffailed%22%5D'
    );
    const detail = screen.getByRole('region', { name: 'Regression details' });
    expect(within(detail).getByRole('button', { name: /failed.*500/ })).toBeInTheDocument();
    expect(
      within(detail).getByText(/up to 20 recent.*exact route.*all deployments/i)
    ).toBeInTheDocument();
  });

  it('qualifies affected-request and quick-filter emptiness as bounded samples', async () => {
    fixtures.requestSample = 'other-deployment';
    await mount(
      '/dashboard/debug?app=alpha&debugView=regressions&regression=%5B%22dep-new%22%2C%22%2Ffailed%22%5D'
    );
    expect(
      screen.getByText(/No request rows for this deployment in the loaded route sample/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Other matching requests may exist outside this sample/i)
    ).toBeInTheDocument();
    cleanup();
    await mount('/dashboard/debug?app=alpha&debugFilter=cold');
    expect(
      screen.getByText(/No requests match these filters in the loaded sample/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/up to 20 recent.*across all routes/i)).toBeInTheDocument();
  });

  it('does not describe text-hidden regression or comparison rows as absent observations or traffic', async () => {
    await mount('/dashboard/debug?app=alpha&debugView=regressions&debugQuery=unmatched');
    expect(screen.getByText('No returned regressions match this text filter.')).toBeInTheDocument();
    cleanup();
    fixtures.compare.mockResolvedValue({
      routes: [{ route: '/orders', source_p95_ms: 50, mirror_p95_ms: 100 }],
    });
    await mount(
      '/dashboard/debug?app=alpha&debugView=compare&debugSource=dep-old&debugMirror=dep-new&debugQuery=unmatched'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    expect(
      await screen.findByText('No returned comparison routes match this text filter.')
    ).toBeInTheDocument();
  });

  it('qualifies an empty exact-route comparison without claiming the deployments served no traffic elsewhere', async () => {
    await mount(
      '/dashboard/debug?app=alpha&debugView=compare&debugSource=dep-old&debugMirror=dep-new&debugRoute=%2Forders'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare' }).at(-1)!);
    expect(
      await screen.findByText(
        'No comparison traffic was returned for the selected route in this window.'
      )
    ).toBeInTheDocument();
  });
});
