import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  channels: [] as unknown[],
  org: null as string | null,
  access: 'on' as string,
  maturity: 'beta' as string,
  enabledArg: undefined as boolean | undefined,
  create: vi.fn(),
  remove: vi.fn(),
  test: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api/notification-channels', () => ({
  useNotificationChannels: (enabled: boolean) => {
    state.enabledArg = enabled;
    return { data: state.channels, isPending: false, error: null, refetch: vi.fn() };
  },
  useCreateNotificationChannel: () => ({ mutateAsync: state.create, isPending: false }),
  useDeleteNotificationChannel: () => ({ mutateAsync: state.remove, isPending: false }),
  useTestNotificationChannel: () => ({ mutateAsync: state.test, isPending: false }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: state.access, refresh: vi.fn() }),
  useCapability: () => ({ capability: { maturity: state.maturity } }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => ({ org: state.org, label: 'Acme', ready: true }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { email: 'me@example.com' } }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));

const { NotificationChannels } = await import('./notification-channels');

const slack = {
  id: 'c-slack',
  name: 'ops-slack',
  kind: 'slack',
  target: 'hooks.slack.com/T0/B0/…',
  last_delivered_at: '2026-10-31T10:00:00Z',
  created_at: '2026-10-30T10:00:00Z',
};
const pager = {
  id: 'c-pd',
  name: 'oncall',
  kind: 'pagerduty',
  target: '…abcd',
  pagerduty_region: 'eu',
  last_error: 'HTTP 400 from PagerDuty',
  last_error_at: '2026-10-31T11:00:00Z',
  created_at: '2026-10-30T10:00:00Z',
};

beforeEach(() => {
  state.channels = [slack, pager];
  state.org = null;
  state.access = 'on';
  state.maturity = 'beta';
  state.enabledArg = undefined;
  for (const fn of [state.create, state.remove, state.test, state.confirm, state.toast])
    fn.mockReset();
});

