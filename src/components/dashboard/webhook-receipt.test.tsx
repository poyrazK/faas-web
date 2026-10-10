import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const receipt = {
  data: undefined as undefined | null | Record<string, unknown>,
  error: null as Error | null,
  isPending: false,
  refetch: vi.fn(),
};
const useReceipt = vi.fn((..._args: unknown[]) => receipt);
vi.mock('@/lib/api/inbound-webhooks', () => ({
  useWebhookReceipt: (...args: unknown[]) => useReceipt(...args),
}));
vi.mock('@/components/dashboard/primitives', () => ({
  Panel: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
const { WebhookReceipt } = await import('./webhook-receipt');

beforeEach(() => {
  useReceipt.mockClear();
  receipt.data = undefined;
  receipt.error = null;
  receipt.isPending = false;
  receipt.refetch.mockClear();
});

it('refreshes the same known event so pending routing or transient errors can advance', async () => {
  render(<WebhookReceipt accountId="a" slug="app" endpointId="e" />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Stripe event ID' }), 'evt_pending');
  await userEvent.click(screen.getByRole('button', { name: 'Look up receipt' }));
  expect(receipt.refetch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Look up receipt' }));
  expect(receipt.refetch).toHaveBeenCalledTimes(1);
});

it('requires a known event ID and fences lookup across app changes', async () => {
  const view = render(<WebhookReceipt accountId="account-1" slug="app-a" endpointId="e1" />);
  expect(useReceipt).toHaveBeenCalledWith('account-1', 'app-a', 'e1', '');
  await userEvent.type(screen.getByRole('textbox', { name: 'Stripe event ID' }), 'evt_123');
  expect(useReceipt).toHaveBeenLastCalledWith('account-1', 'app-a', 'e1', '');
  await userEvent.click(screen.getByRole('button', { name: 'Look up receipt' }));
  expect(useReceipt).toHaveBeenLastCalledWith('account-1', 'app-a', 'e1', 'evt_123');
  view.rerender(<WebhookReceipt accountId="account-2" slug="app-b" endpointId="e2" />);
  expect(useReceipt).toHaveBeenLastCalledWith('account-2', 'app-b', 'e2', '');
  expect(screen.queryByText('evt_123')).not.toBeInTheDocument();
});

it('shows a non-retained event without implying an inbox', async () => {
  receipt.data = null;
  render(<WebhookReceipt accountId="a" slug="app" endpointId="e" />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Stripe event ID' }), 'evt_missing');
  await userEvent.click(screen.getByRole('button', { name: 'Look up receipt' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/no retained receipt/i);
  expect(screen.queryByText(/receipt inbox/i)).not.toBeInTheDocument();
});

it('distinguishes duplicate acceptance, pending routing and unverified run execution', async () => {
  receipt.data = {
    receipt_id: 'r1',
    endpoint_id: 'e1',
    provider_event_id: 'evt_1',
    workflow_name: 'paid',
    status: 'accepted',
    duplicate: true,
    accepted_at: '2026-10-10T00:00:00Z',
    event_source: 'gregale.inbound.stripe.e1',
    routing_status: 'pending',
  };
  render(<WebhookReceipt accountId="a" slug="app" endpointId="e1" />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Stripe event ID' }), 'evt_1');
  await userEvent.click(screen.getByRole('button', { name: 'Look up receipt' }));
  expect(screen.getByText(/duplicate/i)).toBeInTheDocument();
  expect(screen.getByText(/routing pending/i)).toBeInTheDocument();
  expect(screen.getByText(/do not prove.*run succeeded/i)).toBeInTheDocument();
});

it.each(['enqueued', 'failed', 'filtered', 'ignored'] as const)(
  'shows %s routing without claiming successful execution',
  async (status) => {
    receipt.data = {
      receipt_id: 'r1',
      endpoint_id: 'e1',
      provider_event_id: 'evt_1',
      workflow_name: 'paid',
      status: status === 'ignored' ? 'ignored' : 'accepted',
      duplicate: false,
      accepted_at: '2026-10-10T00:00:00Z',
      event_source: 'gregale.inbound.stripe.e1',
      routing_status: status,
    };
    render(<WebhookReceipt accountId="a" slug="app" endpointId="e1" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Stripe event ID' }), 'evt_1');
    await userEvent.click(screen.getByRole('button', { name: 'Look up receipt' }));
    expect(screen.getByText(new RegExp(`routing ${status}`, 'i'))).toBeInTheDocument();
    expect(screen.queryByText(/run succeeded/i)).toBeInTheDocument();
  }
);

it('links a known run to the existing app automation view', async () => {
  receipt.data = {
    receipt_id: 'r1',
    endpoint_id: 'e1',
    provider_event_id: 'evt_1',
    workflow_name: 'paid',
    status: 'accepted',
    duplicate: false,
    accepted_at: '2026-10-10T00:00:00Z',
    event_source: 'gregale.inbound.stripe.e1',
    routing_status: 'enqueued',
    run_id: 'run-1',
  };
  render(<WebhookReceipt accountId="a" slug="app" endpointId="e1" />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Stripe event ID' }), 'evt_1');
  await userEvent.click(screen.getByRole('button', { name: 'Look up receipt' }));
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Inspect automation run' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/app?tab=Automations&automation=paid&automationView=runs&automationRun=run-1'
    )
  );
});
