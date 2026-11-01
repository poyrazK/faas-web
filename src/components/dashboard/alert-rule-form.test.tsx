import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  create: vi.fn(),
  toast: vi.fn(),
  org: null as string | null,
  hidden: [] as string[],
  channelsEnabled: undefined as boolean | undefined,
  channels: [] as unknown[],
  slos: [] as unknown[],
  checks: [] as unknown[],
}));

vi.mock('@/lib/api/queries', () => ({
  useCreateAlert: () => ({ mutateAsync: state.create, isPending: false }),
}));
vi.mock('@/lib/api/notification-channels', () => ({
  useNotificationChannels: (enabled: boolean) => {
    state.channelsEnabled = enabled;
    return { data: enabled ? state.channels : undefined, isPending: !enabled, error: null };
  },
  useAppSLOs: (_slug: string, enabled: boolean) => ({
    data: enabled ? state.slos : undefined,
    isPending: !enabled,
    error: null,
  }),
  useAppSyntheticChecks: (_slug: string, enabled: boolean) => ({
    data: enabled ? state.checks : undefined,
    isPending: !enabled,
    error: null,
  }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityRegistry: () => ({
    phase: 'ready',
    query: { data: { plan: 'pro', capabilities: [], hidden_capabilities: state.hidden } },
  }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => ({ org: state.org, label: 'Acme', ready: true }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));

const { AlertRuleForm } = await import('./alert-rule-form');

const metric = () => screen.getByRole('combobox', { name: 'Metric' });
const fillName = (value = 'Rule') =>
  userEvent.type(screen.getByRole('textbox', { name: 'Name' }), value);
const fillWebhook = async () => {
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Webhook URL' }),
    'https://hooks.example.com'
  );
  await userEvent.type(screen.getByLabelText('Webhook secret'), 'x');
};
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Add rule' }));

beforeEach(() => {
  state.create.mockReset().mockResolvedValue({ name: 'Rule' });
  state.toast.mockReset();
  state.org = null;
  state.hidden = [];
  state.channelsEnabled = undefined;
  state.channels = [
    { id: 'c-slack', name: 'ops-slack', kind: 'slack', target: 'hooks…', created_at: '' },
    { id: 'c-pd', name: 'oncall', kind: 'pagerduty', target: '…abcd', created_at: '' },
  ];
  state.slos = [{ id: 'slo-1', name: 'checkout-availability' }];
  state.checks = [{ id: 'chk-1', name: 'health', path: '/healthz' }];
});

describe('AlertRuleForm validation', () => {
  it('reports the first malformed or out-of-range field and preserves values for retry', async () => {
    state.create
      .mockReset()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ name: 'Error rate' });
    render(<AlertRuleForm slug="api" />);
    const name = screen.getByRole('textbox', { name: 'Name' });
    const url = screen.getByRole('textbox', { name: 'Webhook URL' });
    const secret = screen.getByLabelText('Webhook secret');
    const cooldown = screen.getByRole('spinbutton', { name: 'Cooldown' });

    await submit();
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription('Enter a name for this rule.');

    await userEvent.type(name, 'Error rate');
    await userEvent.type(url, 'http://hooks.example.com');
    await userEvent.type(secret, 'x');
    await userEvent.clear(cooldown);
    await userEvent.type(cooldown, '1{Enter}');
    expect(url).toHaveFocus();
    expect(url).toHaveAccessibleDescription('Enter a complete HTTPS webhook URL.');

    await userEvent.clear(url);
    await userEvent.type(url, 'https://hooks.example.com');
    await userEvent.type(cooldown, '{Enter}');
    expect(cooldown).toHaveFocus();
    expect(cooldown).toHaveAccessibleDescription('Enter whole minutes from 5 to 1440.');
    expect(state.create).not.toHaveBeenCalled();

    await userEvent.clear(cooldown);
    await userEvent.type(cooldown, '5{Enter}');
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(name).toHaveValue('Error rate');
    await userEvent.type(cooldown, '{Enter}');
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(2));
  });

  it('includes the failure source, inbound webhooks among them', async () => {
    render(<AlertRuleForm slug="api" />);
    await fillName('Failures');
    await userEvent.selectOptions(metric(), 'failed_invocations');
    await fillWebhook();
    const source = screen.getByRole('combobox', { name: 'Failure source' });
    expect(source).toHaveValue('any');
    await userEvent.selectOptions(source, 'inbound_webhook');
    await submit();
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({ failure_source: 'inbound_webhook' })
      )
    );
  });
});

