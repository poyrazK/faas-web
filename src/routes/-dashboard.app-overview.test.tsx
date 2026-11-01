import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
import { Route as AppRoute } from './dashboard.apps.$appSlug';
import { toWorkflow } from '@/lib/api/adapters';
import type { App, AppMetrics, Deployment } from '@/lib/api/queries';
import type { HourPoint } from '@/components/dashboard/traffic-pillars-geometry';

const fixtures = vi.hoisted(() => ({
  plan: 'free',
  status: 'active',
  url: 'https://alpha.example.test',
  deployments: [] as Deployment[],
  deploymentLoading: false,
  deploymentError: null as Error | null,
  metrics: undefined as AppMetrics | undefined,
  metricsLoading: false,
  metricsError: null as Error | null,
  series: undefined as { points: HourPoint[] } | undefined,
  seriesError: null as Error | null,
  seriesCalls: [] as { since: string; enabled: boolean | undefined }[],
  retry: vi.fn(),
  buildIds: [] as string[],
  stream: vi.fn(),
}));

const deployment = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'release-new',
  app_id: 'app-alpha',
  status: 'live',
  kind: 'github',
  image_digest: 'sha256:abcdef1234567890',
  created_at: '2026-09-12T12:00:00Z',
  min_instances: 0,
  traffic_percent: 100,
  build_id: 'build-new',
  ...over,
});
const metrics = (over: Partial<AppMetrics> = {}): AppMetrics => ({
  app_id: 'app-alpha',
  range: '24h',
  source: 'prometheus',
  as_of: '2026-09-12T12:00:00Z',
  request_count: 1200,
  error_rate_pct: 0,
  latency_p50_ms: 12,
  latency_p95_ms: 42,
  latency_p99_ms: 70,
  cold_start_pct: 5,
  wake_p95_ms: 300,
  ...over,
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { plan: fixtures.plan }, loading: false }),
}));
vi.mock('@/lib/api/logs', async (original) => ({
  ...(await original<object>()),
  useLogStream: (source: unknown, connected: boolean) => {
    fixtures.stream(source, connected);
    return {
      lines: [],
      status: 'streaming',
      truncated: false,
      canRetry: false,
      clear: vi.fn(),
      retry: vi.fn(),
    };
  },
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/store', () => ({
  useData: () => ({
    getWorkflow: () =>
      toWorkflow(
        {
          id: 'app-alpha',
          slug: 'alpha',
          type: 'function',
          runtime: 'node24',
          ram_mb: 256,
          status: fixtures.status,
          url: fixtures.url,
        } as App,
        undefined,
        fixtures.deployments[0]
      ),
    loading: false,
    error: null,
    refresh: fixtures.retry,
    redeploy: vi.fn(),
  }),
}));
vi.mock('@/components/dashboard/stateless-contract', () => ({
  StatelessContract: ({ slug }: { slug: string }) => (
    <div role="region" aria-label="Stateless contract">
      {slug}
    </div>
  ),
}));
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
  useAppInstances: () => ({ data: [{ id: 'c'.repeat(32), state: 'running' }] }),
  useAppDeployments: () => ({
    data: fixtures.deploymentLoading ? undefined : { pages: [{ items: fixtures.deployments }] },
    isPending: fixtures.deploymentLoading,
    error: fixtures.deploymentError,
    refetch: fixtures.retry,
    hasNextPage: false,
  }),
  useBuildRecords: (ids: string[]) => {
    fixtures.buildIds = ids;
    return [];
  },
  useAppMetrics: () => ({
    data: fixtures.metrics,
    isPending: fixtures.metricsLoading,
    error: fixtures.metricsError,
    refetch: fixtures.retry,
  }),
  useAppAnalyticsTimeseries: (_slug: string, since: string, options?: { enabled?: boolean }) => {
    fixtures.seriesCalls.push({ since, enabled: options?.enabled });
    return {
      data: fixtures.series,
      isPending: !fixtures.series && !fixtures.seriesError,
      error: fixtures.seriesError,
      refetch: fixtures.retry,
    };
  },
}));

