import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const restart = vi.fn();
const purge = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useRestartApp: () => ({ mutateAsync: restart, isPending: false }),
  usePurgeAppCache: () => ({ mutateAsync: purge, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { PurgeCacheControl, RestartAppButton } = await import('./app-lifecycle');

beforeEach(() => {
  restart.mockReset().mockResolvedValue({ wake_id: 'wk_abcdef123456' });
  purge.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('RestartAppButton', () => {
  it('confirms, then names the replacement wake so it can be found', async () => {
    render(<RestartAppButton slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /restart/i }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }))
    );
    await waitFor(() => expect(restart).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('wk_abcdef123') })
    );
  });

  it('reads a 409 as one already running and a 402 as the spend cap', async () => {
    restart.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'conflict', title: 'Conflict' })
    );
    render(<RestartAppButton slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /restart/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Already restarting' }))
    );

    restart.mockRejectedValueOnce(
      new ApiError({ status: 402, code: 'admission_refused', title: 'Refused' })
    );
    await userEvent.click(screen.getByRole('button', { name: /restart/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Spend cap reached' }))
    );
  });
});

describe('PurgeCacheControl', () => {
  it('purges everything when no glob is given, and says a purge was requested', async () => {
    render(<PurgeCacheControl slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /purge/i }));
    await waitFor(() => expect(purge).toHaveBeenCalledWith(undefined));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Purge requested' }));
  });

  it('passes the glob through when one is typed', async () => {
    render(<PurgeCacheControl slug="api" />);
    await userEvent.type(screen.getByLabelText('Path glob to purge'), '/products/*');
    await userEvent.click(screen.getByRole('button', { name: /purge/i }));
    await waitFor(() => expect(purge).toHaveBeenCalledWith('/products/*'));
  });
});