describe('AlertRuleForm metrics', () => {
  it('offers the wider metric list, minus what apid hides for the account', () => {
    state.hidden = ['log-search'];
    render(<AlertRuleForm slug="api" />);
    const values = within(metric())
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(expect.arrayContaining(['api_up', 'queue_backlog', 'slo_budget_burn']));
    expect(values).not.toContain('log_search_matches');
  });

  it("watches one of the app's SLOs by slo_id", async () => {
    render(<AlertRuleForm slug="api" />);
    await fillName();
    await userEvent.selectOptions(metric(), 'slo_budget_burn');
    await fillWebhook();
    await submit();
    expect(screen.getByRole('combobox', { name: 'SLO' })).toHaveAccessibleDescription(
      /Choose the SLO/
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'SLO' }), 'slo-1');
    await submit();
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({ metric: 'slo_budget_burn', slo_id: 'slo-1' })
      )
    );
  });

  it('watches a synthetic check by synthetic_check_id', async () => {
    render(<AlertRuleForm slug="api" />);
    await fillName();
    await userEvent.selectOptions(metric(), 'synthetic_check_consecutive_failures');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Synthetic check' }),
      'chk-1'
    );
    await fillWebhook();
    await submit();
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({ synthetic_check_id: 'chk-1' })
      )
    );
  });

  it('says when the app has no SLO to watch', async () => {
    state.slos = [];
    render(<AlertRuleForm slug="api" />);
    await userEvent.selectOptions(metric(), 'slo_budget_remaining_pct');
    expect(screen.getByText(/no SLOs yet/i)).toBeInTheDocument();
  });

  it('counts log search matches for a filter, over a day at most', async () => {
    render(<AlertRuleForm slug="api" />);
    await fillName();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Window' }), '7d');
    await userEvent.selectOptions(metric(), 'log_search_matches');
    // The window moves into the metric's range rather than staying invalid.
    const windows = within(screen.getByRole('combobox', { name: 'Window' }))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(windows).not.toContain('7d');
    await userEvent.type(screen.getByRole('textbox', { name: 'Log query' }), 'host=x');
    await fillWebhook();
    await submit();
    expect(screen.getByRole('textbox', { name: 'Log query' })).toHaveAccessibleDescription(/host/);
    await userEvent.clear(screen.getByRole('textbox', { name: 'Log query' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Log query' }), 'level=error');
    await submit();
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({ log_query: 'level=error', window_spec: '24h' })
      )
    );
  });

  it('offers baselines only when anomaly alerts are released', async () => {
    state.hidden = ['anomaly-alerts'];
    const { unmount } = render(<AlertRuleForm slug="api" />);
    expect(
      within(screen.getByRole('combobox', { name: 'Is' })).queryByRole('option', {
        name: '× usual',
      })
    ).not.toBeInTheDocument();
    unmount();

    state.hidden = [];
    render(<AlertRuleForm slug="api" />);
    await fillName();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Is' }), 'above_baseline');
    const threshold = screen.getByRole('spinbutton', { name: 'Multiplier' });
    await userEvent.clear(threshold);
    await userEvent.type(threshold, '1');
    await fillWebhook();
    await submit();
    expect(threshold).toHaveAccessibleDescription(/1\.5 to 20/);
    await userEvent.clear(threshold);
    await userEvent.type(threshold, '3');
    await submit();
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({ comparison: 'above_baseline', threshold: 3 })
      )
    );
  });
});

describe('AlertRuleForm destinations', () => {
  it('delivers to channels alone, without a webhook', async () => {
    render(<AlertRuleForm slug="api" />);
    await fillName();
    await userEvent.click(screen.getByRole('checkbox', { name: /ops-slack/ }));
    await submit();
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    const body = state.create.mock.calls[0][0];
    expect(body).toMatchObject({ channel_ids: ['c-slack'] });
    expect(body).not.toHaveProperty('webhook_url');
  });

  it('asks for a webhook or a channel when neither is set', async () => {
    render(<AlertRuleForm slug="api" />);
    await fillName();
    await submit();
    expect(screen.getByRole('textbox', { name: 'Webhook URL' })).toHaveAccessibleDescription(
      /webhook or choose a channel/
    );
    expect(state.create).not.toHaveBeenCalled();
  });

  it("offers no channel picker in a company workspace (they are the person's own)", () => {
    state.org = 'acme';
    render(<AlertRuleForm slug="api" />);
    expect(state.channelsEnabled).toBe(false);
    expect(screen.queryByRole('checkbox', { name: /ops-slack/ })).not.toBeInTheDocument();
  });

  it('offers no channel picker when channels are hidden for the account', () => {
    state.hidden = ['notification-channels'];
    render(<AlertRuleForm slug="api" />);
    expect(state.channelsEnabled).toBe(false);
  });
});
