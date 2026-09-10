import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import {
  AccountAnalytics,
  AnalyticsWindowSelector,
  type AccountAnalyticsSearch,
} from './account-analytics';

const hooks = vi.hoisted(() => ({
  useAccountSlo: vi.fn(),
  useAppsMetrics: vi.fn(),
  useAppAnalytics: vi.fn(),
  useAppAnalyticsTimeseries: vi.fn(),
  useAppSlo: vi.fn(),
  useAppWakeTimeline: vi.fn(),
}));
// Network-backed hooks are the boundary; all panels and controls remain real.
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
  ...hooks,
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { plan: 'hobby' }, loading: false }),
}));

const stamp = '2026-09-08T10:00:00Z';
const account: components['schemas']['AccountSLOResponse'] = {
  window: '24h',
  source: 'prometheus',
  as_of: stamp,
  requests_total: 10001,
  error_rate_pct: 1.25,
  cold_boot_rate_pct: 2.75,
  request_duration: { p50_ms: 12, p95_ms: 53, p99_ms: 104 },
  throttled_total: 17,
  wake_queue_p95_ms: 8,
  instance_hours: 2,
  gb_hours: 1,
};
const metric = (count: number, errorRate: number): components['schemas']['AppMetricsResponse'] => ({
  app_id: String(count),
  range: '24h',
  source: 'prometheus',
  as_of: stamp,
  request_count: count,
  error_rate_pct: errorRate,
  cold_start_pct: errorRate,
  latency_p50_ms: errorRate,
  latency_p95_ms: errorRate * 2,
  latency_p99_ms: errorRate * 3,
  wake_p95_ms: 30,
});
const apps: components['schemas']['AppsMetricsResponse'] = {
  range: '24h',
  source: 'prometheus',
  as_of: stamp,
  apps: { alpha: metric(40, 9), beta: metric(800, 2) },
};
const analytics: components['schemas']['RequestAnalyticsResponse'] = {
  slug: 'alpha',
  since: '24h',
  from: stamp,
  until: stamp,
  as_of: stamp,
  window_clamped: false,
  requests: 31,
  error_requests: 2,
  error_rate_pct: 6.45,
  cold_boots: 3,
  p50_ms: 10,
  p95_ms: 20,
  p99_ms: 30,
  group_by: 'route',
  groups: [
    {
      value: '/orders',
      method: 'GET',
      requests: 31,
      error_requests: 2,
      error_rate_pct: 6.45,
      cold_boots: 3,
      p50_ms: 10,
      p95_ms: 20,
      p99_ms: 30,
    },
  ],
  groups_limit: 50,
  groups_truncated: false,
  routes: [],
  routes_limit: 50,
  routes_truncated: false,
};
const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const failed = (error: unknown) => ({ data: undefined, isPending: false, error, refetch: vi.fn() });
const pending = () => ({ data: undefined, isPending: true, error: null, refetch: vi.fn() });

function Harness({ initial = {} }: { initial?: AccountAnalyticsSearch }) {
  const [search, setSearch] = useState(initial);
  return (
    <>
      <AnalyticsWindowSelector search={search} setSearch={setSearch} />
      <AccountAnalytics search={search} setSearch={setSearch} />
      <output aria-label="URL search">{JSON.stringify(search)}</output>
    </>
  );
}
const searchState = () =>
  JSON.parse(screen.getByLabelText('URL search').textContent!) as AccountAnalyticsSearch;
const accountRegion = () => screen.getByRole('region', { name: 'Account overview' });
const appsRegion = () => screen.getByRole('region', { name: 'Apps' });

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useAccountSlo.mockReturnValue(ready(account));
  hooks.useAppsMetrics.mockReturnValue(ready(apps));
  hooks.useAppAnalytics.mockReturnValue(ready(analytics));
  hooks.useAppAnalyticsTimeseries.mockReturnValue(
    ready({
      slug: 'alpha',
      since: '24h',
      from: stamp,
      until: stamp,
      as_of: stamp,
      window_clamped: false,
      bucket: '1h',
      points: [],
    })
  );
  hooks.useAppSlo.mockReturnValue(ready({ ...account, app_id: 'a', app_slug: 'alpha' }));
  hooks.useAppWakeTimeline.mockReturnValue(
    ready({
      app: { app_id: 'a', slug: 'alpha' },
      wake_count_24h: 4,
      wake_count_with_meta: 4,
      at_capacity_count: 0,
      at_capacity_pct: 0,
      trigger_histogram: {},
      trigger_class_histogram: {},
      rows: [],
      as_of: stamp,
    })
  );
});

