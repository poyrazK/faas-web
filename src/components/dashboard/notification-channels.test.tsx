import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';

vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({
    accountId: 'acct',
    capability: { maturity: 'beta' },
    state: 'available',
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', email: 'me@example.com' } }),
}));

const { NotificationChannels, ChannelPicker, channelHealth } =
  await import('./notification-channels');

const SLACK = {
  id: '6a1f5b2e-0c1d-4e2f-8a9b-0c1d2e3f4a5b',
  name: 'ops-slack',
  kind: 'slack',
  target: 'hooks.slack.com · T04ABCD/B07WXYZ',
  last_delivered_at: '2026-11-03T08:00:00Z',
  created_at: '2026-10-01T00:00:00Z',
};
const PAGER = {
  id: '7b2f6c3e-1d2e-4f3a-9b0c-1d2e3f4a5b6c',
  name: 'oncall',
  kind: 'pagerduty',
  target: 'routing key …9f2c',
  pagerduty_region: 'eu',
  last_delivered_at: '2026-10-30T08:00:00Z',
  last_error: 'PagerDuty returned 400: invalid routing key',
  last_error_at: '2026-11-03T09:00:00Z',
  created_at: '2026-10-01T00:00:00Z',
};

let channels: unknown[];
function api(extra: Handlers = {}) {
  return routeApi({ 'GET /v1/notification-channels': () => channels, ...extra });
}

beforeEach(() => {
  channels = [SLACK, PAGER];
});
afterEach(() => vi.restoreAllMocks());

describe('channelHealth', () => {
  it('reads an error newer than the last delivery as failing, and an older one as recovered', () => {
    expect(channelHealth(PAGER)).toBe('failing');
    expect(channelHealth({ ...PAGER, last_delivered_at: '2026-11-03T10:00:00Z' })).toBe(
      'delivering'
    );
    expect(channelHealth({})).toBe('unused');
  });
});

