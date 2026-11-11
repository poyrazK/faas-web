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
  /** Request analytics, when it should differ from the platform metrics. */
  analytics: undefined as { requests: number; error_rate_pct: number } | undefined,
  analyticsError: null as Error | null,
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
  useAppAnalytics: () => ({
    data: fixtures.analyticsError
      ? undefined
      : fixtures.analytics
        ? {
            ...fixtures.analytics,
            error_requests: Math.round(
              (fixtures.analytics.requests * fixtures.analytics.error_rate_pct) / 100
            ),
            cold_boots: 0,
            groups: [],
            since: '24h',
          }
        : fixtures.metrics && fixtures.metrics.source === 'prometheus'
          ? {
              requests: fixtures.metrics.request_count,
              error_requests: Math.round(
                (fixtures.metrics.request_count * fixtures.metrics.error_rate_pct) / 100
              ),
              error_rate_pct: fixtures.metrics.error_rate_pct,
              p50_ms: fixtures.metrics.latency_p50_ms,
              p95_ms: fixtures.metrics.latency_p95_ms,
              p99_ms: fixtures.metrics.latency_p99_ms,
              cold_boots: 0,
              groups: [],
              since: '24h',
              from: '2026-09-11T12:00:00Z',
              until: '2026-09-12T12:00:00Z',
            }
          : undefined,
    isPending: fixtures.metricsLoading,
    error: fixtures.analyticsError ?? fixtures.metricsError,
    refetch: fixtures.retry,
  }),
  useAppAnalyticsTimeseries: () => ({
    data: { points: [] },
    isPending: false,
    error: null,
    refetch: fixtures.retry,
  }),
  useAppMetrics: () => ({
    data: fixtures.metrics,
    isPending: fixtures.metricsLoading,
    error: fixtures.metricsError,
    refetch: fixtures.retry,
  }),
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
  fixtures.analytics = undefined;
  fixtures.analyticsError = null;
  fixtures.retry.mockReset();
  fixtures.buildIds = [];
  fixtures.stream.mockClear();
});
afterEach(cleanup);