describe('AccountAnalytics', () => {
  it('shows server-wide scalars and derives rounded errors without summing apps', async () => {
    render(<Harness />);
    const overview = within(accountRegion());
    expect(await overview.findByText('10,001')).toBeInTheDocument();
    expect(await overview.findByText('125')).toBeInTheDocument();
    for (const value of ['1.25', '2.75', '12', '53', '104', '17']) {
      expect(await overview.findByText(value)).toBeInTheDocument();
    }
    expect(overview.queryByRole('img')).not.toBeInTheDocument();
  });

  it('uses the cross-app result as one searchable table sorted by requests', async () => {
    render(<Harness initial={{ app: 'alpha' }} />);
    const table = within(appsRegion());
    const rows = table.getAllByRole('button').filter((el) => el.tagName === 'TR');
    expect(rows[0]).toHaveTextContent('beta');
    expect(rows[1]).toHaveTextContent('alpha');
    expect(hooks.useAppsMetrics).toHaveBeenCalledTimes(1);
    await userEvent.click(table.getByRole('button', { name: 'Error rate' }));
    expect(table.getAllByRole('button').filter((el) => el.tagName === 'TR')[0]).toHaveTextContent(
      'alpha'
    );
    await userEvent.type(table.getByRole('searchbox'), 'BET');
    expect(table.queryByText('alpha')).not.toBeInTheDocument();
    expect(table.getByText('beta')).toBeInTheDocument();
  });

  it.each(['Requests', 'Error rate', 'Cold boots', 'p50', 'p95', 'p99', 'Wake p95 (fleet)'])(
    'allows sorting the %s numeric column',
    async (label) => {
      render(<Harness initial={{ app: 'alpha' }} />);
      const button = within(appsRegion()).getByRole('button', { name: label });
      await userEvent.click(button);
      expect(button.closest('th')).toHaveAttribute(
        'aria-sort',
        label === 'Requests' ? 'ascending' : 'descending'
      );
    }
  );

  it.each([undefined, 'missing'])('falls back to the first app for URL app %s', (app) => {
    render(<Harness initial={{ app }} />);
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
    expect(hooks.useAppAnalytics).toHaveBeenLastCalledWith('alpha', '24h', 'route');
  });

  it('uses a valid URL app and selects a different app in place while preserving search', async () => {
    render(
      <Harness
        initial={{ app: 'beta', window: '7d', group: 'route', route: '/orders', method: 'GET' }}
      />
    );
    expect(screen.getByRole('heading', { name: 'beta' })).toBeInTheDocument();
    await userEvent.click(within(appsRegion()).getByRole('button', { name: /alpha/ }));
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
    expect(within(appsRegion()).getByRole('button', { name: /alpha/ })).toHaveTextContent(
      'Selected'
    );
    expect(searchState()).toEqual({
      app: 'alpha',
      window: '7d',
      group: 'route',
      route: '/orders',
      method: 'GET',
    });
    expect(hooks.useAppSlo).toHaveBeenLastCalledWith('alpha', '24h', { enabled: true });
    expect(hooks.useAppWakeTimeline).toHaveBeenLastCalledWith('alpha');
    expect(screen.getByRole('heading', { name: 'Service level' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wake timeline' })).toBeInTheDocument();
  });

  it('uses one shared 24h/7d control for all four analytics reads and preserves the URL filters', async () => {
    render(<Harness initial={{ app: 'beta', group: 'route', route: '/orders', method: 'GET' }} />);
    expect(screen.getAllByRole('group', { name: 'Time range' })).toHaveLength(1);
    expect(screen.queryByLabelText('Analytics window')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(searchState()).toEqual({
      app: 'beta',
      window: '7d',
      group: 'route',
      route: '/orders',
      method: 'GET',
    });
    expect(hooks.useAccountSlo).toHaveBeenLastCalledWith('7d');
    expect(hooks.useAppsMetrics).toHaveBeenLastCalledWith('7d');
    expect(hooks.useAppAnalytics).toHaveBeenLastCalledWith('beta', '7d', 'route');
    expect(hooks.useAppAnalyticsTimeseries).toHaveBeenLastCalledWith('beta', '7d', {
      groupBy: 'route',
      route: '/orders',
      method: 'GET',
    });
  });

  it('persists and clears paired route filters without losing app/window/group', async () => {
    render(<Harness initial={{ app: 'beta', window: '7d', group: 'route' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Filter chart to GET /orders' }));
    expect(searchState()).toEqual({
      app: 'beta',
      window: '7d',
      group: 'route',
      route: '/orders',
      method: 'GET',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Clear route filter' }));
    expect(searchState()).toEqual({ app: 'beta', window: '7d', group: 'route' });
    await userEvent.click(screen.getByRole('button', { name: 'Filter chart to GET /orders' }));
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'country');
    expect(searchState()).toEqual({ app: 'beta', window: '7d', group: 'country' });
    expect(hooks.useAppAnalyticsTimeseries).toHaveBeenLastCalledWith('beta', '7d', {
      groupBy: 'country',
      route: undefined,
      method: undefined,
    });
  });

  it('shows degraded nullable apps telemetry with its source reason', () => {
    hooks.useAppsMetrics.mockReturnValue(
      ready({ ...apps, apps: null, source: 'degraded: prometheus timeout' })
    );
    render(<Harness />);
    expect(within(appsRegion()).getByText(/degraded: prometheus timeout/)).toBeInTheDocument();
    expect(within(appsRegion()).queryByText('No apps in this window.')).not.toBeInTheDocument();
    expect(hooks.useAppAnalytics).not.toHaveBeenCalled();
  });

  it('renders unavailable account tiles for degraded telemetry', () => {
    hooks.useAccountSlo.mockReturnValue(
      ready({ ...account, source: 'degraded: prometheus timeout' })
    );
    render(<Harness />);
    expect(within(accountRegion()).getByText(/degraded: prometheus timeout/)).toBeInTheDocument();
    expect(within(accountRegion()).getAllByText('unavailable')).toHaveLength(8);
  });

  it('shows account loading independently from an already available app table', () => {
    hooks.useAccountSlo.mockReturnValue(pending());
    render(<Harness />);
    expect(within(accountRegion()).getByText('Loading account analytics…')).toBeInTheDocument();
    expect(within(appsRegion()).getByText('beta')).toBeInTheDocument();
  });

  it('shows apps loading independently from account figures and does not mount disabled app queries', async () => {
    hooks.useAppsMetrics.mockReturnValue(pending());
    render(<Harness />);
    expect(within(appsRegion()).getByText('Loading…')).toBeInTheDocument();
    expect(await within(accountRegion()).findByText('10,001')).toBeInTheDocument();
    expect(hooks.useAppAnalytics).not.toHaveBeenCalled();
    expect(hooks.useAppSlo).not.toHaveBeenCalled();
  });

  it('shows empty reads without fabricating zero tiles or mounting disabled app queries', () => {
    hooks.useAccountSlo.mockReturnValue(ready(undefined));
    hooks.useAppsMetrics.mockReturnValue(ready({ ...apps, apps: {} }));
    render(<Harness />);
    expect(within(accountRegion()).getAllByText('unavailable')).toHaveLength(8);
    expect(screen.getByText('No account analytics are available yet.')).toBeInTheDocument();
    expect(screen.getByText('No apps in this window.')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(hooks.useAppAnalytics).not.toHaveBeenCalled();
  });

  it.each(['account', 'apps'] as const)(
    'prioritizes a %s error over stale data and pending',
    (scope) => {
      const hook = scope === 'account' ? hooks.useAccountSlo : hooks.useAppsMetrics;
      hook.mockReturnValue({
        ...pending(),
        data: scope === 'account' ? account : apps,
        error: new Error('Telemetry failed'),
      });
      render(<Harness />);
      const region = within(scope === 'account' ? accountRegion() : appsRegion());
      expect(region.getByRole('alert')).toHaveTextContent('Telemetry failed');
      expect(region.queryByText('Loading…')).not.toBeInTheDocument();
      if (scope === 'account') expect(region.getAllByText('unavailable')).toHaveLength(8);
    }
  );

  it('renders unreachable separately from empty', () => {
    hooks.useAppsMetrics.mockReturnValue(
      failed(new ApiError({ status: 503, code: 'http_503', title: 'Unavailable' }))
    );
    render(<Harness />);
    expect(within(appsRegion()).getByText(/Could not reach the API/)).toBeInTheDocument();
    expect(within(appsRegion()).queryByText('No apps in this window.')).not.toBeInTheDocument();
  });

  it.each(['account', 'apps', 'analytics'] as const)(
    'renders the %s plan gate by code',
    async (scope) => {
      const hook =
        scope === 'account'
          ? hooks.useAccountSlo
          : scope === 'apps'
            ? hooks.useAppsMetrics
            : hooks.useAppAnalytics;
      hook.mockReturnValue(
        failed(
          new ApiError({
            status: 403,
            code: 'plan_per_app_metrics_not_allowed',
            title: 'Upgrade',
            detail: 'Analytics require a paid plan.',
          })
        )
      );
      render(withRouter(<Harness />));
      expect(await screen.findByText('Analytics require a paid plan.')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  );

  it('does not turn a billing 402 into an upgrade gate', () => {
    hooks.useAppsMetrics.mockReturnValue(
      failed(new ApiError({ status: 402, code: 'billing_past_due', title: 'Invoice overdue' }))
    );
    render(<Harness />);
    expect(within(appsRegion()).getByRole('alert')).toHaveTextContent('Invoice overdue');
  });
});
