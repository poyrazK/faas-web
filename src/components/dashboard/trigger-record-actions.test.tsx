import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const retry = vi.fn();
const drop = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useRetryTriggerRecord: () => ({ mutateAsync: retry, isPending: false }),
  useDropTriggerRecord: () => ({ mutateAsync: drop, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { TriggerRecordActions } = await import('./trigger-record-actions');

beforeEach(() => {
  retry.mockReset().mockResolvedValue({});
  drop.mockReset().mockResolvedValue({});
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

const props = { triggerId: 't1', recordId: 'r1' };

describe('TriggerRecordActions', () => {
  it('retries the record it was given', async () => {
    render(<TriggerRecordActions {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith({ triggerId: 't1', recordId: 'r1' }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('explains a 409 as the record not being retryable', async () => {
    retry.mockRejectedValue(
      new ApiError({ status: 409, code: 'trigger_dlq_retry_failed', title: 'Not retryable' })
    );
    render(<TriggerRecordActions {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'info',
        description: expect.stringMatching(/retry or dead/i),
      })
    );
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
  });

  it('reports a real retry failure as an error', async () => {
    retry.mockRejectedValue(new ApiError({ status: 500, code: 'internal', title: 'Boom' }));
    render(<TriggerRecordActions {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
  });

  it('confirms before dropping, since a drop cannot be undone', async () => {
    render(<TriggerRecordActions {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /drop/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(drop).toHaveBeenCalledWith({ triggerId: 't1', recordId: 'r1' });
  });

  it('does not drop when the confirm is dismissed', async () => {
    confirm.mockResolvedValue(false);
    render(<TriggerRecordActions {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /drop/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(drop).not.toHaveBeenCalled();
  });

  it('offers no retry for a record that is not retryable', () => {
    render(<TriggerRecordActions {...props} retryable={false} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /drop/i })).toBeInTheDocument();
  });
});
