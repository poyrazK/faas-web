import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setGraceWindow = vi.fn();
const toast = vi.fn();

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useApiKeys: () => ({ data: [], isPending: false, error: null, refetch: vi.fn() }),
  useCreateApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRotateApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGraceWindow: () => ({ data: { days: 7, plan_default: 7 }, isPending: false, error: null }),
  useSetGraceWindow: () => ({ mutateAsync: setGraceWindow, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: () => null,
  ResourceTable: () => null,
}));

const { Route } = await import('./dashboard.keys');
const KeysPage = (Route as unknown as { component: React.ComponentType }).component;

beforeEach(() => {
  setGraceWindow
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ days: 3, plan_default: 7 });
  toast.mockReset();
});

describe('API-key grace-window validation', () => {
  it('restores the plan default with the API null sentinel', async () => {
    setGraceWindow.mockReset().mockResolvedValue({ days: null, plan_default: 7 });
    render(<KeysPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Use plan default' }));

    await waitFor(() => expect(setGraceWindow).toHaveBeenCalledWith(null));
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Plan default restored' })
    );
  });

  it('rejects range errors, then keeps the value available for API retry and success', async () => {
    render(<KeysPage />);
    const days = screen.getByRole('spinbutton', { name: 'Days' });
    await userEvent.clear(days);
    await userEvent.type(days, '-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(days).toHaveFocus();
    expect(days).toHaveAccessibleDescription('Enter a whole number of days, zero or greater.');
    expect(setGraceWindow).not.toHaveBeenCalled();

    await userEvent.clear(days);
    await userEvent.type(days, '3{Enter}');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(days).toHaveValue(3);

    await userEvent.type(days, '{Enter}');
    await waitFor(() => expect(setGraceWindow).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'success' }));
  });
});
