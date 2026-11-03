import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

type Row = { id: string; name: string; destination: string; condition: string };
type TableProps = { rows: Row[]; rowActions: (row: Row) => React.ReactNode };

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useAlerts: () => ({
    data: [
      {
        id: 'r1',
        name: 'Checkout errors',
        metric: 'error_rate_pct',
        comparison: 'gt',
        threshold: 5,
        window_spec: '15m',
        channel_ids: ['c1'],
        webhook_url: 'https://hooks.example.com/a',
        enabled: true,
        state: 'firing',
      },
    ],
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDeleteAlert: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAlert: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/api/notification-channels', () => ({
  useNotificationChannels: () => ({ data: [{ id: 'c1', name: 'ops-slack' }] }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ capability: { maturity: 'beta' } }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/resource-table', () => ({
  ResourceTable: ({ rows, rowActions }: TableProps) => (
    <ul>
      {rows.map((r) => (
        <li key={r.id}>
          <span>{r.condition}</span>
          <span>{r.destination}</span>
          {rowActions(r)}
        </li>
      ))}
    </ul>
  ),
}));
vi.mock('@/components/dashboard/alert-rule-form', () => ({
  AlertRuleForm: ({ onCreated }: { onCreated: (rule: { id: string }) => void }) => (
    <button onClick={() => onCreated({ id: 'new-rule' })}>Create rule</button>
  ),
}));
vi.mock('@/components/dashboard/alert-presets', () => ({ AlertPresets: () => null }));
vi.mock('@/components/dashboard/notification-channels', () => ({
  NotificationChannels: () => <p>channels panel</p>,
}));
vi.mock('@/components/dashboard/alert-detail', () => ({
  AlertState: ({ state }: { state: string }) => <span>{state}</span>,
  AlertDetail: ({ ruleId }: { ruleId: string }) => <p>detail of {ruleId}</p>,
}));
vi.mock('@/components/dashboard/app-select', () => ({
  AppScope: ({ children }: { children: React.ReactNode }) => children,
  AppSelect: () => null,
  useSelectedApp: () => ({ slug: 'api', apps: [], select: vi.fn() }),
}));

const { AlertsBody, validateAlertsSearch } = await import('@/components/dashboard/pages/alerts');

describe('alerts page', () => {
  it('keeps the channels view in the URL and drops anything else', () => {
    expect(validateAlertsSearch({ view: 'channels' })).toEqual({ view: 'channels' });
    expect(validateAlertsSearch({ view: 'other' })).toEqual({});
  });

  it('lists where each rule delivers, by channel name, and opens its detail', async () => {
    render(<AlertsBody slug="api" />);
    expect(screen.getByText('Error rate > 5%')).toBeInTheDocument();
    expect(screen.getByText('ops-slack, hooks.example.com/a')).toBeInTheDocument();
    expect(screen.queryByText(/detail of/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Details for Checkout errors' }));
    expect(screen.getByText('detail of r1')).toBeInTheDocument();
  });
});

it('opens the shared alert form in a sheet and selects the created rule', async () => {
  render(<AlertsBody slug="api" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  const sheet = await screen.findByRole('dialog', { name: 'Add rule' });
  await userEvent.click(within(sheet).getByRole('button', { name: 'Create rule' }));
  expect(screen.getByText('detail of new-rule')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