describe('NotificationChannels', () => {
  it('lists each channel with its hint, region and last outcome, labelled beta', async () => {
    api();
    renderWithProviders(<NotificationChannels />);
    const list = await screen.findByRole('list', { name: 'Notification channels' });
    expect(within(list).getByText('ops-slack')).toBeInTheDocument();
    expect(within(list).getByText(/T04ABCD\/B07WXYZ/)).toBeInTheDocument();
    expect(within(list).getByText(/PagerDuty · eu/)).toBeInTheDocument();
    expect(within(list).getByText(/invalid routing key/)).toBeInTheDocument();
    expect(within(list).getByText(/Failing/)).toBeInTheDocument();
    expect(within(list).getByText(/Delivered/)).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('explains the plan gate instead of an empty list', async () => {
    api({
      'GET /v1/notification-channels': () =>
        problem(402, 'plan_alert_rules_not_allowed', 'the free plan does not include alert rules'),
    });
    renderWithProviders(<NotificationChannels />);
    expect(
      await screen.findByText(/come with alert rules, on Hobby and above/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add channel/i })).not.toBeInTheDocument();
  });

  it('adds a Slack channel with only its own fields and never keeps the URL', async () => {
    const url = 'https://hooks.slack.com/services/T000/B000/secretpart';
    const spies = api({
      'POST /v1/notification-channels': () => ({ ...SLACK, id: 'new', name: 'alerts' }),
    });
    const { client } = renderWithProviders(<NotificationChannels />);
    await screen.findByText('ops-slack');
    await userEvent.click(screen.getByRole('button', { name: /add channel/i }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'alerts');
    await userEvent.type(screen.getByLabelText('Slack webhook URL'), url);
    await userEvent.click(screen.getAllByRole('button', { name: /add channel/i }).at(-1)!);

    await waitFor(() =>
      expect(spies.POST).toHaveBeenCalledWith('/v1/notification-channels', {
        body: { name: 'alerts', kind: 'slack', slack_webhook_url: url },
      })
    );
    await waitFor(() => expect(screen.queryByLabelText('Slack webhook URL')).toBeNull());
    expect(document.body.innerHTML).not.toContain('secretpart');
    const cached = JSON.stringify([
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.variables),
    ]);
    expect(cached).not.toContain('secretpart');
  });

  it('checks a PagerDuty key and sends its region', async () => {
    const spies = api({ 'POST /v1/notification-channels': () => PAGER });
    renderWithProviders(<NotificationChannels />);
    await screen.findByText('ops-slack');
    await userEvent.click(screen.getByRole('button', { name: /add channel/i }));
    await userEvent.click(screen.getByRole('button', { name: 'PagerDuty' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'pager');
    await userEvent.type(screen.getByLabelText('Integration key'), 'short');
    const submit = screen.getAllByRole('button', { name: /add channel/i }).at(-1)!;
    await userEvent.click(submit);
    expect(screen.getByText(/32-character Events API v2 integration key/)).toBeInTheDocument();
    expect(spies.POST).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('Integration key'));
    await userEvent.type(screen.getByLabelText('Integration key'), 'a'.repeat(32));
    await userEvent.click(screen.getByRole('button', { name: 'EU' }));
    await userEvent.click(submit);
    await waitFor(() =>
      expect(spies.POST).toHaveBeenCalledWith('/v1/notification-channels', {
        body: {
          name: 'pager',
          kind: 'pagerduty',
          pagerduty_routing_key: 'a'.repeat(32),
          pagerduty_region: 'eu',
        },
      })
    );
  });

  it('offers only the account’s own email', async () => {
    const spies = api({ 'POST /v1/notification-channels': () => SLACK });
    renderWithProviders(<NotificationChannels />);
    await screen.findByText('ops-slack');
    await userEvent.click(screen.getByRole('button', { name: /add channel/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Email' }));
    expect(screen.getByDisplayValue('me@example.com')).toHaveAttribute('readonly');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'me');
    await userEvent.click(screen.getAllByRole('button', { name: /add channel/i }).at(-1)!);
    await waitFor(() =>
      expect(spies.POST).toHaveBeenCalledWith('/v1/notification-channels', {
        body: { name: 'me', kind: 'email', email: 'me@example.com' },
      })
    );
  });

  it('shows a refused test and a rate-limited one by their code', async () => {
    let calls = 0;
    api({
      'POST /v1/notification-channels/{id}/test': () =>
        ++calls === 1
          ? { delivered: false, error: 'PagerDuty returned 400' }
          : problem(429, 'notification_channel_test_rate_limited', '10 tests in the last minute'),
    });
    renderWithProviders(<NotificationChannels />);
    await screen.findByText('oncall');
    const [, pagerTest] = screen.getAllByRole('button', { name: /send test/i });
    await userEvent.click(pagerTest);
    expect(await screen.findByText(/refused the test/)).toBeInTheDocument();
    await userEvent.click(pagerTest);
    expect(await screen.findAllByText(/ten test messages in the last minute/)).not.toHaveLength(0);
  });

  it('names the rules that keep a channel in use', async () => {
    api({
      'DELETE /v1/notification-channels/{id}': () =>
        problem(
          409,
          'notification_channel_in_use',
          'This channel is the only destination of 1 alert rule(s): checkout errors (abc).'
        ),
    });
    renderWithProviders(<NotificationChannels />);
    await screen.findByText('ops-slack');
    await userEvent.click(screen.getByRole('button', { name: 'Delete channel ops-slack' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete channel' }));
    expect(await screen.findByText(/checkout errors \(abc\)/)).toBeInTheDocument();
    expect(screen.getAllByText('notification_channel_in_use')).not.toHaveLength(0);
  });
});

describe('ChannelPicker', () => {
  it('caps a rule at five channels', async () => {
    channels = Array.from({ length: 6 }, (_, i) => ({ ...SLACK, id: `c${i}`, name: `ch-${i}` }));
    api();
    const onChange = vi.fn();
    renderWithProviders(
      <ChannelPicker value={['c0', 'c1', 'c2', 'c3', 'c4']} onChange={onChange} />
    );
    expect(await screen.findByRole('checkbox', { name: /ch-5/ })).toBeDisabled();
    expect(screen.getByText(/at most 5 channels/)).toBeInTheDocument();
  });

  it('points to the channels tab when there are none', async () => {
    channels = [];
    api();
    renderWithProviders(<ChannelPicker value={[]} onChange={vi.fn()} />);
    expect(
      await screen.findByRole('link', { name: /add slack, pagerduty or email/i })
    ).toHaveAttribute('href', '/dashboard/alerts?view=channels');
  });
});
