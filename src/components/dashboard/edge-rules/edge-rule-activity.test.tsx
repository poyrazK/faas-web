import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  stats: vi.fn(),
  events: vi.fn(),
  access: new Map<string, string>(),
}));
vi.mock('@/lib/api/edge-rules', async (original) => ({
  ...(await original<typeof import('@/lib/api/edge-rules')>()),
  useEdgeRuleStats: (slug: string, window: string) => state.stats(slug, window) as unknown,
  useEdgeRuleEvents: (slug: string, filter: unknown, enabled: boolean) =>
    state.events(slug, filter, enabled) as unknown,
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (key: string) => ({
    access: state.access.get(key) ?? 'on',
    refresh: vi.fn(),
  }),
  useCapabilityStage: () => 'Beta',
}));
vi.mock('@/components/dither-kit/sparkline', () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));

const { EdgeRuleActivity } = await import('./edge-rule-activity');

const rule = (over: Partial<EdgeRule>): EdgeRule => ({
  id: 'a'.repeat(32),
  account_id: 'acct',
  app_id: 'app-1',
  kind: 'throttle',
  match_host: '@app',
  match_path: '/login',
  match_methods: ['POST'],
  match_headers: {},
  priority: 10,
  enabled: true,
  action: { requests_per_second: 2, burst: 4 },
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
  ...over,
});
const throttle = rule({ name: 'Login limit' });
const waf = rule({ id: 'b'.repeat(32), kind: 'waf', action: { mode: 'block' }, mode: 'log' });

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const eventsReady = (events: unknown[], over: Record<string, unknown> = {}) => ({
  data: { pages: [{ since: new Date(Date.now() - 24 * 3_600_000).toISOString(), events }] },
  dataUpdatedAt: Date.now(),
  isPending: false,
  error: null,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
  ...over,
});

beforeEach(() => {
  state.access = new Map();
  state.stats.mockReset().mockReturnValue(
    ready({
      window: '24h',
      since: '2026-11-02T10:00:00Z',
      rules: [
        { rule_id: throttle.id, matched: 1234, logged: 0, series: [0, 3, 7] },
        { rule_id: waf.id, matched: 0, logged: 56, series: [1, 0, 2] },
        { rule_id: 'c'.repeat(32), matched: 9, logged: 0 },
      ],
    })
  );
  state.events.mockReset().mockReturnValue(
    eventsReady([
      {
        id: 'e1',
        rule_id: waf.id,
        rule_kind: 'waf',
        outcome: 'blocked',
        occurred_at: '2026-11-03T09:00:00Z',
        request_id: 'req-7f3a',
        method: 'POST',
        host: 'api.example.com',
        path: '/v1/search',
        client_ip: '203.0.113.7',
        country: 'DE',
        user_agent: 'curl/8.4',
        waf_rule_ids: [942100],
        waf_categories: ['sqli'],
        waf_score: 10,
      },
      {
        id: 'e2',
        rule_id: throttle.id,
        rule_name: 'Login limit',
        rule_kind: 'throttle',
        outcome: 'matched',
        occurred_at: '2026-11-03T08:59:00Z',
        method: 'POST',
        host: 'api.example.com',
        path: '/login',
      },
    ])
  );
});

const mount = () => render(<EdgeRuleActivity slug="api" rules={[throttle, waf]} />);

describe('per-rule stats', () => {
  it('counts every rule that matched in the window, enforced and logged apart', () => {
    mount();
    const stats = screen.getByRole('table', { name: 'Matches per rule' });
    const row = within(stats).getByText('Login limit').closest('tr')!;
    expect(row).toHaveTextContent('1,234');
    const logged = within(stats)
      .getByText(/^waf ·/)
      .closest('tr')!;
    expect(logged).toHaveTextContent('56');
    expect(within(stats).getAllByTestId('sparkline')).toHaveLength(2);
    expect(within(stats).getByText(/not on this app/)).toBeInTheDocument();
  });

  it('reads the window from the switcher', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(state.stats).toHaveBeenLastCalledWith('api', '7d');
    expect(state.events).toHaveBeenLastCalledWith(
      'api',
      expect.objectContaining({ since: '7d' }),
      true
    );
  });

  it('says nothing matched rather than showing an empty table', () => {
    state.stats.mockReturnValue(ready({ window: '24h', since: '2026-11-02T10:00:00Z', rules: [] }));
    mount();
    expect(screen.getByText('No rule matched a request in the last 24 hours.')).toBeInTheDocument();
  });

  it('shows a failed read with its code', () => {
    state.stats.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 503, code: 'capacity_unavailable', title: 'Unavailable' }),
      refetch: vi.fn(),
    });
    mount();
    expect(screen.getByText('capacity_unavailable')).toBeInTheDocument();
  });
});

describe('sampled events', () => {
  it('lists sampled matches with what the WAF saw, never the payload', () => {
    mount();
    const list = screen.getByRole('list', { name: 'Sampled events' });
    expect(within(list).getByText('Blocked')).toBeInTheDocument();
    expect(within(list).getByText('POST api.example.com/v1/search')).toBeInTheDocument();
    expect(within(list).getByText(/sqli · score 10 · CRS 942100/)).toBeInTheDocument();
    expect(within(list).getByText(/203\.0\.113\.7 · DE/)).toBeInTheDocument();
  });

  it('filters by rule from the stats row, and by outcome', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Events for Login limit' }));
    expect(state.events).toHaveBeenLastCalledWith(
      'api',
      expect.objectContaining({ rule: throttle.id }),
      true
    );
    await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'blocked');
    expect(state.events).toHaveBeenLastCalledWith(
      'api',
      expect.objectContaining({ outcome: 'blocked' }),
      true
    );
  });

  it('finds the rule behind a refused request by its request ID', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Request ID'), 'req-7f3a{enter}');
    expect(state.events).toHaveBeenLastCalledWith(
      'api',
      expect.objectContaining({ request_id: 'req-7f3a' }),
      true
    );
  });

  it('loads older events a page at a time', async () => {
    const fetchNextPage = vi.fn();
    state.events.mockReturnValue(eventsReady([], { hasNextPage: true, fetchNextPage }));
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Load older events' }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('says when the plan keeps fewer days than the window asks for', async () => {
    state.events.mockReturnValue({
      ...eventsReady([]),
      data: {
        pages: [{ since: new Date(Date.now() - 72 * 3_600_000).toISOString(), events: [] }],
      },
    });
    mount();
    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(screen.getByText(/your plan keeps events for 3 days/i)).toBeInTheDocument();
  });

  it('reads no events while the history capability is off', () => {
    state.access.set('edge-rule-history', 'off');
    mount();
    expect(state.events).toHaveBeenLastCalledWith('api', expect.anything(), false);
    expect(
      screen.getByText(/sampled events are not enabled for this account/i)
    ).toBeInTheDocument();
  });
});

describe('trace', () => {
  it('builds the gregale edge rule trace command from the request typed', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Request URL'), 'https://api.example.com/login');
    await userEvent.selectOptions(screen.getByLabelText('Request method'), 'POST');
    expect(
      screen.getByText(
        'gregale edge rule trace --app api --url https://api.example.com/login --method POST'
      )
    ).toBeInTheDocument();
  });
});
