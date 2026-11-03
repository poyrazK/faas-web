import { useState } from 'react';
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
vi.mock('@/components/dashboard/kit/chart', () => ({
  TimeChart: ({ series }: { series: Record<string, unknown> }) => (
    <div data-testid={'value' in series ? 'metric-chart' : 'chart'}>
      {Object.keys(series).map((key) => (
        <span key={key} data-testid={'value' in series ? 'metric-series' : 'series'}>
          {key}
        </span>
      ))}
    </div>
  ),
}));

const { AppAnalyticsBody, AppAnalyticsPanel } = await import('./app-analytics');

/** The app page keeps the panel's filters in the URL; local state stands in. */
function Panel({ slug }: { slug: string }) {
  const [search, setSearch] = useState({});
  return (
    <AppAnalyticsPanel
      slug={slug}
      search={search}
      onSearchChange={(patch) => setSearch((current) => ({ ...current, ...patch }))}
    />
  );
}

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
  localStorage.clear();
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
  it('shows the grouped table the API returned', async () => {
    render(<Panel slug="api" />);
    expect(await screen.findByText('/orders')).toBeInTheDocument();
    expect(screen.getByText('4000')).toBeInTheDocument();
  });

  it('draws the hourly series, which the API zero-fills', () => {
    render(<Panel slug="api" />);
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

  it('switches the chart between traffic, latency and cold starts', async () => {
    render(<Panel slug="api" />);
    const series = () => screen.getAllByTestId('series').map((el) => el.textContent);
    expect(series()).toEqual(['requests', 'error_requests']);
    await userEvent.click(screen.getByRole('button', { name: 'Latency' }));
    expect(series()).toEqual(['p50_ms', 'p95_ms', 'p99_ms']);
    await userEvent.click(screen.getByRole('button', { name: 'Cold starts' }));
    expect(series()).toEqual(['cold_boots']);
  });

  it('never plots a zero-filled idle hour as a 0 ms latency', async () => {
    useAppAnalyticsTimeseries.mockReturnValue(
      ready({
        slug: 'api',
        bucket: '1h',
        points: ['2026-09-08T08:00:00Z', '2026-09-08T09:00:00Z'].map((start) => ({
          start,
          requests: 0,
          error_requests: 0,
          error_rate_pct: 0,
          cold_boots: 0,
          p50_ms: 0,
          p95_ms: 0,
          p99_ms: 0,
        })),
      })
    );
    render(<Panel slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Latency' }));
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
    expect(screen.getByText('No requests in this window.')).toBeInTheDocument();
  });

  it('offers grouping by consumer', () => {
    render(<Panel slug="api" />);
    expect(screen.getByRole('option', { name: 'Consumer' })).toBeInTheDocument();
  });

  it('asks for the dimension the reader picked', async () => {
    render(<Panel slug="api" />);
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'country');
    expect(useAppAnalytics).toHaveBeenLastCalledWith('api', '24h', 'country');
  });

  it('says when the window was clamped to the plan retention', () => {
    useAppAnalytics.mockReturnValue(ready(analytics({ window_clamped: true })));
    render(<Panel slug="api" />);
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
    render(withRouter(<Panel slug="api" />));
    expect(await screen.findByText(/does not include per-app metrics/i)).toBeInTheDocument();
  });
});

describe('AppAnalyticsBody', () => {
  it('can defer its window control to the account page while keeping grouping', () => {
    render(
      <AppAnalyticsBody
        slug="api"
        since="7d"
        groupBy="route"
        showWindowSelector={false}
        onSinceChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onRouteChange={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Analytics window')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Group by')).toBeInTheDocument();
  });

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

it('uses one selected window for the summaries, grouped requests and charts', async () => {
  render(<Panel slug="api" />);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analytics window' }), '7d');
  expect(useAppAnalytics).toHaveBeenLastCalledWith('api', '7d', 'route');
  expect(useAppAnalyticsTimeseries).toHaveBeenLastCalledWith('api', '7d', expect.anything());
  expect(screen.getAllByRole('combobox', { name: 'Analytics window' })).toHaveLength(1);
  // The window percentile is the aggregate's 180 ms, not an average of hourly p95s.
  expect(document.querySelector('[data-metric-id="p95"]')).toHaveTextContent('180 ms');
});
