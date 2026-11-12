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

const healthy = (over: Partial<Assessment> = {}) => {
  const base = assessment();
  return assessment({
    status: 'healthy',
    summary: 'Available evidence shows no health issues.',
    capacity: { known: true, required: 2, ready: 2, starting: 0, unready: 0, unknown: 0 },
    checks: [
      {
        code: 'deployment',
        status: 'pass',
        detail: 'Traffic-bearing releases in the selected scope are present.',
      },
      { code: 'readiness', status: 'pass', detail: '2 replicas passed the readiness gates.' },
      {
        code: 'requests',
        status: 'pass',
        reason: 'requests_observed',
        detail: 'No server errors in the available sample.',
        action: 'metrics',
      },
    ],
    requests: { ...base.requests!, server_errors: 0, error_rate_pct: 0 },
    ...over,
  });
};

const checkTiles = () =>
  within(screen.getByRole('list', { name: 'Health checks' })).getAllByRole('listitem', {
    name: /check$/,
  });

describe('AppHealthPanel', () => {
  it('is labelled beta and keeps its caveats behind help tips', async () => {
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText(/default-scope HTTP serving/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'About Health' }));
    expect(screen.getByText(/never wakes or probes/)).toBeInTheDocument();
    expect(screen.getByText(/default-scope HTTP serving/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About these times' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Errors · last 5 min' })).toBeInTheDocument();
  });

  it('reads nothing and explains itself while the capability is off', async () => {
    hooks.useCapabilityAccess.mockReturnValue({ access: 'off', capability, refresh: vi.fn() });
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText('Not enabled for this account')).toBeInTheDocument();
    expect(hooks.useAppHealth).not.toHaveBeenCalled();
    expect(hooks.useAppHealthHistory).not.toHaveBeenCalled();
  });

  it('answers a healthy app in one sentence, with nothing to do', async () => {
    hooks.useAppHealth.mockReturnValue(read(healthy()));
    await mount(<AppHealthPanel slug="api-gateway" />);
    expect(screen.getByRole('status', { name: 'Health status' })).toHaveTextContent('Healthy');
    expect(
      screen.getByText('api-gateway is serving traffic normally. Nothing needs your attention.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Open / })).not.toBeInTheDocument();
    expect(screen.getByText('Serving')).toBeInTheDocument();
  });

  it('says what is wrong with an unhealthy app and points at the one useful place', async () => {
    await mount(<AppHealthPanel slug="api" />);
    const status = screen.getByRole('status', { name: 'Health status' });
    expect(status).toHaveTextContent('Unhealthy');
    expect(
      screen.getByText('api is failing: none of its running copies pass their readiness check.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open logs' })).toHaveAttribute(
      'href',
      '/dashboard/apps/api?tab=Logs'
    );
  });

  it('names failing requests from the counts the API returned', async () => {
    const base = assessment();
    hooks.useAppHealth.mockReturnValue(
      read(
        healthy({
          status: 'degraded',
          checks: [
            ...healthy().checks.slice(0, 2),
            {
              code: 'requests',
              status: 'warning',
              reason: 'request_error_rate_elevated',
              detail: '31 of 212 requests returned a server error.',
              action: 'errors',
            },
          ],
          requests: {
            ...base.requests!,
            request_count: 212,
            server_errors: 31,
            error_rate_pct: 14.62,
          },
        })
      )
    );
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByRole('status', { name: 'Health status' })).toHaveTextContent('Degraded');
    expect(
      screen.getByText(
        'api needs attention: 31 of 212 requests failed with a server error in the last 5 minutes.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open errors' })).toHaveAttribute(
      'href',
      '/dashboard/apps/api?tab=Errors'
    );
  });

  it('shows each check as a tile with a plain value and where to look next', async () => {
    await mount(<AppHealthPanel slug="api" />);
    const tiles = checkTiles();
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      'Live release check',
      'Replicas check',
      'Errors · last 5 min check',
    ]);
    const [release, replicas, errors] = tiles;
    expect(release).toHaveTextContent('A release is serving');
    expect(release).toHaveTextContent('The latest release failed');
    const link = within(release).getByRole('link', { name: 'Inspect release' });
    expect(link.getAttribute('href')).toContain('tab=Deployments');
    expect(link.getAttribute('href')).toContain('deployment=dep-failed');
    expect(replicas).toHaveTextContent('Fail:0 of 2 ready');
    expect(replicas).toHaveTextContent('2 not ready');
    expect(within(replicas).getByRole('link', { name: 'Inspect logs' })).toBeInTheDocument();
    expect(errors).toHaveTextContent('3 errors');
    expect(errors).toHaveTextContent('3 of 1,240 requests failed (0.24%)');
    expect(within(errors).getByRole('link', { name: 'Inspect metrics' })).toBeInTheDocument();
  });

  it('reads a clean error count as "None"', async () => {
    hooks.useAppHealth.mockReturnValue(read(healthy()));
    await mount(<AppHealthPanel slug="api" />);
    const errors = checkTiles()[2];
    expect(errors).toHaveTextContent('None');
    expect(errors).toHaveTextContent('0 of 1,240 requests failed');
    expect(checkTiles()[1]).toHaveTextContent('2 of 2 ready');
  });

  it("keeps the API's own wording and the thresholds in each tile's tip", async () => {
    await mount(<AppHealthPanel slug="api" />);
    fireEvent.click(screen.getByRole('button', { name: 'About Errors · last 5 min' }));
    expect(screen.getByText(/No server errors in the available sample/)).toBeInTheDocument();
    expect(
      screen.getByText(/a warning at 5% server errors and a failure at 25%/)
    ).toBeInTheDocument();
  });

  it('puts what each copy reported behind a disclosure', async () => {
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.queryByText('The primary app probe reports not ready.')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show what each copy reported (1+)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const findings = screen.getByRole('list', { name: 'Replica findings' });
    expect(
      within(findings).getByText('The primary app probe reports not ready.')
    ).toBeInTheDocument();
    expect(within(findings).getByText('Fail')).toBeInTheDocument();
    expect(within(findings).getByText(/Primary app/)).toBeInTheDocument();
    expect(screen.getByText(/More findings were left out/)).toBeInTheDocument();
  });

  it('says unconfirmed rather than zero when counts were not measured', async () => {
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
    const [, replicas, errors] = checkTiles();
    expect(replicas).toHaveTextContent('Unconfirmed');
    expect(replicas).not.toHaveTextContent(/of \d+ ready/);
    expect(errors).toHaveTextContent('Unconfirmed');
    expect(errors).toHaveTextContent("Missing counts don't mean zero errors");
  });

  it('points a plan without request counts at the plans page', async () => {
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
    expect(
      screen.getByText(
        "api's health can't be confirmed: request counts aren't included in your plan. That doesn't mean it's down."
      )
    ).toBeInTheDocument();
    const plans = screen.getAllByRole('link', { name: 'View plans' });
    expect(plans.length).toBeGreaterThan(0);
    for (const link of plans) expect(link).toHaveAttribute('href', '/dashboard/plans');
    expect(checkTiles()[0]).toHaveTextContent('Not on your plan');
  });

  it('tells an expected idle apart from trouble', async () => {
    hooks.useAppHealth.mockReturnValue(
      read(
        assessment({
          status: 'healthy',
          phase: 'idle',
          summary: 'Idle at zero replicas.',
          capacity: { known: true, required: 0, ready: 0, starting: 0, unready: 0, unknown: 0 },
          checks: [{ code: 'readiness', status: 'pass', detail: 'No warm replicas are required.' }],
        })
      )
    );
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByRole('status', { name: 'Health status' })).toHaveTextContent('Healthy');
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(
      screen.getByText(
        'api is asleep, which is expected: no copies need to stay warm. Nothing needs your attention.'
      )
    ).toBeInTheDocument();
    expect(checkTiles()[0]).toHaveTextContent('None running');
    expect(checkTiles()[0]).toHaveTextContent('None need to stay warm');
  });

  it('hides an assessment once it outlives its validity, without a refetch', async () => {
    hooks.useAppHealth.mockReturnValue(read(healthy()));
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByRole('status', { name: 'Health status' })).toHaveTextContent('Healthy');
    act(() => {
      vi.advanceTimersByTime(115_000);
    });
    expect(screen.getByRole('status', { name: 'Health status' })).toHaveTextContent('Unconfirmed');
    expect(screen.getByText(/last check expired/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Health checks' })).not.toBeInTheDocument();
  });

  it('lets a failed read take precedence over a cached healthy answer', async () => {
    const refetch = vi.fn();
    hooks.useAppHealth.mockReturnValue(
      read(healthy(), {
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

  it('draws the last 24 hours as bands with a one-line summary', async () => {
    await mount(<AppHealthPanel slug="api" />);
    // Not checked until the first assessment 2h ago, healthy, a collection
    // gap at 1h, then unhealthy for the last 10 minutes.
    expect(
      screen.getByText('Healthy for 1 of 24 hours · down once, not checked for 23 hours')
    ).toBeInTheDocument();
    const strip = screen.getByRole('img', {
      name: 'Health over the last 24 hours: healthy 1 hour, down 10 minutes, not checked 23 hours',
    });
    const bands = Array.from(strip.children);
    expect(bands).toHaveLength(4);
    expect(bands[3].getAttribute('title')).toMatch(/– now · Down \(unhealthy\)$/);
    expect(bands[1].getAttribute('title')).toMatch(/· Healthy$/);
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(legend).toHaveTextContent('Down(unhealthy)');
    expect(legend).not.toHaveTextContent('Slow or erroring');
  });

  it('says so in place of the strip while history loads, fails or is empty', async () => {
    hooks.useAppHealthHistory.mockReturnValue(infinite(undefined));
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText('Reading the last 24 hours…')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    cleanup();

    hooks.useAppHealthHistory.mockReturnValue(infinite([historyPage({ entries: [] })]));
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText(/Nothing recorded yet/)).toBeInTheDocument();
    cleanup();

    hooks.useAppHealthHistory.mockReturnValue(
      infinite(undefined, {
        isPending: false,
        error: new ApiError({ status: 500, code: 'internal', title: 'History failed' }),
      })
    );
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByRole('alert')).toHaveTextContent('History failed');
  });

  it('keeps every recorded change behind "Show every change", newest first, and pages older ones', async () => {
    // A full day is already loaded, so nothing is fetched on its own.
    const page = historyPage({ next_cursor: 'cursor-1' });
    page.entries[2] = { ...page.entries[2], observed_at: at(30 * 3600) };
    const history = infinite([page], { hasNextPage: true });
    hooks.useAppHealthHistory.mockReturnValue(history);
    await mount(<AppHealthPanel slug="api" />);
    expect(history.fetchNextPage).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'Health history' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show every change (3+)' }));
    const list = screen.getByRole('list', { name: 'Health history' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Healthy → Unhealthy');
    expect(rows[1]).toHaveTextContent('Assessment expired');
    expect(rows[2]).toHaveTextContent('First assessment');
    fireEvent.click(screen.getByRole('button', { name: 'Show older changes' }));
    expect(history.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('reads older pages on its own until the strip covers a day', async () => {
    const history = infinite([historyPage({ next_cursor: 'cursor-1' })], { hasNextPage: true });
    hooks.useAppHealthHistory.mockReturnValue(history);
    await mount(<AppHealthPanel slug="api" />);
    expect(history.fetchNextPage).toHaveBeenCalled();
    // Until it arrives, the unread part of the day is "no record", not "not checked".
    expect(screen.getByText(/no record for 22 hours/)).toBeInTheDocument();
  });

  it('says when background collection has fallen behind', async () => {
    hooks.useAppHealthHistory.mockReturnValue(infinite([historyPage({ collector_fresh: false })]));
    await mount(<AppHealthPanel slug="api" />);
    expect(screen.getByText(/Background checks are running behind/)).toBeInTheDocument();
  });

  it('asks for a fresh first page when an older page was pruned', async () => {
    const history = infinite([historyPage()], {
      isFetchNextPageError: true,
      error: new ApiError({ status: 404, code: 'not_found', title: 'Not found' }),
    });
    hooks.useAppHealthHistory.mockReturnValue(history);
    await mount(<AppHealthPanel slug="api" />);
    fireEvent.click(screen.getByRole('button', { name: /Show every change/ }));
    expect(screen.getByText(/no longer retained/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload newest' }));
    expect(history.refetch).toHaveBeenCalled();
  });
});
