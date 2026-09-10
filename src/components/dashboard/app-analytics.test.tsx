import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';

const useAppAnalytics = vi.fn();
const useAppAnalyticsTimeseries = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useAppAnalytics: (slug: string, since: string, groupBy: string) =>
    useAppAnalytics(slug, since, groupBy) as unknown,
  useAppAnalyticsTimeseries: (slug: string, since: string, options?: unknown) =>
    useAppAnalyticsTimeseries(slug, since, options) as unknown,
}));
vi.mock('@/components/dither-kit', () => ({
  Area: () => null,
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  Grid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const { AppAnalyticsBody, AppAnalyticsPanel } = await import('./app-analytics');

const ready = (data: unknown) => ({ data, isPending: false, error: null });
const analytics = (over: Record<string, unknown> = {}) => ({
  slug: 'api',
  since: '24h',
  from: '2026-09-07T10:00:00Z',
  until: '2026-09-08T10:00:00Z',
  window_clamped: false,
  requests: 8421,
  error_requests: 37,
  error_rate_pct: 0.44,
  cold_boots: 14,
  p50_ms: 42,
  p95_ms: 180,
  p99_ms: 420,
  group_by: 'route',
  groups: [
    {
      value: '/orders',
      method: 'GET',
      requests: 4000,
      error_requests: 20,
      error_rate_pct: 0.5,
      cold_boots: 6,
      p50_ms: 40,
      p95_ms: 170,
      p99_ms: 400,
    },
  ],
  groups_limit: 50,
  groups_truncated: false,
  routes: [],
  routes_limit: 50,
  routes_truncated: false,
  as_of: '2026-09-08T10:00:00Z',
  ...over,
});

beforeEach(() => {
  useAppAnalytics.mockReset().mockReturnValue(ready(analytics()));
  useAppAnalyticsTimeseries.mockReset().mockReturnValue(
    ready({
      slug: 'api',
      since: '24h',
      from: '2026-09-07T10:00:00Z',
      until: '2026-09-08T10:00:00Z',
      window_clamped: false,
      bucket: '1h',
      points: [
        {
          start: '2026-09-08T08:00:00Z',
          requests: 100,
          error_requests: 1,
          error_rate_pct: 1,
          cold_boots: 0,
          p50_ms: 40,
          p95_ms: 100,
          p99_ms: 200,
        },
        {
          start: '2026-09-08T09:00:00Z',
          requests: 140,
          error_requests: 0,
          error_rate_pct: 0,
          cold_boots: 1,
          p50_ms: 44,
          p95_ms: 120,
          p99_ms: 240,
        },
      ],
      as_of: '2026-09-08T10:00:00Z',
    })
  );
});

describe('AppAnalyticsPanel', () => {
  it('shows the aggregate tiles and the grouped table the API returned', async () => {
    render(<AppAnalyticsPanel slug="api" />);
    // Tile numbers count up, so the settled value is awaited.
    expect(await screen.findByText('8,421')).toBeInTheDocument();
    expect(screen.getByText('0.44')).toBeInTheDocument();
    expect(screen.getByText('/orders')).toBeInTheDocument();
    expect(screen.getByText('4000')).toBeInTheDocument();
  });

  it('draws the hourly series, which the API zero-fills', () => {
    render(<AppAnalyticsPanel slug="api" />);
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

  it('asks for the dimension the reader picked', async () => {
    render(<AppAnalyticsPanel slug="api" />);
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'country');
    expect(useAppAnalytics).toHaveBeenLastCalledWith('api', '24h', 'country');
  });

  it('says when the window was clamped to the plan retention', () => {
    useAppAnalytics.mockReturnValue(ready(analytics({ window_clamped: true })));
    render(<AppAnalyticsPanel slug="api" />);
    expect(screen.getByText(/clamped to the retention/i)).toBeInTheDocument();
  });

  it('renders the Free-plan 402 as the plan panel', async () => {
    useAppAnalytics.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        status: 402,
        code: 'plan_per_app_metrics_not_allowed',
        title: 'Not on your plan',
        detail: 'the free plan does not include per-app metrics.',
      }),
    });
    render(withRouter(<AppAnalyticsPanel slug="api" />));
    expect(await screen.findByText(/does not include per-app metrics/i)).toBeInTheDocument();
  });
});

describe('AppAnalyticsBody', () => {
  it('selects a route row and queries its paired route and method', async () => {
    const onRouteChange = vi.fn();
    render(
      <AppAnalyticsBody
        slug="api"
        since="24h"
        groupBy="route"
        onSinceChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onRouteChange={onRouteChange}
      />
    );

    const row = screen.getByRole('button', { name: 'Filter chart to GET /orders' });
    await userEvent.click(row);
    expect(onRouteChange).toHaveBeenCalledWith('/orders', 'GET');

    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(onRouteChange).toHaveBeenLastCalledWith('/orders', 'GET');
  });

  it('queries and clears the active route filter', async () => {
    const onRouteChange = vi.fn();
    render(
      <AppAnalyticsBody
        slug="api"
        since="24h"
        groupBy="route"
        route="/orders"
        method="GET"
        onSinceChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onRouteChange={onRouteChange}
      />
    );

    expect(useAppAnalyticsTimeseries).toHaveBeenLastCalledWith('api', '24h', {
      route: '/orders',
      method: 'GET',
      groupBy: 'route',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Clear route filter' }));
    expect(onRouteChange).toHaveBeenCalledWith(undefined, undefined);
  });

  it('clears the route filter when changing away from route grouping', async () => {
    const onGroupByChange = vi.fn();
    const onRouteChange = vi.fn();
    render(
      <AppAnalyticsBody
        slug="api"
        since="24h"
        groupBy="route"
        route="/orders"
        method="GET"
        onSinceChange={vi.fn()}
        onGroupByChange={onGroupByChange}
        onRouteChange={onRouteChange}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'country');
    expect(onGroupByChange).toHaveBeenCalledWith('country');
    expect(onRouteChange).toHaveBeenCalledWith(undefined, undefined);
  });

  it('renders disabled empty-slug queries as empty rather than permanently loading', () => {
    useAppAnalytics.mockReturnValue({ data: undefined, isPending: true, error: null });
    useAppAnalyticsTimeseries.mockReturnValue({ data: undefined, isPending: true, error: null });

    render(
      <AppAnalyticsBody
        slug=""
        since="24h"
        groupBy="route"
        onSinceChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onRouteChange={vi.fn()}
      />
    );

    expect(screen.getByText('No request analytics are available yet.')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('uses a timeseries plan-gate error when the aggregate query has another error', async () => {
    useAppAnalytics.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new Error('aggregate unavailable'),
    });
    useAppAnalyticsTimeseries.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        status: 402,
        code: 'plan_per_app_metrics_not_allowed',
        title: 'Not on your plan',
        detail: 'the free plan does not include per-app metrics.',
      }),
    });

    render(
      withRouter(
        <AppAnalyticsBody
          slug="api"
          since="24h"
          groupBy="route"
          onSinceChange={vi.fn()}
          onGroupByChange={vi.fn()}
          onRouteChange={vi.fn()}
        />
      )
    );

    expect(await screen.findByText(/does not include per-app metrics/i)).toBeInTheDocument();
  });
});
