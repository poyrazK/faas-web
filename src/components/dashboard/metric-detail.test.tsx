import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import MetricDetail from './metric-detail';
import type { MetricDetailRequest } from './metric-detail-search';

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  series: vi.fn(),
  slo: vi.fn(),
  rollup: vi.fn(),
  instances: vi.fn(),
  apps: vi.fn(),
  usage: vi.fn(),
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
  useInstances: mocks.instances,
  useApps: mocks.apps,
}));
vi.mock('@/lib/api/org-billing', () => ({ useWorkspaceUsageSummary: mocks.usage }));

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
/** 24 complete hours: 40 an hour, then 80 an hour, busiest at 20:00. */
const day = Array.from({ length: 24 }, (_, h) => ({
  ...point,
  start: `2026-11-02T${String(h).padStart(2, '0')}:00:00Z`,
  requests: h === 20 ? 172 : h < 12 ? 40 : 80,
  error_requests: 0,
  error_rate_pct: 0,
}));
const summary = {
  ...point,
  from: point.start,
  until: '2026-11-03T00:00:00Z',
  groups: [
    { ...point, value: '/orders', method: 'GET', requests: 75 },
    { ...point, value: '/health', method: 'GET', requests: 25 },
  ],
  groups_limit: 50,
  groups_truncated: false,
};
const request: MetricDetailRequest = { metric: 'requests', app: 'api', since: '24h' };
const ready = (data: unknown) => ({ data, error: null, isPending: false, refetch: mocks.retry });

async function show(ui: React.ReactNode) {
  const view = render(withRouter(ui));
  await screen.findByRole('group', { name: 'Time window' });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  scope.current = { project: null, label: '', appSlugs: null, settled: true, choices: [] };
  mocks.summary.mockReturnValue(ready(summary));
  mocks.series.mockReturnValue(ready({ ...summary, points: [point] }));
});

it('reads a live window up to now and changes it in place', async () => {
  const change = vi.fn();
  await show(<MetricDetail request={request} onChange={change} />);
  expect(mocks.summary).toHaveBeenCalledWith('api', '24h', 'route', undefined);
  expect(mocks.series).toHaveBeenCalledWith(
    'api',
    '24h',
    expect.objectContaining({ until: undefined, groupBy: 'route' })
  );
  expect(screen.getByText(/All routes · Last 24 hours/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  expect(screen.queryByText(/end exclusive/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '7d' }));
  expect(change).toHaveBeenCalledWith({ ...request, since: '7d', until: undefined });
});

it('turns an old exact window into a live one when a preset is picked', async () => {
  const change = vi.fn();
  const exact = { ...request, since: summary.from, until: summary.until };
  await show(<MetricDetail request={exact} onChange={change} />);
  expect(screen.getByText(/Custom window/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '24h' }));
  expect(change).toHaveBeenCalledWith({ ...exact, since: '24h', until: undefined });
});

it('answers first: the figure, a verdict, the change and the busiest hour', async () => {
  mocks.series.mockReturnValue(ready({ ...summary, points: day }));
  await show(<MetricDetail request={request} onChange={vi.fn()} />);
  expect(screen.getByText('Busier than earlier')).toBeInTheDocument();
  // 12 complete hours each side: 12 × 40 before, 11 × 80 + 172 after.
  expect(screen.getByText(/1,052 in the last 12 hours, up from 480 before\./)).toBeInTheDocument();
  expect(screen.getByText(/Busiest: 02 Nov, 20:00 UTC, 172 that hour\./)).toBeInTheDocument();
});

it('shows each source’s share and focuses a route without losing the window', async () => {
  const change = vi.fn();
  await show(<MetricDetail request={request} onChange={change} />);
  const sources = screen.getByRole('list', { name: 'Where they came from' });
  expect(within(sources).getByText('75 · 75%')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /GET \/orders/ }));
  expect(change).toHaveBeenCalledWith({ ...request, route: '/orders', method: 'GET' });
});