async function mount(entry = '/dashboard/apps/alpha') {
  const root = createRootRoute({ component: Outlet });
  const app = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/apps/$appSlug',
    component: AppRoute.options.component,
    validateSearch: AppRoute.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([app]),
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
  fixtures.plan = 'free';
  fixtures.status = 'active';
  fixtures.url = 'https://alpha.example.test';
  fixtures.deployments = [deployment()];
  fixtures.deploymentLoading = false;
  fixtures.deploymentError = null;
  fixtures.metrics = undefined;
  fixtures.metricsError = null;
  fixtures.metricsLoading = false;
  fixtures.series = undefined;
  fixtures.seriesError = null;
  fixtures.seriesCalls = [];
  fixtures.retry.mockReset();
  fixtures.buildIds = [];
  fixtures.stream.mockClear();
});
afterEach(cleanup);

describe('App Overview', () => {
  it('opens a useful overview for Free accounts without fetching per-release builds', async () => {
    await mount();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('group', { name: 'App status' })).toHaveTextContent('Running');
    expect(screen.getByRole('region', { name: 'Latest release' })).toHaveTextContent('release-new');
    expect(screen.getByRole('link', { name: 'Endpoint alpha.example.test' })).toHaveAttribute(
      'href',
      'https://alpha.example.test/'
    );
    expect(screen.queryByRole('heading', { name: 'Per-app metrics' })).not.toBeInTheDocument();
    expect(fixtures.buildIds).toEqual([]);
  });

  it("shows the app's stateless contract on Overview only", async () => {
    const router = await mount();
    expect(screen.getByRole('region', { name: 'Stateless contract' })).toHaveTextContent('alpha');
    await act(async () => {
      await router.navigate({
        to: '/dashboard/apps/$appSlug',
        params: { appSlug: 'alpha' },
        search: { tab: 'Logs' },
      });
    });
    expect(screen.queryByRole('region', { name: 'Stateless contract' })).not.toBeInTheDocument();
  });

  it('offers to copy the live endpoint URL next to its link', async () => {
    await mount();
    expect(
      screen.getByRole('button', { name: 'Copy: endpoint https://alpha.example.test/' })
    ).toBeInTheDocument();
  });

  it('keeps app state distinct from a failed latest release and opens that exact failure', async () => {
    fixtures.deployments = [
      deployment({ status: 'failed', error_why: 'The start command was not found.' }),
      deployment({ id: 'release-live', created_at: '2026-09-11T12:00:00Z' }),
    ];
    const router = await mount('/dashboard/apps/alpha?keep=yes#context');
    expect(screen.getByRole('group', { name: 'App status' })).toHaveTextContent('Running');
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(attention).toHaveTextContent('The start command was not found.');
    await userEvent.click(within(attention).getByRole('button', { name: 'Inspect failure' }));
    expect(router.state.location.search).toMatchObject({
      tab: 'Deployments',
      deployment: 'release-new',
      releaseSection: 'overview',
      keep: 'yes',
    });
    expect(router.state.location.hash).toBe('context');
    await act(async () => {
      router.history.back();
    });
    expect(await screen.findByRole('region', { name: 'Latest release' })).toBeInTheDocument();
  });

  it.each(['cancelled', 'building'])(
    'does not turn a %s release into a failure',
    async (status) => {
      fixtures.deployments = [deployment({ status })];
      await mount();
      expect(screen.getByRole('region', { name: 'Latest release' })).toHaveTextContent(status);
      expect(screen.queryByRole('button', { name: 'Inspect failure' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^Endpoint / })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Copy: endpoint/ })).not.toBeInTheDocument();
    }
  );

  it('offers first deployment instead of implying that an empty app is running', async () => {
    fixtures.deployments = [];
    await mount();
    expect(screen.getByRole('group', { name: 'App status' })).toHaveTextContent('Not deployed');
    expect(screen.queryByRole('link', { name: /^Endpoint / })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Deploy your app' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it.each(['loading', 'error', 'stale'])(
    'keeps %s deployment evidence distinct from no deployments',
    async (state) => {
      fixtures.deploymentLoading = state === 'loading';
      fixtures.deploymentError = state !== 'loading' ? new Error('Network unavailable') : null;
      if (state !== 'stale') fixtures.deployments = [];
      await mount();
      const release = screen.getByRole('region', { name: 'Latest release' });
      expect(release).toHaveTextContent(
        state === 'loading' ? 'Loading' : state === 'stale' ? 'Last known' : 'unavailable'
      );
      expect(screen.queryByRole('button', { name: 'Deploy your app' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^Endpoint / })).not.toBeInTheDocument();
      if (state !== 'loading') {
        await userEvent.click(within(release).getByRole('button', { name: 'Retry releases' }));
        expect(fixtures.retry).toHaveBeenCalledOnce();
      }
    }
  );

  it.each(['degraded', 'error', 'loading', 'missing'])(
    'never renders %s metrics as a healthy zero',
    async (state) => {
      fixtures.plan = 'pro';
      fixtures.metrics =
        state === 'missing'
          ? undefined
          : metrics({ source: state === 'degraded' ? 'degraded: timeout' : 'prometheus' });
      fixtures.metricsLoading = state === 'loading';
      fixtures.metricsError = state === 'error' ? new Error('Metrics failed') : null;
      await mount();
      const activity = screen.getByRole('region', { name: 'Traffic snapshot' });
      expect(activity).not.toHaveTextContent('0.00%');
      expect(activity).not.toHaveTextContent('1.2K');
      expect(activity).toHaveTextContent(state === 'loading' ? 'Loading' : 'unavailable');
    }
  );

  it('links observed request errors to the app Errors tab', async () => {
    fixtures.plan = 'pro';
    fixtures.metrics = metrics({ error_rate_pct: 2.5 });
    const router = await mount();
    expect(screen.getByRole('region', { name: 'Traffic snapshot' })).toHaveTextContent('2.50%');
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Needs attention' })).getByRole('button', {
        name: 'Inspect errors',
      })
    );
    expect(router.state.location.search.tab).toBe('Errors');
  });

  it('draws the last 24 hours as a field of hourly pillars when the series is in', async () => {
    fixtures.plan = 'pro';
    fixtures.metrics = metrics();
    fixtures.series = {
      points: Array.from({ length: 24 }, (_, i) => ({
        requests: 50 + i,
        error_requests: 0,
        error_rate_pct: 0,
        cold_boots: 0,
        p95_ms: 40,
      })),
    };
    await mount();
    const activity = screen.getByRole('region', { name: 'Traffic snapshot' });
    expect(within(activity).getByRole('group', { name: /requests per hour/i })).toBeInTheDocument();
    expect(within(activity).getByRole('status')).toHaveTextContent('1.2k requests');
    expect(fixtures.seriesCalls.at(-1)).toEqual({ since: '24h', enabled: true });
  });

  it('keeps the plain totals when the hourly series cannot be read', async () => {
    fixtures.plan = 'pro';
    fixtures.metrics = metrics();
    fixtures.seriesError = new Error('Series failed');
    await mount();
    const activity = screen.getByRole('region', { name: 'Traffic snapshot' });
    expect(within(activity).queryByRole('group', { name: /requests per hour/i })).toBeNull();
    expect(activity).toHaveTextContent('1.2k');
    expect(activity).toHaveTextContent('42ms');
  });

  it('keeps the plain totals when the hourly series comes back empty', async () => {
    fixtures.plan = 'pro';
    fixtures.metrics = metrics();
    fixtures.series = { points: [] };
    await mount();
    const activity = screen.getByRole('region', { name: 'Traffic snapshot' });
    expect(within(activity).queryByRole('group', { name: /requests per hour/i })).toBeNull();
    expect(activity).toHaveTextContent('1.2k');
  });

  it('never asks Free for the hourly series it does not include', async () => {
    fixtures.plan = 'free';
    await mount();
    expect(fixtures.seriesCalls.length).toBeGreaterThan(0);
    expect(fixtures.seriesCalls.every((call) => call.enabled === false)).toBe(true);
  });

  it('treats a zero-request window as no traffic, not proof of health', async () => {
    fixtures.plan = 'pro';
    fixtures.metrics = metrics({ request_count: 0, latency_p95_ms: 0 });
    await mount();
    const activity = screen.getByRole('region', { name: 'Traffic snapshot' });
    expect(activity).toHaveTextContent('No requests');
    expect(activity).not.toHaveTextContent('0.00%');
    expect(activity).not.toHaveTextContent('0 ms');
  });

  it('preserves an unknown server status rather than claiming the app is idle', async () => {
    fixtures.status = 'maintenance_pending';
    await mount();
    const status = screen.getByRole('group', { name: 'App status' });
    expect(status).toHaveTextContent('maintenance_pending');
    expect(status).not.toHaveTextContent('Idle');
  });

  it('does not offer unsafe endpoint URLs', async () => {
    fixtures.url = 'javascript:alert(1)';
    await mount();
    expect(screen.queryByRole('link', { name: /^Endpoint / })).not.toBeInTheDocument();
  });

  it('renders an unfamiliar source kind as text without interpreting object properties', async () => {
    fixtures.deployments = [deployment({ kind: 'constructor' })];
    await mount();
    expect(screen.getByRole('region', { name: 'Latest release' })).toHaveTextContent('constructor');
  });

  it('preserves explicit Metrics links and supports keyboard access to Overview', async () => {
    await mount('/dashboard/apps/alpha?tab=Metrics');
    const pages = screen.getByRole('group', { name: 'Overview pages' });
    expect(within(pages).getByRole('button', { name: 'Metrics' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    within(pages).getByRole('button', { name: 'Overview' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('region', { name: 'Latest release' })).toBeInTheDocument();
  });
});

describe('App log investigation links', () => {
  it('restores archive coordinates from a direct app link and preserves other tab context', async () => {
    fixtures.plan = 'pro';
    const instance = 'd'.repeat(32);
    const router = await mount(
      `/dashboard/apps/alpha?tab=Logs&mode=archive&instance=${instance}&date=2026-09-28&level=error&q=timeout&request=req-1&keep=yes#context`
    );
    expect(screen.getByLabelText('Instance to read')).toHaveValue(instance);
    expect(fixtures.stream).toHaveBeenLastCalledWith(
      {
        kind: 'archive',
        slug: 'alpha',
        instance,
        date: '2026-09-28',
        level: 'error',
        grep: 'timeout',
      },
      true
    );
    await userEvent.click(screen.getByRole('button', { name: 'live' }));
    await waitFor(() => expect(router.state.location.search.mode).toBeUndefined());
    expect(router.state.location.search.instance).toBeUndefined();
    expect(router.state.location.search.date).toBeUndefined();
    expect(router.state.location.search).toMatchObject({
      request: 'req-1',
      keep: 'yes',
      q: 'timeout',
    });
    expect(router.state.location.hash).toBe('context');
    await act(async () => {
      router.history.back();
    });
    await waitFor(() => expect(screen.getByLabelText('Instance to read')).toHaveValue(instance));
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Observe' }));
    expect(screen.getByLabelText('Archive date')).toHaveValue('2026-09-28');
  });
  it('rejects invalid log parameters even when another tab validator preserves unknown context', async () => {
    const router = await mount(
      '/dashboard/apps/alpha?tab=Logs&mode=bad&level=debug&instance=bad%2Fid&date=2026-02-30&q=hello&keep=yes'
    );
    expect(router.state.location.search).toMatchObject({ keep: 'yes', q: 'hello' });
    for (const key of ['mode', 'level', 'instance', 'date'])
      expect(router.state.location.search[key]).toBeUndefined();
    expect(fixtures.stream).toHaveBeenLastCalledWith(
      { kind: 'live', slug: 'alpha', level: '', grep: 'hello' },
      true
    );
  });
  it('pins archive date and instance without losing a linked deployment', async () => {
    fixtures.plan = 'pro';
    const router = await mount(
      '/dashboard/apps/alpha?tab=Logs&mode=archive&deployment=release-new'
    );
    await waitFor(() => expect(router.state.location.search.instance).toBe('c'.repeat(32)));
    expect(router.state.location.search.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(router.state.location.search.deployment).toBe('release-new');
  });
});

describe('App header', () => {
  it.each(['Overview', 'Logs', 'Metrics'])('is the same on the %s tab', async (tab) => {
    await mount(`/dashboard/apps/alpha?tab=${tab}`);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('alpha');
    expect(screen.getByRole('group', { name: 'App status' })).toHaveTextContent('Running');
    expect(screen.getByRole('link', { name: 'Endpoint alpha.example.test' })).toHaveAttribute(
      'href',
      'https://alpha.example.test/'
    );
    expect(screen.getAllByRole('link', { name: /alpha\.example\.test/ })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'App status' })).not.toBeInTheDocument();
  });

  it('never links an unsafe address, on any tab', async () => {
    fixtures.url = 'javascript:alert(1)';
    await mount('/dashboard/apps/alpha?tab=Logs');
    for (const link of screen.getAllByRole('link'))
      expect(link.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });

  it('keeps Deploy as the one header button and the rest in the actions menu', async () => {
    fixtures.deployments = [
      deployment(),
      deployment({ id: 'release-old', created_at: '2026-09-11T12:00:00Z' }),
    ];
    await mount();
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeInTheDocument();
    for (const name of ['Park', 'Restart', 'Roll back'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More app actions' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Park', 'Restart', 'Roll back']);
  });
});
