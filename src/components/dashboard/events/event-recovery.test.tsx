import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { RecoveryAction } from '@/lib/api/event-recoveries';

const submit = vi.fn();
const access = vi.hoisted(() => ({ values: {} as Record<string, string> }));
const confirm = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/event-recoveries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/event-recoveries')>()),
  useSubmitRecovery: () => ({ mutateAsync: submit, isPending: false, variables: undefined }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({ access: access.values[id] ?? 'on', refresh: vi.fn() }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { RecoveryActions } = await import('./event-recovery');

const routing: RecoveryAction = {
  kind: 'routing_replay',
  method: 'POST',
  url: '/v1/apps/billing-recon/event-deliveries:replay-fanout-failure',
  body: { event_source: 'billing', event_id: 'inv_1', subscription_id: 'sub-1' },
};
const handler: RecoveryAction = {
  kind: 'handler_replay',
  method: 'POST',
  url: '/v1/invocations/abc/replay',
};

beforeEach(() => {
  submit.mockReset().mockResolvedValue({});
  confirm.mockReset().mockResolvedValue(true);
  toast.mockReset();
  access.values = {};
});

describe('RecoveryActions', () => {
  it('confirms what runs again before submitting the typed operation', async () => {
    render(<RecoveryActions accountId="acct" actions={[handler]} />);
    await userEvent.click(screen.getByRole('button', { name: /replay handler/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/side effects repeat/i) })
    );
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ target: { op: 'handler_replay', id: 'abc' } })
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    confirm.mockResolvedValue(false);
    render(<RecoveryActions accountId="acct" actions={[routing]} />);
    await userEvent.click(screen.getByRole('button', { name: /replay routing/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/one failed recipient/i) })
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    ['event_recovery_changed', /changed since this receipt was read/i],
    ['invocation_not_replayable', /no longer failed/i],
    ['keyed_replay_expired', /deadline has passed/i],
  ])('explains a recovery refused with %s', async (code, description) => {
    submit.mockRejectedValue(new ApiError({ status: 409, code, title: 'Refused' }));
    render(<RecoveryActions accountId="acct" actions={[routing]} />);
    await userEvent.click(screen.getByRole('button', { name: /replay routing/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', description: expect.stringMatching(description) })
      )
    );
  });

  it.each([
    ['event-replays', routing, /replay routing \(not enabled\)/i],
    [
      'dead-letter-queues',
      { kind: 'dead_letter_replay', method: 'POST', url: '/v1/apps/api/dlq/d1/replay' },
      /replay dead letter \(not enabled\)/i,
    ],
  ] as const)('lists but does not offer an action while %s is off', (capability, action, label) => {
    access.values[capability] = 'off';
    render(<RecoveryActions accountId="acct" actions={[action as RecoveryAction, handler]} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('shows an action whose URL it cannot match without offering to submit it', () => {
    render(
      <RecoveryActions
        accountId="acct"
        actions={[{ kind: 'handler_replay', method: 'POST', url: 'https://elsewhere/replay' }]}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/replay handler \(API only\)/i)).toBeInTheDocument();
  });
});
