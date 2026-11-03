import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import { AppHealthPanel, assessmentCurrent } from './app-health';

type Assessment = components['schemas']['AppHealthResponse'];
type HistoryPage = components['schemas']['AppHealthHistoryPage'];

const hooks = vi.hoisted(() => ({
  useAppHealth: vi.fn(),
  useAppHealthHistory: vi.fn(),
  useCapabilityAccess: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({
  useAppHealth: hooks.useAppHealth,
  useAppHealthHistory: hooks.useAppHealthHistory,
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityAccess: hooks.useCapabilityAccess }));

const NOW = new Date('2026-11-03T12:00:00Z');
const at = (secondsAgo: number) => new Date(NOW.getTime() - secondsAgo * 1000).toISOString();

const assessment = (over: Partial<Assessment> = {}): Assessment => ({
  app_id: 'app-1',
  status: 'unhealthy',
  phase: 'serving',
  summary: 'No required replica is ready.',
  scope: 'default',
  evaluated_at: at(10),
  valid_for_seconds: 120,
  metrics_as_of: at(40),
  serving_deployment_ids: ['dep-live'],
  latest_deployment_id: 'dep-live',
  capacity: { known: true, required: 2, ready: 0, starting: 0, unready: 2, unknown: 0 },
  checks: [
    {
      code: 'readiness',
      status: 'fail',
      detail: 'No required replica is ready.',
      action: 'logs',
      findings: [
        {
          reason: 'required_probe_unready',
          status: 'fail',
          detail: 'The primary app probe reports not ready.',
          deployment_id: 'dep-live',
          instance_id: 'inst-1234567890abcdef',
          source: 'primary_app',
          observed_at: at(90),
        },
      ],
      findings_truncated: true,
    },
    {
      code: 'latest_deployment',
      status: 'warning',
      detail: 'The latest release failed; an older release still serves.',
      action: 'deployments',
      deployment_id: 'dep-failed',
    },
    {
      code: 'requests',
      status: 'pass',
      reason: 'requests_observed',
      detail: 'No server errors in the available sample.',
      action: 'metrics',
    },
  ],
  requests: {
    known: true,
    coverage: 'serving_deployments',
    window_seconds: 300,
    deployment_ids: ['dep-live'],
    request_count: 1240,
    server_errors: 3,
    error_rate_pct: 0.24,
    policy: {
      minimum_requests: 50,
      minimum_server_errors: 5,
      warning_error_rate_pct: 5,
      unhealthy_error_rate_pct: 25,
    },
  },
  ...over,
});

const read = <T,>(data: T | undefined, over: Record<string, unknown> = {}) => ({
  data,
  isPending: data === undefined,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
  ...over,
});

const historyPage = (over: Partial<HistoryPage> = {}): HistoryPage => ({
  app_id: 'app-1',
  scope: 'default',
  collector_fresh: true,
  interval_seconds: 30,
  latest: assessment(),
  entries: [
    {
      id: 'e3',
      kind: 'transition',
      observed_at: at(600),
      previous_status: 'healthy',
      assessment: assessment(),
    },
    { id: 'e2', kind: 'gap', observed_at: at(3600), assessment: assessment({ status: 'unknown' }) },
    {
      id: 'e1',
      kind: 'baseline',
      observed_at: at(7200),
      assessment: assessment({ status: 'healthy' }),
    },
  ],
  ...over,
});

const infinite = (pages: HistoryPage[] | undefined, over: Record<string, unknown> = {}) => ({
  data: pages ? { pages, pageParams: pages.map(() => '') } : undefined,
  isPending: pages === undefined,
  error: null,
  hasNextPage: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
  ...over,
});

const capability = {
  key: 'app-health',
  name: 'App health',
  maturity: 'beta',
  enabled: true,
  plans: ['free', 'hobby', 'pro', 'scale'],
};

async function mount(node: ReactNode) {
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({ getParentRoute: () => root, path: '/', component: () => node });
  const app = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/apps/$appSlug',
    component: () => null,
  });
  const plans = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/plans',
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([index, app, plans]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(<RouterProvider router={router as never} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  hooks.useCapabilityAccess.mockReturnValue({ access: 'on', capability, refresh: vi.fn() });
  hooks.useAppHealth.mockReturnValue(read(assessment()));
  hooks.useAppHealthHistory.mockReturnValue(infinite([historyPage()]));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('assessmentCurrent', () => {
  it('honours the validity the API gives the assessment', () => {
    const now = NOW.getTime();
    expect(assessmentCurrent(assessment({ evaluated_at: at(119) }), now)).toBe(true);
    expect(assessmentCurrent(assessment({ evaluated_at: at(121) }), now)).toBe(false);
    expect(assessmentCurrent(assessment({ evaluated_at: 'not a time' }), now)).toBe(false);
  });
});

describe('AppHealthPanel', () => {
  it('is labelled beta and says the read never wakes the app', async () => {
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'About Health' }));
    expect(screen.getByText(/never wakes or probes/)).toBeInTheDocument();
  });

  it('reads nothing and explains itself while the capability is off', async () => {
    hooks.useCapabilityAccess.mockReturnValue({ access: 'off', capability, refresh: vi.fn() });
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText('Not enabled for this account')).toBeInTheDocument();
    expect(hooks.useAppHealth).not.toHaveBeenCalled();
    expect(hooks.useAppHealthHistory).not.toHaveBeenCalled();
  });

  it('shows the status as icon and word, separate from the lifecycle phase', async () => {
    await mount(<AppHealthPanel slug="api" />);
    const status = screen.getByRole('status', { name: 'Health status' });
    expect(status).toHaveTextContent('Unhealthy');
    expect(status.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Serving')).toBeInTheDocument();
    expect(screen.getAllByText('No required replica is ready.').length).toBeGreaterThan(0);
  });

  it('lists every check with its status, findings and where to look next', async () => {
    await mount(<AppHealthPanel slug="api" />);
    const checks = screen.getByRole('list', { name: 'Health checks' });
    const items = within(checks).getAllByRole('listitem', { name: /check$/ });
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Readiness check',
      'Latest release check',
      'Requests check',
    ]);
    // The check's own status, then its finding's.
    expect(within(items[0]).getAllByText('Fail')).toHaveLength(2);
    expect(
      within(items[0]).getByText('The primary app probe reports not ready.')
    ).toBeInTheDocument();
    expect(within(items[0]).getByText(/Primary app/)).toBeInTheDocument();
    expect(within(items[0]).getByText(/More findings were left out/)).toBeInTheDocument();
    expect(within(items[0]).getByRole('link', { name: 'Inspect logs' })).toHaveAttribute(
      'href',
      '/dashboard/apps/api?tab=Logs'
    );
    expect(within(items[1]).getByText('Warning')).toBeInTheDocument();
    const release = within(items[1]).getByRole('link', { name: 'Inspect release' });
    expect(release.getAttribute('href')).toContain('tab=Deployments');
    expect(release.getAttribute('href')).toContain('deployment=dep-failed');
    expect(within(items[2]).getByText('Pass')).toBeInTheDocument();
  });

  it('shows replica counts and request counts only when they were measured', async () => {
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText(/0 of 2 required replicas ready/)).toBeInTheDocument();
    expect(screen.getByText(/1,240 requests/)).toBeInTheDocument();
    expect(screen.getByText(/3 server errors/)).toBeInTheDocument();
    cleanup();

    const base = assessment();
    hooks.useAppHealth.mockReturnValue(
      read(
        assessment({
          capacity: { known: false, required: 0, ready: 0, starting: 0, unready: 0, unknown: 0 },
          requests: { ...base.requests!, known: false, request_count: 0, server_errors: 0 },
        })
      )
    );
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText(/Replica readiness unconfirmed/)).toBeInTheDocument();
    expect(screen.queryByText(/required replicas ready/)).not.toBeInTheDocument();
    expect(screen.queryByText(/requests ·/)).not.toBeInTheDocument();
    expect(screen.getByText(/Request counts unconfirmed/)).toBeInTheDocument();
  });

  it('points a plan without request telemetry at the plans page', async () => {
    hooks.useAppHealth.mockReturnValue(
      read(
        assessment({
          status: 'unknown',
          checks: [
            {
              code: 'requests',
              status: 'unknown',
              reason: 'request_plan_restricted',
              detail:
                'Request telemetry is unavailable on this plan; structural checks remain available.',
            },
          ],
          requests: undefined,
        })
      )
    );
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByRole('status', { name: 'Health status' })).toHaveTextContent('Unconfirmed');
    expect(screen.getByRole('link', { name: 'View plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
  });

  it('tells an expected idle apart from health confidence', async () => {
    hooks.useAppHealth.mockReturnValue(
      read(
        assessment({
          status: 'healthy',
          phase: 'idle',
          summary: 'Idle at zero replicas.',
          capacity: { known: true, required: 0, ready: 0, starting: 0, unready: 0, unknown: 0 },
        })
      )
    );
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByRole('status', { name: 'Health status' })).toHaveTextContent('Healthy');
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText(/not a health verdict/)).toBeInTheDocument();
    expect(screen.getByText('No warm replicas required')).toBeInTheDocument();
  });

  it('hides an assessment once it outlives its validity, without a refetch', async () => {
    hooks.useAppHealth.mockReturnValue(read(assessment({ status: 'healthy' })));
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByRole('status', { name: 'Health status' })).toHaveTextContent('Healthy');
    act(() => {
      vi.advanceTimersByTime(115_000);
    });
    expect(screen.getByRole('status', { name: 'Health status' })).toHaveTextContent('Unconfirmed');
    expect(screen.getByText(/assessment expired/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Health checks' })).not.toBeInTheDocument();
  });

  it('lets a failed read take precedence over a cached healthy answer', async () => {
    const refetch = vi.fn();
    hooks.useAppHealth.mockReturnValue(
      read(assessment({ status: 'healthy' }), {
        error: new ApiError({ status: 0, code: 'network_error', title: 'Unreachable' }),
        refetch,
      })
    );
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.queryByRole('status', { name: 'Health status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Health checks' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Unreachable');
  });

  it('refreshes the assessment and its history on demand', async () => {
    const health = read(assessment());
    const history = infinite([historyPage()]);
    hooks.useAppHealth.mockReturnValue(health);
    hooks.useAppHealthHistory.mockReturnValue(history);
    await mount(<AppHealthPanel slug="api" />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh health' }));
    expect(health.refetch).toHaveBeenCalled();
    expect(history.refetch).toHaveBeenCalled();
  });

  it('reads recorded changes newest first, gaps included, and pages older ones', async () => {
    const history = infinite([historyPage({ next_cursor: 'cursor-1' })], { hasNextPage: true });
    hooks.useAppHealthHistory.mockReturnValue(history);
    await mount(<AppHealthPanel slug="api" />);
    const list = screen.getByRole('list', { name: 'Health history' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Healthy → Unhealthy');
    expect(rows[1]).toHaveTextContent('Assessment expired');
    expect(rows[2]).toHaveTextContent('First assessment');
    fireEvent.click(screen.getByRole('button', { name: 'Show older changes' }));
    expect(history.fetchNextPage).toHaveBeenCalled();
  });

  it('says when background collection has fallen behind', async () => {
    hooks.useAppHealthHistory.mockReturnValue(infinite([historyPage({ collector_fresh: false })]));
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText(/Background collection is behind/)).toBeInTheDocument();
  });

  it('asks for a fresh first page when an older page was pruned', async () => {
    const history = infinite([historyPage()], {
      isFetchNextPageError: true,
      error: new ApiError({ status: 404, code: 'not_found', title: 'Not found' }),
    });
    hooks.useAppHealthHistory.mockReturnValue(history);
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText(/no longer retained/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload newest' }));
    expect(history.refetch).toHaveBeenCalled();
  });
});
