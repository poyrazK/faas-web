import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AwakeRoutesPanel, DependencyLatencyPanel } from './app-observability';

const hooks = vi.hoisted(() => ({
  useRouteAwake: vi.fn(),
  useDependencyLatency: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => hooks);

const ok = <T,>(data: T) => ({ data, isPending: false, error: null, refetch: vi.fn() });

async function mount(node: ReactNode) {
  const root = createRootRoute({ component: () => <>{node}</> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

describe('AwakeRoutesPanel', () => {
  it('ranks routes by awake share and names a periodic probe', async () => {
    hooks.useRouteAwake.mockReturnValue(
      ok({
        slug: 'api',
        awake_share: 0.95,
        gb_hours: 40,
        wakes: 37,
        window_clamped: false,
        routes: [
          {
            method: 'GET',
            route: '/health',
            requests: 10080,
            wakes: 2,
            awake_seconds: 1,
            awake_share: 0.62,
            gb_hours: 26,
            pattern: 'periodic',
            interval_seconds: 60,
            if_removed: { awake_seconds_saved: 1, gb_hours_saved: 1, wakes_change: 1 },
            suggestion: { kind: 'exclude', message: 'An uptime probe keeps the app awake.' },
          },
        ],
      })
    );
    await mount(<AwakeRoutesPanel slug="api" since="7d" />);
    expect(screen.getByText(/^Awake/, { selector: 'p' })).toHaveTextContent(
      'Awake 95% of the window'
    );
    const row = screen.getByRole('row', { name: /GET \/health/ });
    expect(within(row).getByText('62%')).toBeInTheDocument();
    expect(within(row).getByText('every ~60 s')).toBeInTheDocument();
    expect(within(row).getByText('An uptime probe keeps the app awake.')).toBeInTheDocument();
  });

  it('says when nothing kept the app awake', async () => {
    hooks.useRouteAwake.mockReturnValue(
      ok({ slug: 'api', awake_share: 0, gb_hours: 0, wakes: 0, routes: [] })
    );
    await mount(<AwakeRoutesPanel slug="api" since="7d" />);
    expect(screen.getByText('No requests kept this app awake in the window.')).toBeInTheDocument();
  });
});

describe('DependencyLatencyPanel', () => {
  it('flags a p95 regression against the baseline and admits sampling', async () => {
    hooks.useDependencyLatency.mockReturnValue(
      ok({
        complete: false,
        dependencies: [
          {
            type: 'app_dependency',
            kind: 'postgres',
            name: 'postgres orders',
            calls: 12400,
            error_calls: 3,
            error_rate_pct: 0.02,
            p50_ms: 160,
            p95_ms: 412,
            p99_ms: 660,
            p95_delta_ms: 272,
            regression: true,
            failure_regression: false,
          },
        ],
        edges: [],
      })
    );
    await mount(<DependencyLatencyPanel slug="api" since="24h" />);
    const row = screen.getByRole('row', { name: /postgres orders/ });
    expect(within(row).getByText('412 ms')).toBeInTheDocument();
    expect(within(row).getByText('+272 ms')).toBeInTheDocument();
    expect(screen.getByText(/Sampled: trace caps were reached/)).toBeInTheDocument();
  });
});