it('splits by status, country or more, keeping the metric', async () => {
  const change = vi.fn();
  await show(<MetricDetail request={{ ...request, metric: 'p95' }} onChange={change} />);
  await userEvent.click(screen.getByRole('button', { name: 'Status codes' }));
  expect(change).toHaveBeenCalledWith({ ...request, metric: 'p95', group: 'status' });
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'More ways to split' }),
    'referrer_host'
  );
  expect(change).toHaveBeenCalledWith({ ...request, metric: 'p95', group: 'referrer_host' });
});

it('lets the reader pick an hour and read it, with every hour behind details', async () => {
  mocks.series.mockReturnValue(ready({ ...summary, points: day }));
  await show(<MetricDetail request={request} onChange={vi.fn()} />);
  const chart = screen.getByRole('group', { name: /Explore Requests.*Enter picks an hour/ });
  chart.focus();
  await userEvent.keyboard('{End}{ArrowLeft}{ArrowLeft}{ArrowLeft}{Enter}');
  expect(screen.getByText(/02 Nov, 20:00 UTC · 172 requests · 0 failed/)).toBeInTheDocument();
  await userEvent.click(screen.getByText('Exact window and hourly numbers'));
  expect(await screen.findByRole('table')).toHaveTextContent('Hour starting (UTC)');
  expect(screen.getByText(/two equal groups of complete hours/)).toBeInTheDocument();
});

it('links to the matching requests in the Debugger', async () => {
  await show(
    <MetricDetail
      request={{ ...request, metric: 'error_rate', route: '/orders', method: 'GET' }}
      onChange={vi.fn()}
    />
  );
  const link = screen.getByRole('link', { name: /See failed requests/ });
  const href = new URL(link.getAttribute('href')!, 'http://x');
  expect(href.pathname).toBe('/dashboard/apps/api');
  expect(Object.fromEntries(href.searchParams)).toMatchObject({
    tab: 'Debugger',
    debugView: 'requests',
    debugWindow: '24h',
    debugFilter: 'failed',
    debugQuery: '/orders',
  });
});

it('grades an error rate and says how many failed', async () => {
  await show(<MetricDetail request={{ ...request, metric: 'error_rate' }} onChange={vi.fn()} />);
  expect(screen.getByText('High')).toBeInTheDocument();
  expect(screen.getByText(/5 of 100 requests failed\./)).toBeInTheDocument();
});

it('offers a longer window when there was no traffic, and retries failed history', async () => {
  mocks.series.mockReturnValue(ready({ ...summary, points: [{ ...point, requests: 0 }] }));
  const view = await show(<MetricDetail request={request} onChange={vi.fn()} />);
  expect(
    screen.getByText(/No requests in the last 24 hours\. Try a longer window/)
  ).toBeInTheDocument();
  view.unmount();
  mocks.series.mockReturnValue({
    ...ready({ ...summary, points: [point] }),
    error: new Error('History failed'),
  });
  await show(<MetricDetail request={request} onChange={vi.fn()} />);
  expect(screen.queryByText(/Try a longer window/)).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: /Explore Requests/ })).not.toBeInTheDocument();
  expect(screen.getByText('History failed')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});

it('says when history is limited or still counting, without inventing a route total', async () => {
  mocks.series.mockReturnValue(
    ready({ ...summary, points: [point], telemetry_complete: false, window_clamped: true })
  );
  await show(
    <MetricDetail
      request={{ ...request, metric: 'p95', route: '/not-in-top-groups', method: 'POST' }}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByText(/plan keeps a limited history/)).toBeInTheDocument();
  expect(screen.getByText(/still being counted/)).toBeInTheDocument();
  expect(screen.getByText(/isn’t among the busiest/)).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
});

const rollupApp = (request_count: number, rate: number) => ({
  source: 'prometheus',
  request_count,
  error_rate_pct: rate,
  cold_start_pct: rate,
  latency_p95_ms: 40,
});

