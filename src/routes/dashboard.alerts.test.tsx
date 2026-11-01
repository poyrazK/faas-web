import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  channelRules: undefined as unknown,
  drawerRule: undefined as string | undefined,
}));

const rules = [
  {
    id: 'r1',
    app_id: 'a1',
    name: 'Webhook rule',
    enabled: true,
    metric: 'error_rate_pct',
    comparison: 'gt',
    threshold: 5,
    window_spec: '15m',
    webhook_url: 'https://hooks.example.com/a',
    channel_ids: ['c1'],
    state: 'ok',
  },
  {
    id: 'r2',
    app_id: 'a1',
    name: 'Channel rule',
    enabled: true,
    metric: 'api_up',
    comparison: 'lt',
    threshold: 1,
    window_spec: '5m',
    webhook_url: '',
    channel_ids: ['c1', 'c2'],
    state: 'firing',
  },
];

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useAlerts: () => ({ data: rules, isPending: false, error: null, refetch: vi.fn() }),
  useDeleteAlert: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRotateAlertSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAlert: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
// A minimal table: each row's cells, so the column renderers run.
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: ({ label }: { label: string }) => <span>{label}</span>,
  ResourceTable: ({
    rows,
    columns,
  }: {
    rows: { id: string }[];
    columns: { key: string; render: (row: unknown) => ReactNode }[];
  }) => (
    <ul>
      {rows.map((row) => (
        <li key={row.id} data-testid={`row-${row.id}`}>
          {columns.map((c) => (
            <span key={c.key}>{c.render(row)}</span>
          ))}
        </li>
      ))}
    </ul>
  ),
}));
vi.mock('@/components/dashboard/alert-deliveries', () => ({ AlertDeliveries: () => null }));
vi.mock('@/components/dashboard/alert-presets', () => ({ AlertPresets: () => null }));
vi.mock('@/components/dashboard/alert-rule-form', () => ({
  AlertRuleForm: () => <form aria-label="Add a rule" />,
}));
vi.mock('@/components/dashboard/notification-channels', () => ({
  NotificationChannels: ({ rules }: { rules: unknown }) => {
    state.channelRules = rules;
    return <section aria-label="Notification channels" />;
  },
}));
vi.mock('@/components/dashboard/alert-detail-drawer', () => ({
  AlertDetailDrawer: ({ ruleId }: { ruleId?: string }) => {
    state.drawerRule = ruleId;
    return ruleId ? <div role="dialog">detail {ruleId}</div> : null;
  },
}));
vi.mock('@/components/dashboard/app-select', () => ({
  AppScope: ({ children }: { children: ReactNode }) => children,
  AppSelect: () => null,
  useSelectedApp: () => ({ slug: 'api', apps: [], select: vi.fn() }),
}));

const { AlertsBody } = await import('./dashboard.alerts');

describe('AlertsBody', () => {
  it('renders the rule form and the account channels, with this app’s rules for the delete warning', () => {
    render(<AlertsBody slug="api" />);
    expect(screen.getByRole('form', { name: 'Add a rule' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Notification channels' })).toBeInTheDocument();
    expect(state.channelRules).toEqual([
      { id: 'r1', name: 'Webhook rule', channel_ids: ['c1'] },
      { id: 'r2', name: 'Channel rule', channel_ids: ['c1', 'c2'] },
    ]);
  });

  it('says where each rule delivers: its webhook and its channel count', () => {
    render(<AlertsBody slug="api" />);
    const webhook = screen.getByTestId('row-r1');
    expect(within(webhook).getByText('hooks.example.com/a')).toBeInTheDocument();
    expect(within(webhook).getByText(/\+ 1 channel$/)).toBeInTheDocument();
    const channelOnly = screen.getByTestId('row-r2');
    expect(within(channelOnly).getByText('2 channels')).toBeInTheDocument();
    // A channel-only rule has no webhook secret to rotate.
    expect(
      within(channelOnly).queryByRole('button', { name: 'Rotate secret for Channel rule' })
    ).not.toBeInTheDocument();
  });

  it('opens a rule in the detail drawer', async () => {
    render(<AlertsBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Details for Channel rule' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('detail r2');
  });
});
