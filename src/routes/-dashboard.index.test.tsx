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
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAppsMetrics = vi.fn();
const useInstances = vi.fn();
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
vi.mock('@/lib/api/workspace-apps', async (original) => ({
  ...(await original<typeof import('@/lib/api/workspace-apps')>()),
  useWorkspaceTarget: () => workspace,
}));
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
    useInstances: (options: unknown) => useInstances(options),
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

beforeEach(() => {
  plan = 'hobby';
  deployments = [];
  workspace.org = null;
  workspace.label = 'Personal';
  workspace.ready = true;
  useInstances.mockReset().mockReturnValue({
    data: { instances: [] },
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  });
  metricsRefetch.mockReset();
  useAppsMetrics
    .mockReset()
    .mockImplementation((range: string) => metrics(range, range === '7d' ? 700 : 100));
});

describe('overview analytics window', () => {
  it('uses the selected range for the server rollup and preserves it in the URL', async () => {
    const root = createRootRoute();
    const overview = Route.update({
      id: '/dashboard/',
      path: '/dashboard',
      getParentRoute: () => root,
    } as never);
    const router = createRouter({
      routeTree: root.addChildren([overview]),
      history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    expect(await screen.findByText('100')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '7d' }));

    expect(await screen.findByText('700')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toEqual({ range: '7d' }));
  });
});

function renderOverview() {
  const root = createRootRoute();
  const overview = Route.update({
    id: '/dashboard/',
    path: '/dashboard',
    getParentRoute: () => root,
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([overview]),
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
  });
  // The company allowance is a real query; personal reads are mocked above.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

it('gates Free metrics and range controls while preserving usage and instance reads', async () => {
  plan = 'free';
  renderOverview();
  expect(await screen.findByText('Metrics is available on Hobby and above')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
    'href',
    '/dashboard/plans'
  );
  expect(screen.getByRole('button', { name: '7d' })).toBeDisabled();
  expect(screen.getByText('Memory now')).toBeInTheDocument();
  expect(screen.getByText('GB-hours left')).toBeInTheDocument();
  expect(screen.queryByText('metrics unavailable')).not.toBeInTheDocument();
  expect(screen.queryByText('Total requests')).not.toBeInTheDocument();
  expect(screen.queryByText('1.00%')).not.toBeInTheDocument();
  expect(useAppsMetrics).toHaveBeenLastCalledWith('24h', { enabled: false });
  await userEvent.click(screen.getByRole('button', { name: 'Refresh analytics' }));
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
  expect(screen.queryByText('Metrics is available on Hobby and above')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '7d' })).toBeEnabled();
});

describe('overview in a company workspace', () => {
  /** apid as a company member sees it: the org's usage, inventory and activity. */
  function companyApi() {
    return spyApi('GET').mockImplementation(async (path: string) => ({
      data:
        path === '/v1/orgs/{slug}/usage'
          ? companyUsage.rows
          : path === '/v1/orgs/{slug}/apps'
            ? {
                apps: [
                  {
                    id: '5f0c1c2e-0000-4000-8000-000000000001',
                    slug: 'acme-billing',
                    type: 'app',
                    status: 'active',
                    created_at: '2026-10-01T10:00:00Z',
                  },
                ],
              }
            : path === '/v1/orgs/{slug}/activity'
              ? {
                  items: [
                    {
                      id: '1',
                      occurred_at: '2026-10-02T10:00:00Z',
                      kind: 'app.deployed',
                      summary: 'Grace deployed acme-billing',
                      actor: {},
                      resource: {},
                      data: {},
                    },
                  ],
                }
              : {},
      response: new Response(null, { status: 200 }),
    }));
  }

  beforeEach(() => {
    workspace.org = 'acme';
    workspace.label = 'Acme';
  });

  it("shows the company's compute allowance, not the signed-in account's", async () => {
    const get = companyApi();
    try {
      renderOverview();
      // Personal: 80 of 100 GB-h left. Company: 998 of 1,000.
      expect(await screen.findByText('of 1,000')).toBeInTheDocument();
      expect(screen.queryByText('of 100')).not.toBeInTheDocument();
      expect(get).toHaveBeenCalledWith('/v1/orgs/{slug}/usage', expect.anything());
    } finally {
      get.mockRestore();
    }
  });

  it("lists the company's apps and activity and reads none of the personal routes", async () => {
    const get = companyApi();
    try {
      renderOverview();
      expect(await screen.findByText('acme-billing')).toBeInTheDocument();
      expect(await screen.findByText('Grace deployed acme-billing')).toBeInTheDocument();
      expect(screen.getByText('Acme')).toBeInTheDocument();
      // `/v1/apps/metrics` and `/v1/instances` answer for the signed-in account
      // whatever the workspace, so the company view never asks them.
      expect(useAppsMetrics).not.toHaveBeenCalled();
      expect(useInstances).not.toHaveBeenCalled();
      for (const personal of ['Requests', 'Error rate', 'Wake p95', 'Memory now', 'Deployments'])
        expect(screen.queryByText(personal)).not.toBeInTheDocument();
      // The personal app `api` exists only to decide links; it is not listed.
      expect(screen.queryByRole('link', { name: 'api' })).not.toBeInTheDocument();
      expect(get).toHaveBeenCalledWith('/v1/orgs/{slug}/apps', expect.anything());
      expect(get).toHaveBeenCalledWith('/v1/orgs/{slug}/activity', expect.anything());
    } finally {
      get.mockRestore();
    }
  });

  it('shows neither view until the workspace choice is known', async () => {
    workspace.ready = false;
    const get = companyApi();
    try {
      renderOverview();
      expect(await screen.findByText('Reading your workspace…')).toBeInTheDocument();
      expect(useAppsMetrics).not.toHaveBeenCalled();
      expect(useInstances).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
  });
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