describe('App Overview', () => {
  it('opens a useful overview for Free accounts without fetching per-release builds', async () => {
    fixtures.deployments = [deployment({ revision: 43, commit_sha: 'f'.repeat(40) })];
    await mount();
    expect(screen.getByRole('combobox', { name: 'Section' })).toHaveValue('Overview');
    expect(screen.getByRole('group', { name: 'App status' })).toHaveTextContent('Running');
    const release = screen.getByRole('region', { name: 'Latest release' });
    expect(release).toHaveTextContent('v43 is live and serving all traffic.');
    // Short digests in the meta line; the full values are on hover and in the menu.
    expect(release).toHaveTextContent('commit fffffff · image abcdef1');
    expect(release).not.toHaveTextContent('f'.repeat(40));
    expect(within(release).getByText('fffffff')).toHaveAttribute('title', 'f'.repeat(40));
    // Free has no request metrics, so the all-clear says only what it can.
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(attention).toHaveTextContent('Nothing flagged so far.');
    expect(attention).toHaveTextContent('Request errors are tracked on Hobby and above.');
    expect(screen.getByRole('link', { name: 'Endpoint alpha.example.test' })).toHaveAttribute(
      'href',
      'https://alpha.example.test/'
    );
    expect(screen.queryByRole('heading', { name: 'Per-app metrics' })).not.toBeInTheDocument();
    expect(fixtures.buildIds).toEqual([]);
  });

  it("shows the app's local disk watch under Runtime", async () => {
    const router = await mount();
    expect(screen.queryByRole('region', { name: 'Stateless contract' })).not.toBeInTheDocument();
    await act(async () => {
      await router.navigate({
        to: '/dashboard/apps/$appSlug',
        params: { appSlug: 'alpha' },
        search: { tab: 'Runtime' },
      });
    });
    expect(screen.getByRole('region', { name: 'Stateless contract' })).toHaveTextContent('alpha');
  });

  it('offers to copy the live endpoint URL next to its link', async () => {
    await mount();
    expect(
      screen.getByRole('button', { name: 'Copy: endpoint https://alpha.example.test/' })
    ).toBeInTheDocument();
  });

  it('opens the release and keeps history, configuration and ids in the release menu', async () => {
    fixtures.deployments = [deployment({ revision: 43 })];
    const router = await mount();
    const release = screen.getByRole('region', { name: 'Latest release' });
    await userEvent.click(within(release).getByRole('button', { name: 'More release actions' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual([
      'See all versions',
      'View app configuration',
      'Copy release ID',
      'Copy image digest',
    ]);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'See all versions' }));
    expect(router.state.location.search.tab).toBe('Deployments');
    expect(router.state.location.search.deployment).toBeUndefined();
    await act(async () => {
      router.history.back();
    });
    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Latest release' })).getByRole('button', {
        name: /^Open release/,
      })
    );
    expect(router.state.location.search).toMatchObject({
      tab: 'Deployments',
      deployment: 'release-new',
      releaseSection: 'overview',
    });
  });

  it('keeps app state distinct from a failed latest release and opens that exact failure', async () => {
    fixtures.deployments = [
      deployment({
        status: 'failed',
        revision: 44,
        error_why: 'The start command was not found.',
      }),
      deployment({ id: 'release-live', revision: 43, created_at: '2026-09-11T12:00:00Z' }),
    ];
    const router = await mount('/dashboard/apps/alpha?keep=yes#context');
    expect(screen.getByRole('group', { name: 'App status' })).toHaveTextContent('Running');
    // What serves is the answer; the failed newer attempt is the attention item.
    expect(screen.getByRole('region', { name: 'Latest release' })).toHaveTextContent(
      'v43 is live and serving all traffic.'
    );
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(attention).toHaveTextContent('v44 failed to deploy. v43 is still serving.');
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
      fixtures.deployments = [deployment({ status, revision: 7 })];
      await mount();
      expect(screen.getByRole('region', { name: 'Latest release' })).toHaveTextContent(
        status === 'cancelled' ? 'The latest version, v7, was cancelled.' : 'v7 is building.'
      );
      expect(screen.queryByRole('button', { name: 'Inspect failure' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^Endpoint / })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Copy: endpoint/ })).not.toBeInTheDocument();
    }
  );

  it('offers first deployment instead of implying that an empty app is running', async () => {
    fixtures.deployments = [];
    await mount();
    expect(screen.getByRole('group', { name: 'App status' })).toHaveTextContent('Not deployed');
    expect(screen.getByRole('region', { name: 'Latest release' })).toHaveTextContent(
      'Nothing is deployed yet.'
    );
    expect(screen.getByRole('region', { name: 'Needs attention' })).toHaveTextContent(
      'No confirmed issues yet.'
    );
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

  it('links request errors over the bar to the app Errors tab', async () => {
    fixtures.plan = 'pro';
    fixtures.metrics = metrics({ error_rate_pct: 6.2 });
    const router = await mount();
    const traffic = screen.getByRole('region', { name: 'Traffic snapshot' });
    expect(traffic).toHaveTextContent('1.2K requests in the last 24 hours; 6.20% returned errors.');
    // Short card labels; what each figure means is behind the section's tip.
    expect(traffic).toHaveTextContent('95th percentile');
    expect(traffic).not.toHaveTextContent('Percentile of recorded responses');
    await userEvent.click(within(traffic).getByRole('button', { name: 'About these figures' }));
    expect(await screen.findByText(/not an average of hours/)).toBeInTheDocument();
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(attention).toHaveTextContent('Requests returned errors: 6.20% in the last 24 hours.');
    await userEvent.click(within(attention).getByRole('button', { name: 'Inspect errors' }));
    expect(router.state.location.search.tab).toBe('Errors');
  });

  it('quotes one error rate: Needs attention reads the figures Traffic reads', async () => {
    fixtures.plan = 'pro';
    fixtures.metrics = metrics({ error_rate_pct: 0.42 });
    fixtures.analytics = { requests: 6700, error_rate_pct: 1 };
    await mount();
    expect(screen.getByRole('region', { name: 'Traffic snapshot' })).toHaveTextContent(
      '1.00% returned errors'
    );
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    // Under 5%: reported neutrally, not flagged.
    expect(attention).toHaveTextContent('Nothing needs your attention.');
    expect(attention).toHaveTextContent('1.00% of requests returned errors, under the 5%');
    expect(within(attention).queryByRole('button', { name: 'Inspect errors' })).toBeNull();
    expect(document.body).not.toHaveTextContent('0.42%');
  });

  it('follows the Traffic window', async () => {
    fixtures.plan = 'pro';
    fixtures.analytics = { requests: 400, error_rate_pct: 12.5 };
    fixtures.metrics = metrics();
    await mount('/dashboard/apps/alpha?analyticsSince=7d');
    expect(screen.getByRole('region', { name: 'Needs attention' })).toHaveTextContent(
      'Requests returned errors: 12.50% in the last 7 days.'
    );
  });

  it('does not flag a high rate over too few requests', async () => {
    fixtures.plan = 'pro';
    fixtures.analytics = { requests: 10, error_rate_pct: 50 };
    fixtures.metrics = metrics();
    await mount();
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(attention).toHaveTextContent('Nothing flagged so far.');
    expect(attention).toHaveTextContent('too few to judge the error rate');
  });

  it('labels platform metrics as such when request analytics cannot be read', async () => {
    fixtures.plan = 'pro';
    fixtures.metrics = metrics({ error_rate_pct: 8 });
    fixtures.analyticsError = new Error('Analytics unavailable');
    await mount();
    expect(screen.getByRole('region', { name: 'Needs attention' })).toHaveTextContent(
      'Platform metrics show 8.00% of requests failing in the last 24 hours.'
    );
    expect(screen.getByRole('region', { name: 'Traffic snapshot' })).toHaveTextContent(
      'unavailable'
    );
  });

  it('treats a zero-request window as no traffic, not proof of health', async () => {
    fixtures.plan = 'pro';
    fixtures.metrics = metrics({ request_count: 0, latency_p95_ms: 0 });
    await mount();
    const activity = screen.getByRole('region', { name: 'Traffic snapshot' });
    expect(activity).toHaveTextContent('No requests in the last 24 hours.');
    expect(activity).not.toHaveTextContent('0.00%');
    expect(activity).not.toHaveTextContent('0 ms');
    expect(screen.getByRole('region', { name: 'Needs attention' })).toHaveTextContent(
      'can’t be judged'
    );
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

  it('preserves explicit Metrics links and switches back to Overview', async () => {
    await mount('/dashboard/apps/alpha?tab=Metrics');
    const section = screen.getByRole('combobox', { name: 'Section' });
    expect(section).toHaveValue('Metrics');
    await userEvent.selectOptions(section, 'Overview');
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
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Section' }), 'Overview');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Section' }), 'Logs');
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

describe('Invoke deep links', () => {
  it.each(['invoke=1', 'invoke=true', 'tab=Invoke'])(
    'opens the Invoke sheet from %s and preserves context when closed',
    async (query) => {
      const router = await mount(`/dashboard/apps/alpha?${query}&keep=yes#context`);
      expect(await screen.findByRole('dialog', { name: 'Invoke' })).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Invoke' })).not.toBeInTheDocument()
      );
      expect(router.state.location.search.invoke).toBeUndefined();
      expect(router.state.location.search.keep).toBe('yes');
      expect(router.state.location.hash).toBe('context');
    }
  );
});