describe('NotificationChannels', () => {
  it('lists channels with their hint and their latest delivery or error, labelled from the registry', () => {
    render(<NotificationChannels />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    const slackRow = screen.getByRole('listitem', { name: 'ops-slack' });
    expect(within(slackRow).getByText('hooks.slack.com/T0/B0/…')).toBeInTheDocument();
    expect(within(slackRow).getByText(/Delivered/)).toBeInTheDocument();
    const pdRow = screen.getByRole('listitem', { name: 'oncall' });
    expect(within(pdRow).getByText(/PagerDuty · EU/)).toBeInTheDocument();
    expect(within(pdRow).getByText('HTTP 400 from PagerDuty')).toBeInTheDocument();
  });

  it('follows the registry when the capability graduates', () => {
    state.maturity = 'ga';
    render(<NotificationChannels />);
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('says why instead of listing when the plan has no channels', () => {
    state.access = 'plan-not-entitled';
    render(<NotificationChannels />);
    expect(screen.getByText('Not included in your plan')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it("never reads the personal account's channels in a company workspace", () => {
    state.org = 'acme';
    render(<NotificationChannels />);
    // The list never mounts, so the personal channels are never requested.
    expect(state.enabledArg).toBeUndefined();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.getByText(/belong to your own account/i)).toBeInTheDocument();
  });

  it('adds a Slack channel with a write-only URL', async () => {
    state.create.mockResolvedValue({ ...slack, id: 'c-new', name: 'alerts' });
    render(<NotificationChannels />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'alerts');
    const url = screen.getByLabelText('Slack webhook URL');
    expect(url).toHaveAttribute('type', 'password');
    await userEvent.type(url, 'https://example.com/hook');
    await userEvent.click(screen.getByRole('button', { name: 'Add channel' }));
    expect(url).toHaveAccessibleDescription(/hooks\.slack\.com/);
    expect(state.create).not.toHaveBeenCalled();

    await userEvent.clear(url);
    await userEvent.type(url, 'https://hooks.slack.com/services/T0/B0/abc');
    await userEvent.click(screen.getByRole('button', { name: 'Add channel' }));
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith({
        name: 'alerts',
        kind: 'slack',
        slack_webhook_url: 'https://hooks.slack.com/services/T0/B0/abc',
      })
    );
    await waitFor(() => expect(url).toHaveValue(''));
  });

  it('adds a PagerDuty channel with its region, and an email channel to the own address', async () => {
    state.create.mockResolvedValue(pager);
    render(<NotificationChannels />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'pd');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'pagerduty');
    const key = screen.getByLabelText('Routing key');
    expect(key).toHaveAttribute('type', 'password');
    await userEvent.type(key, 'a'.repeat(32));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Region' }), 'eu');
    await userEvent.click(screen.getByRole('button', { name: 'Add channel' }));
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith({
        name: 'pd',
        kind: 'pagerduty',
        pagerduty_routing_key: 'a'.repeat(32),
        pagerduty_region: 'eu',
      })
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'me');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'email');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('me@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add channel' }));
    await waitFor(() =>
      expect(state.create).toHaveBeenLastCalledWith({
        name: 'me',
        kind: 'email',
        email: 'me@example.com',
      })
    );
  });

  it('explains the per-account cap from its code', async () => {
    state.create.mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'notification_channel_limit_reached',
        title: 'Notification channel limit reached',
        detail: 'an account can have at most 20 notification channels',
      } as never)
    );
    render(<NotificationChannels />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'more');
    await userEvent.type(
      screen.getByLabelText('Slack webhook URL'),
      'https://hooks.slack.com/services/T0/B0/abc'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add channel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/20 channels/);
  });

  it('reports a test send whether or not it was delivered', async () => {
    state.test.mockResolvedValueOnce({ delivered: true });
    state.test.mockResolvedValueOnce({ delivered: false, error: 'HTTP 404 from Slack' });
    render(<NotificationChannels />);
    await userEvent.click(screen.getByRole('button', { name: 'Send a test to ops-slack' }));
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
    );
    expect(state.test).toHaveBeenCalledWith('c-slack');
    await userEvent.click(screen.getByRole('button', { name: 'Send a test to ops-slack' }));
    await waitFor(() =>
      expect(state.toast).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'error', description: 'HTTP 404 from Slack' })
      )
    );
  });

  it('names the rate limit on test sends', async () => {
    state.test.mockRejectedValue(
      new ApiError({
        status: 429,
        code: 'notification_channel_test_rate_limited',
        title: 'Notification channel test rate limited',
      } as never)
    );
    render(<NotificationChannels />);
    await userEvent.click(screen.getByRole('button', { name: 'Send a test to ops-slack' }));
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', description: expect.stringMatching(/10 test/) })
      )
    );
  });

  it("warns which of this app's rules use a channel before deleting it", async () => {
    state.confirm.mockResolvedValue(true);
    state.remove.mockResolvedValue(undefined);
    render(
      <NotificationChannels
        rules={[
          { id: 'r1', name: 'Checkout errors', channel_ids: ['c-slack'] },
          { id: 'r2', name: 'Latency', channel_ids: ['c-pd'] },
        ]}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete ops-slack' }));
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringContaining('Checkout errors'),
      })
    );
    expect(state.confirm.mock.calls[0][0].description).not.toContain('Latency');
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith('c-slack'));
  });

  it('shows the rules the API names when a channel is their only destination', async () => {
    state.confirm.mockResolvedValue(true);
    state.remove.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'notification_channel_in_use',
        title: 'Notification channel in use',
        detail:
          'This channel is the only destination of 1 alert rule(s): Checkout errors (r1). Give them a webhook or another channel, or delete them, before deleting the channel.',
      } as never)
    );
    render(<NotificationChannels />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete ops-slack' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Checkout errors (r1)');
    expect(alert).toHaveTextContent('notification_channel_in_use');
  });

  it('does nothing when the delete is cancelled', async () => {
    state.confirm.mockResolvedValue(false);
    render(<NotificationChannels />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete oncall' }));
    expect(state.remove).not.toHaveBeenCalled();
  });
});
