import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rule: undefined as Record<string, unknown> | undefined,
  ruleError: null as unknown,
  org: null as string | null,
  access: 'on',
  channelsEnabled: undefined as boolean | undefined,
  update: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api/notification-channels', () => ({
  useAlertRule: () => ({
    data: state.rule,
    isPending: !state.rule && !state.ruleError,
    error: state.ruleError,
    refetch: vi.fn(),
  }),
  useNotificationChannels: (enabled: boolean) => {
    state.channelsEnabled = enabled;
    return {
      data: enabled
        ? [
            { id: 'c-slack', name: 'ops-slack', kind: 'slack', target: 'h', created_at: '' },
            { id: 'c-pd', name: 'oncall', kind: 'pagerduty', target: 'k', created_at: '' },
          ]
        : undefined,
      isPending: !enabled,
      error: null,
    };
  },
}));
vi.mock('@/lib/api/queries', () => ({
  useUpdateAlert: () => ({ mutateAsync: state.update, isPending: false }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: state.access, refresh: vi.fn() }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => ({ org: state.org, label: 'Acme', ready: true }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('./alert-deliveries', () => ({
  AlertDeliveries: ({ ruleId }: { ruleId: string }) => <div>deliveries for {ruleId}</div>,
}));

const { AlertDetailDrawer } = await import('./alert-detail-drawer');

const base = {
  id: 'r1',
  app_id: 'a1',
  name: 'Checkout errors',
  enabled: true,
  metric: 'slo_budget_burn',
  comparison: 'gt',
  threshold: 2,
  window_spec: '1h',
  slo_id: 'slo-1',
  webhook_url: '',
  webhook_secret_sealed_masked: '***',
  channel_ids: ['c-slack'],
  cooldown_minutes: 30,
  action: 'webhook',
  state: 'firing',
  last_fired_at: '2026-10-31T10:00:00Z',
  last_evaluated_at: '2026-10-31T10:05:00Z',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
};

beforeEach(() => {
  state.rule = { ...base };
  state.ruleError = null;
  state.org = null;
  state.access = 'on';
  state.channelsEnabled = undefined;
  state.update.mockReset().mockResolvedValue({});
  state.toast.mockReset();
});

describe('AlertDetailDrawer', () => {
  it('stays shut without a rule', () => {
    render(<AlertDetailDrawer slug="shop" ruleId={undefined} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows state, when it last fired and was evaluated, the condition and what it watches', () => {
    render(<AlertDetailDrawer slug="shop" ruleId="r1" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Checkout errors')).toBeInTheDocument();
    expect(within(dialog).getByText('firing')).toBeInTheDocument();
    expect(within(dialog).getByText(/slo_budget_burn > 2/)).toBeInTheDocument();
    expect(within(dialog).getByText('slo-1')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Last fired').nextElementSibling?.querySelector('time')
    ).toBeTruthy();
    expect(within(dialog).getByText('deliveries for r1')).toBeInTheDocument();
  });

  it('explains degraded and unknown rather than leaving a bare word', () => {
    state.rule = { ...base, state: 'unknown', last_fired_at: undefined };
    render(<AlertDetailDrawer slug="shop" ruleId="r1" onClose={vi.fn()} />);
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('names where the rule delivers', () => {
    state.rule = { ...base, webhook_url: 'https://hooks.example.com/a' };
    render(<AlertDetailDrawer slug="shop" ruleId="r1" onClose={vi.fn()} />);
    expect(screen.getByText('hooks.example.com/a')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /ops-slack/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /oncall/ })).not.toBeChecked();
  });

  it('changes the rule channels', async () => {
    render(<AlertDetailDrawer slug="shop" ruleId="r1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /oncall/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save channels' }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({ id: 'r1', channel_ids: ['c-slack', 'c-pd'] })
    );
  });

  it('keeps a channel-only rule from losing its last destination', async () => {
    render(<AlertDetailDrawer slug="shop" ruleId="r1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /ops-slack/ }));
    expect(screen.getByRole('button', { name: 'Save channels' })).toBeDisabled();
    expect(screen.getByText(/needs a webhook or at least one channel/i)).toBeInTheDocument();
  });

  it('lets a webhook rule clear its channels', async () => {
    state.rule = { ...base, webhook_url: 'https://hooks.example.com/a' };
    render(<AlertDetailDrawer slug="shop" ruleId="r1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /ops-slack/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save channels' }));
    await waitFor(() => expect(state.update).toHaveBeenCalledWith({ id: 'r1', channel_ids: [] }));
  });

  it("in a company workspace, counts the rule's channels without reading anyone's list", () => {
    state.org = 'acme';
    render(<AlertDetailDrawer slug="shop" ruleId="r1" onClose={vi.fn()} />);
    expect(state.channelsEnabled).toBe(false);
    expect(screen.getByText(/1 notification channel/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save channels' })).not.toBeInTheDocument();
  });

  it('shows the read error', () => {
    state.rule = undefined;
    state.ruleError = new Error('boom');
    render(<AlertDetailDrawer slug="shop" ruleId="r1" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent(/boom|could not/i);
  });
});
