import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { spyApi } from '@/test/api';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useAppsMetrics = vi.fn();
let plan = 'hobby';
let deployments: unknown[] = [];
const metricsRefetch = vi.fn();

vi.mock('@/lib/store', () => ({
  useData: () => ({
    workflows: [
      {
        id: 'api',
        name: 'api',
        runtime: 'node22',
        memoryMb: 256,
        state: 'error',
        url: 'https://api.example.com',
        invocations24h: 100,
        avgDurationMs: 24,
        coldStartP50Ms: 80,
        errorRatePct: 1,
        lastDeployedAt: Date.parse('2026-09-10T10:00:00Z'),
        version: 'abc1234',
      },
    ],
    deployments,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// The capability registry is a query; these pages render without a client here.
vi.mock('@/lib/api/capabilities', async (original) => ({
  ...(await original<typeof import('@/lib/api/capabilities')>()),
  useCapabilityRegistry: () => ({ query: { data: undefined }, phase: 'loading' }),
  useCapabilityAccess: () => ({ access: 'on', refresh: () => {} }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { status: 'active', plan }, user: { name: 'Ada Lovelace' } }),
}));

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
const companyUsage = vi.hoisted(() => ({
  rows: [
    {
      app_id: 'a',
      mb_seconds: 2 * 1024 * 3600,
      requests: 1,
      included_gb_hours: 1000,
      cpu_usec: 3.6e9,
    },
  ],
}));

vi.mock('@/lib/api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/queries')>();
  return {
    ...actual,
    useAppsMetrics: (range: string, options: unknown) => useAppsMetrics(range, options),
    useUsageSummary: () => ({
      data: {
        included_gb_hours: 100,
        used_gb_hours: 20,
        overage_gb_hours: 0,
        overage_cents: 0,
        used_cpu_hours: 4,
        month: '2026-09',
      },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    }),
    useInstances: () => ({
      data: { instances: [] },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    }),
    useDeployments: () => ({}),
    useApps: () => ({}),
  };
});

const { Route } = await import('./dashboard.index');

function metrics(range: string, requestCount: number) {
  const asOf = '2026-09-11T10:00:00Z';
  return {
    data: {
      range,
      source: 'prometheus',
      as_of: asOf,
      apps: {
        api: {
          app_id: 'app-1',
          range,
          source: 'prometheus',
          as_of: asOf,
          request_count: requestCount,
          latency_p50_ms: 24,
          latency_p95_ms: 60,
          latency_p99_ms: 90,
          error_rate_pct: 1,
          cold_start_pct: 2,
          wake_p95_ms: 80,
        },
      },
    },
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: metricsRefetch,
  };
}

const hours = (requests: number[], since: string) => ({
  slug: 'api',
  since,
  from: '2026-11-08T22:00:00Z',
  until: '2026-11-09T01:00:00Z',
  window_clamped: false,
  bucket: '1h',
  as_of: '2026-11-09T00:30:00Z',
  points: requests.map((n, i) => ({
    start: new Date(Date.parse('2026-11-08T22:00:00Z') + i * 3_600_000).toISOString(),
    requests: n,
    error_requests: Math.round(n / 100),
    error_rate_pct: 1,
    cold_boots: i,
    p50_ms: 20,
    p95_ms: 60,
    p99_ms: 90,
  })),
});

let get: ReturnType<typeof spyApi>;

beforeEach(() => {
  window.localStorage.clear();
  plan = 'hobby';
  deployments = [];
  metricsRefetch.mockReset();
  useAppsMetrics
    .mockReset()
    .mockImplementation((range: string) => metrics(range, range === '7d' ? 700 : 100));
  get = spyApi('GET').mockImplementation(async (path: string, init?: unknown) => {
    const since = (init as { params?: { query?: { since?: string } } })?.params?.query?.since;
    const data =
      path === '/v1/apps/{slug}/analytics/timeseries'
        ? hours(since === '7d' ? [500, 600, 300] : [100, 300, 200], since ?? '24h')
        : path === '/v1/orgs/{slug}/usage'
          ? companyUsage.rows
          : path === '/v1/usage'
            ? [
                {
                  app_id: 'app-1',
                  mb_seconds: 12 * 1024 * 3600,
                  requests: 1,
                  included_gb_hours: 100,
                },
              ]
            : {};
    return { data, response: new Response(null, { status: 200 }) };
  });
});

afterEach(() => get.mockRestore());

function renderOverview(withReleases = false) {
  const root = createRootRoute();
  const extra = withReleases
    ? [
        createRoute({
          getParentRoute: () => root,
          path: '/dashboard/releases',
          component: () => <h1>Releases</h1>,
        }),
      ]
    : [];
  const overview = Route.update({
    id: '/dashboard/',
    path: '/dashboard',
    getParentRoute: () => root,
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([overview, ...extra]),
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

describe('overview time window', () => {
  it('charts the summed hourly series and keeps the chosen window in the URL', async () => {
    const router = renderOverview();
    expect(await screen.findByRole('img', { name: '600 requests' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      '/v1/apps/{slug}/analytics/timeseries',
      expect.objectContaining({ params: { path: { slug: 'api' }, query: { since: '24h' } } })
    );

    await userEvent.click(
      within(screen.getByRole('group', { name: 'Time window' })).getByRole('button', {
        name: '7d',
      })
    );

    expect(await screen.findByRole('img', { name: '1,400 requests' })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toEqual({ range: '7d' }));
    expect(useAppsMetrics).toHaveBeenLastCalledWith('7d', { enabled: true });
  });

  it('labels wake p95 as the fleet-wide figure it is', async () => {
    renderOverview();
    expect(await screen.findByText('wake p95 80 ms · fleet-wide')).toBeInTheDocument();
  });
});

it('gates Free metrics and the window while keeping usage and instance reads', async () => {
  plan = 'free';
  renderOverview();
  expect(await screen.findByText('Metrics is available on Hobby and above')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
    'href',
    '/dashboard/plans'
  );
  expect(screen.queryByRole('group', { name: 'Time window' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Instances now' })).toBeInTheDocument();
  expect(await screen.findByText('20 GB-h used')).toBeInTheDocument();
  expect(get).not.toHaveBeenCalledWith('/v1/apps/{slug}/analytics/timeseries', expect.anything());
  expect(useAppsMetrics).toHaveBeenLastCalledWith('24h', { enabled: false });
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(metricsRefetch).not.toHaveBeenCalled();
});

it('shows unknown paid metrics for a degraded rollup instead of measured zeroes', async () => {
  useAppsMetrics.mockImplementation((range: string) => {
    const result = metrics(range, 0);
    result.data.source = 'degraded';
    return result;
  });
  renderOverview();
  expect(await screen.findByText(/^Metrics degraded\./)).toBeInTheDocument();
  expect(screen.queryByText(/wake p95/)).not.toBeInTheDocument();
  expect(screen.queryByText('Metrics is available on Hobby and above')).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('group', { name: 'Time window' })).getByRole('button', { name: '24h' })
  ).toBeEnabled();
});

it("shows the company's compute allowance in a company workspace, not the signed-in account's", async () => {
  workspace.org = 'acme';
  workspace.label = 'Acme';
  try {
    renderOverview();
    // Personal: 20 of 100 GB-h. Company: 2 of 1,000.
    expect(await screen.findByText('1,000 GB-h included')).toBeInTheDocument();
    expect(screen.getByText('2 GB-h used')).toBeInTheDocument();
    expect(screen.queryByText('100 GB-h included')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/v1/orgs/{slug}/usage', expect.anything());
    // The personal per-app breakdown is never read for a company.
    expect(get).not.toHaveBeenCalledWith('/v1/usage', expect.anything());
  } finally {
    workspace.org = null;
    workspace.label = 'Personal';
  }
});

describe('overview deployments column', () => {
  it.each(['pointer', 'keyboard'])(
    'opens a recent deployment in the releases hub using %s',
    async (input) => {
      deployments = [
        {
          id: 'dep-1',
          workflowId: 'api',
          version: 'abc1234',
          state: 'failed',
          commit: 'abc1234',
          message: 'Fix the thing',
          author: 'ada',
          createdAt: Date.now() - 60_000,
        },
      ];
      const root = createRootRoute();
      const overview = Route.update({
        id: '/dashboard/',
        path: '/dashboard',
        getParentRoute: () => root,
      } as never);
      const releases = createRoute({
        getParentRoute: () => root,
        path: '/dashboard/releases',
        component: () => <h1>Releases</h1>,
      });
      const router = createRouter({
        routeTree: root.addChildren([overview, releases]),
        history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
      });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      );
      const column = (await screen.findByRole('heading', { name: 'Deployments' })).closest(
        'section'
      )!;
      const row = within(column).getByRole('link', { name: /api.*failed/i });
      expect(row).toHaveAttribute('href', '/dashboard/releases?deployment=dep-1');
      if (input === 'keyboard') {
        row.focus();
        await userEvent.keyboard('{Enter}');
      } else await userEvent.click(row);
      expect(await screen.findByRole('heading', { name: 'Releases' })).toBeInTheDocument();
      expect(router.state.location.search).toEqual({ deployment: 'dep-1' });
    }
  );
});
