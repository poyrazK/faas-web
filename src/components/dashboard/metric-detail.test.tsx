import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import MetricDetail from './metric-detail';
import type { MetricDetailRequest } from './metric-detail-search';

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  series: vi.fn(),
  slo: vi.fn(),
  rollup: vi.fn(),
  retry: vi.fn(),
}));
const scope = vi.hoisted(() => ({
  current: { project: null, label: '', appSlugs: null, settled: true, choices: [] } as {
    project: string | null;
    label: string;
    appSlugs: Set<string> | null;
    settled: boolean;
    choices: never[];
  },
}));
vi.mock('@/lib/project-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/project-scope')>()),
  useProjectScope: () => scope.current,
}));
vi.mock('@/lib/api/queries', () => ({
  useAppAnalytics: mocks.summary,
  useAppAnalyticsTimeseries: mocks.series,
  useAccountSlo: mocks.slo,
  useAppsMetrics: mocks.rollup,
}));
const point = {
  start: '2026-11-02T00:00:00Z',
  requests: 100,
  error_requests: 5,
  error_rate_pct: 5,
  cold_boots: 2,
  p50_ms: 10,
  p95_ms: 50,
  p99_ms: 90,
};
const summary = {
  ...point,
  from: point.start,
  until: '2026-11-03T00:00:00Z',
  groups: [{ ...point, value: '/orders', method: 'GET' }],
  groups_limit: 50,
  groups_truncated: false,
};
const request: MetricDetailRequest = {
  metric: 'requests',
  app: 'api',
  since: summary.from,
  until: summary.until,
};
const ready = (data: unknown) => ({ data, error: null, isPending: false, refetch: mocks.retry });
beforeEach(() => {
  vi.clearAllMocks();
  scope.current = { project: null, label: '', appSlugs: null, settled: true, choices: [] };
  mocks.summary.mockReturnValue(ready(summary));
  mocks.series.mockReturnValue(ready({ ...summary, points: [point] }));
});

it('uses exact bounds for both reads and preserves scope when selecting a route', async () => {
  const change = vi.fn();
  render(<MetricDetail request={request} onChange={change} />);
  expect(mocks.summary).toHaveBeenCalledWith('api', request.since, 'route', request.until);
  expect(mocks.series).toHaveBeenCalledWith(
    'api',
    request.since,
    expect.objectContaining({ until: request.until, groupBy: 'route' })
  );
  expect(screen.getByText(/end exclusive/).parentElement).toHaveTextContent('UTC');
  await userEvent.click(screen.getByRole('button', { name: /GET \/orders/ }));
  expect(change).toHaveBeenCalledWith({ ...request, route: '/orders', method: 'GET' });
});

it('offers keyboard-readable chart data and retains the metric when changing grouping', async () => {
  const change = vi.fn();
  render(<MetricDetail request={{ ...request, metric: 'p95' }} onChange={change} />);
  const chart = screen.getByRole('group', { name: /Explore Response time p95/ });
  chart.focus();
  await userEvent.keyboard('{Home}');
  expect(screen.getByRole('status')).toHaveTextContent('50 ms');
  await userEvent.click(screen.getByText('View hourly data'));
  expect(await screen.findByRole('table')).toHaveTextContent('Hour starting (UTC)');
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Break down metric by' }),
    'country'
  );
  expect(change).toHaveBeenCalledWith({ ...request, metric: 'p95', group: 'country' });
});

it('distinguishes no traffic from failed history and does not chart stale failed data', async () => {
  mocks.series.mockReturnValue(ready({ ...summary, points: [{ ...point, requests: 0 }] }));
  const view = render(<MetricDetail request={request} onChange={vi.fn()} />);
  expect(screen.getByText(/No requests in this window/)).toBeInTheDocument();
  mocks.series.mockReturnValue({
    ...ready({ ...summary, points: [point] }),
    error: new Error('History failed'),
  });
  view.rerender(<MetricDetail request={request} onChange={vi.fn()} />);
  expect(screen.queryByText(/No requests in this window/)).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: /Explore Requests/ })).not.toBeInTheDocument();
  expect(screen.getByText('History failed')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});

it('shows retention and incomplete telemetry, without fabricating a missing route aggregate', () => {
  mocks.series.mockReturnValue(
    ready({ ...summary, points: [point], telemetry_complete: false, window_clamped: true })
  );
  render(
    <MetricDetail
      request={{ ...request, metric: 'p95', route: '/not-in-top-groups', method: 'POST' }}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByText(/limited to the history/)).toBeInTheDocument();
  expect(screen.getByText(/Some request records are still missing/)).toBeInTheDocument();
  expect(screen.getByText(/window percentile is unavailable/)).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
});

it('shows account scalars and app rankings without inventing an account time series', async () => {
  mocks.slo.mockReturnValue(
    ready({
      source: 'prometheus',
      requests_total: 100,
      error_rate_pct: 5,
      cold_boot_rate_pct: 2,
      request_duration: { p50_ms: 10, p95_ms: 50, p99_ms: 90 },
    })
  );
  mocks.rollup.mockReturnValue(
    ready({
      source: 'prometheus',
      apps: { api: { source: 'prometheus', request_count: 100, error_rate_pct: 5 } },
    })
  );
  const change = vi.fn();
  render(
    <MetricDetail request={{ metric: 'requests', since: '7d', source: 'slo' }} onChange={change} />
  );
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/Account hourly history is unavailable/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /api/ }));
  expect(change).toHaveBeenCalledWith({
    metric: 'requests',
    since: '7d',
    app: 'api',
    source: undefined,
  });
});

it('adds up only the project’s apps in the add-up view, rates weighted by traffic', () => {
  scope.current = {
    project: 'acme-shop',
    label: 'acme-shop',
    appSlugs: new Set(['api', 'img']),
    settled: true,
    choices: [],
  };
  const app = (request_count: number, rate: number) => ({
    source: 'prometheus',
    request_count,
    error_rate_pct: rate,
    cold_start_pct: rate,
  });
  mocks.rollup.mockReturnValue(
    ready({
      source: 'prometheus',
      apps: { api: app(900, 1), img: app(100, 10), other: app(5_000, 50) },
    })
  );
  render(
    <MetricDetail
      request={{ metric: 'cold_rate', since: '24h', source: 'rollup' }}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByText(/^acme-shop · Last 24h/)).toBeInTheDocument();
  // (9 + 10) / 1,000 requests — `other` is outside the project.
  expect(screen.getByText('1.90%')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /other/ })).not.toBeInTheDocument();
});