it('ranks apps for an account figure, with no chart, and opens an app in place', async () => {
  mocks.slo.mockReturnValue(
    ready({
      source: 'prometheus',
      requests_total: 100,
      error_rate_pct: 5,
      cold_boot_rate_pct: 2,
      request_duration: { p50_ms: 10, p95_ms: 50, p99_ms: 90 },
    })
  );
  mocks.rollup.mockReturnValue(ready({ source: 'prometheus', apps: { api: rollupApp(100, 5) } }));
  const change = vi.fn();
  await show(
    <MetricDetail request={{ metric: 'requests', since: '7d', source: 'slo' }} onChange={change} />
  );
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText('Apps, busiest first')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /api/ }));
  expect(change).toHaveBeenCalledWith({
    metric: 'requests',
    since: '7d',
    app: 'api',
    source: undefined,
  });
});

it('names the app behind most failures and links to them', async () => {
  mocks.rollup.mockReturnValue(
    ready({
      source: 'prometheus',
      apps: { checkout: rollupApp(1_000, 4), api: rollupApp(1_000, 1) },
    })
  );
  await show(
    <MetricDetail
      request={{ metric: 'error_rate', since: '24h', source: 'rollup' }}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByText('Worth a look')).toBeInTheDocument();
  expect(
    screen.getByText(/50 of 2,000 requests failed\. checkout had 80% of the failures\./)
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /checkout · 4.00%.*40 failed/ })).toBeInTheDocument();
  const link = screen.getByRole('link', { name: /See failed requests in checkout/ });
  expect(link.getAttribute('href')).toContain('/dashboard/apps/checkout');
});

it('flags one failing app even when the fleet looks healthy', async () => {
  mocks.rollup.mockReturnValue(
    ready({
      source: 'prometheus',
      apps: { billing: rollupApp(100, 20), api: rollupApp(10_000, 0.1) },
    })
  );
  await show(
    <MetricDetail
      request={{ metric: 'error_rate', since: '24h', source: 'rollup' }}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByText('One app needs a look')).toBeInTheDocument();
  expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
});

it('adds up only the project’s apps in the add-up view, rates weighted by traffic', async () => {
  scope.current = {
    project: 'acme-shop',
    label: 'acme-shop',
    appSlugs: new Set(['api', 'img']),
    settled: true,
    choices: [],
  };
  mocks.rollup.mockReturnValue(
    ready({
      source: 'prometheus',
      apps: { api: rollupApp(900, 1), img: rollupApp(100, 10), other: rollupApp(5_000, 50) },
    })
  );
  await show(
    <MetricDetail
      request={{ metric: 'cold_rate', since: '24h', source: 'rollup' }}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByText(/^acme-shop · Last 24 hours/)).toBeInTheDocument();
  // (9 + 10) / 1,000 requests — `other` is outside the project.
  expect(screen.getByText('1.90%')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /other/ })).not.toBeInTheDocument();
});

it('shows memory by app from running instances, with a link to Instances', async () => {
  mocks.usage.mockReturnValue(ready(undefined));
  mocks.apps.mockReturnValue(
    ready([
      { id: 'a1', slug: 'api' },
      { id: 'a2', slug: 'img' },
    ])
  );
  mocks.instances.mockReturnValue(
    ready({
      instances: [
        { app_id: 'a1', state: 'running', ram_mb: 512 },
        { app_id: 'a1', state: 'running', ram_mb: 512 },
        { app_id: 'a2', state: 'running', ram_mb: 256 },
        { app_id: 'a2', state: 'parked', ram_mb: 256 },
      ],
    })
  );
  render(
    withRouter(<MetricDetail request={{ metric: 'memory', since: '24h' }} onChange={vi.fn()} />)
  );
  expect(await screen.findByText(/Held by 3 running instances/)).toBeInTheDocument();
  expect(screen.getByText('1,280')).toBeInTheDocument();
  const apps = screen.getByRole('list', { name: 'Apps using the most memory' });
  expect(within(apps).getAllByRole('listitem')[0]).toHaveTextContent('api1,024 MB');
  expect(screen.getByRole('link', { name: /See instances/ })).toHaveAttribute(
    'href',
    '/dashboard/instances'
  );
});
