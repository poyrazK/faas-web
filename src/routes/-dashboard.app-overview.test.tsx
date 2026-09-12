import { act, cleanup, render, screen, within } from '@testing-library/react';
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
import { Route as AppRoute } from './dashboard.workflows.$workflowId';
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
  retry: vi.fn(),
  buildIds: [] as string[],
}));

const deployment = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'release-new',
  app_id: 'app-alpha',
  status: 'live',
  kind: 'github',
  image_digest: 'sha256:abcdef1234567890',
  created_at: '2026-09-12T12:00:00Z',
  rollback_on_5xx: false,
  first_5xx_count: 0,
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
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
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
}));

async function mount(entry = '/dashboard/workflows/alpha') {
  const root = createRootRoute({ component: Outlet });
  const app = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/workflows/$workflowId',
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
  fixtures.retry.mockReset();
  fixtures.buildIds = [];
});
afterEach(cleanup);

describe('App Overview', () => {
  it('opens a useful overview for Free accounts without fetching per-release builds', async () => {
    await mount();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'App status' })).toHaveTextContent('Running');
    expect(screen.getByRole('region', { name: 'Latest release' })).toHaveTextContent('release-new');
    expect(screen.getByRole('link', { name: 'Open app' })).toHaveAttribute(
      'href',
      'https://alpha.example.test/'
    );
    expect(screen.queryByRole('heading', { name: 'Per-app metrics' })).not.toBeInTheDocument();
    expect(fixtures.buildIds).toEqual([]);
  });

  it('keeps app state distinct from a failed latest release and opens that exact failure', async () => {
    fixtures.deployments = [
      deployment({ status: 'failed', error_why: 'The start command was not found.' }),
      deployment({ id: 'release-live', created_at: '2026-09-11T12:00:00Z' }),
    ];
    const router = await mount('/dashboard/workflows/alpha?keep=yes#context');
    expect(screen.getByRole('region', { name: 'App status' })).toHaveTextContent('Running');
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
      expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
    }
  );

  it('offers first deployment instead of implying that an empty app is running', async () => {
    fixtures.deployments = [];
    await mount();
    expect(screen.getByRole('region', { name: 'App status' })).toHaveTextContent('Not deployed');
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
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
      expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
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
    const status = screen.getByRole('region', { name: 'App status' });
    expect(status).toHaveTextContent('maintenance_pending');
    expect(status).not.toHaveTextContent('Idle');
  });

  it('does not offer unsafe endpoint URLs', async () => {
    fixtures.url = 'javascript:alert(1)';
    await mount();
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
  });

  it('renders an unfamiliar source kind as text without interpreting object properties', async () => {
    fixtures.deployments = [deployment({ kind: 'constructor' })];
    await mount();
    expect(screen.getByRole('region', { name: 'Latest release' })).toHaveTextContent('constructor');
  });

  it('preserves explicit Metrics links and supports keyboard access to Overview', async () => {
    await mount('/dashboard/workflows/alpha?tab=Metrics');
    const metricsTab = screen.getByRole('tab', { name: 'Metrics' });
    expect(metricsTab).toHaveAttribute('aria-selected', 'true');
    metricsTab.focus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    expect(await screen.findByRole('region', { name: 'Latest release' })).toBeInTheDocument();
  });
});
