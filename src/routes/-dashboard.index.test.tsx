import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAppsMetrics = vi.fn();

vi.mock('@/lib/store', () => ({
  useData: () => ({
    workflows: [
      {
        id: 'api',
        name: 'api',
        runtime: 'node22',
        memoryMb: 256,
        state: 'running',
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
  useAuth: () => ({ account: { status: 'active' }, user: { name: 'Ada Lovelace' } }),
}));

vi.mock('@/lib/api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/queries')>();
  return {
    ...actual,
    useAppsMetrics: (range: string) => useAppsMetrics(range),
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
    refetch: vi.fn(),
  };
}

beforeEach(() => {
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

    render(<RouterProvider router={router} />);
    expect(await screen.findByText('100')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '7d' }));

    expect(await screen.findByText('700')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toEqual({ range: '7d' }));
  });
});
