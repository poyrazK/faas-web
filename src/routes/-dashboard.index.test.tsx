import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAppsMetrics = vi.fn();
let plan = 'hobby';
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
    deployments: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { status: 'active', plan }, user: { name: 'Ada Lovelace' } }),
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

vi.mock('@/components/dashboard/wind-flow', () => ({ WindFlow: () => null }));
vi.mock('@/components/dashboard/shapes', () => ({ FlowDotsField: () => null }));
vi.mock('@/components/amicro/magnetic', () => ({
  Magnetic: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/amicro/pointer-glow', () => ({ PointerGlow: () => null }));
vi.mock('@/components/amicro/tilt', () => ({
  Tilt: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));
vi.mock('@/components/amicro/word-reveal', () => ({
  WordReveal: ({ text }: { text: string }) => <>{text}</>,
}));
vi.mock('@/components/ui/spotlight-card', () => ({
  SpotlightCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

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
  metricsRefetch.mockReset();
  useAppsMetrics
    .mockReset()
    .mockImplementation((range: string) => metrics(range, range === '7d' ? 700 : 100));
});

describe('overview analytics window', () => {
  it.each([
    ['24h', '24h', 'pointer'],
    ['7d', '7d', 'keyboard'],
    ['1h', '24h', 'pointer'],
  ])(
    'opens Analytics from the heading with %s mapped to %s using %s',
    async (range, window, input) => {
      const root = createRootRoute();
      const overview = Route.update({
        id: '/dashboard/',
        path: '/dashboard',
        getParentRoute: () => root,
      } as never);
      const analytics = createRoute({
        getParentRoute: () => root,
        path: '/dashboard/analytics',
        component: () => <h1>Account analytics</h1>,
      });
      const router = createRouter({
        routeTree: root.addChildren([overview, analytics]),
        history: createMemoryHistory({ initialEntries: [`/dashboard?range=${range}`] }),
      });
      render(<RouterProvider router={router} />);
      const link = await screen.findByRole('link', { name: 'Analytics' });
      expect(link).toHaveAttribute('href', `/dashboard/analytics?window=${window}`);
      if (input === 'keyboard') {
        link.focus();
        await userEvent.keyboard('{Enter}');
      } else await userEvent.click(link);
      expect(await screen.findByRole('heading', { name: 'Account analytics' })).toBeInTheDocument();
      expect(router.state.location.search).toEqual({ window });
    }
  );

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

    render(<RouterProvider router={router} />);
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
  return render(<RouterProvider router={router} />);
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
  expect(screen.getByText('GB-h left')).toBeInTheDocument();
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
  expect(await screen.findByText('metrics degraded — unknowns read as —')).toBeInTheDocument();
  expect(screen.queryByText('Metrics is available on Hobby and above')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '7d' })).toBeEnabled();
});
