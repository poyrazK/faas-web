import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setCap = vi.fn();
const toast = vi.fn();

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useUsageSummary: () => ({
    data: { month: '2026-08', used_gb_hours: 1, included_gb_hours: 50, overage_gb_hours: 0 },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useApps: () => ({ data: [] }),
  usePerAppUsage: () => ({ data: [], isPending: false, error: null }),
  useSetOverageCap: () => ({ mutateAsync: setCap, isPending: false }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { plan: 'hobby', app_count: 1 } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/dashboard/object-storage-usage', () => ({
  ObjectStorageUsagePanel: () => null,
}));

const { Route } = await import('./dashboard.usage');
const UsagePage = (Route as unknown as { component: React.ComponentType }).component;

beforeEach(() => {
  setCap
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ overage_cap_cents: 1250 });
  toast.mockReset();
});

describe('spend-cap validation', () => {
  it('treats zero as a zero-overage ceiling and clears only with null', async () => {
    setCap.mockReset().mockResolvedValue({ overage_cap_cents: 0 });
    render(<UsagePage />);
    const cap = screen.getByRole('spinbutton', { name: 'Cap (EUR)' });

    await userEvent.type(cap, '0{Enter}');
    await waitFor(() => expect(setCap).toHaveBeenCalledWith(0));
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Spend cap set to €0.00' })
    );

    setCap.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Clear cap' }));
    await waitFor(() => expect(setCap).toHaveBeenCalledWith(null));
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Spend cap cleared' }));
  });

  it('rejects malformed amounts, then preserves the value through API failure and retry', async () => {
    render(<UsagePage />);
    const cap = screen.getByRole('spinbutton', { name: 'Cap (EUR)' });

    await userEvent.type(cap, '-1');
    await userEvent.click(screen.getByRole('button', { name: 'Set cap' }));
    expect(cap).toHaveAccessibleDescription(
      'Enter zero or a positive amount with no more than two decimal places.'
    );
    expect(setCap).not.toHaveBeenCalled();

    await userEvent.clear(cap);
    await userEvent.type(cap, '12.50{Enter}');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(cap).toHaveValue(12.5);

    await userEvent.type(cap, '{Enter}');
    await waitFor(() => expect(setCap).toHaveBeenCalledTimes(2));
    expect(setCap).toHaveBeenLastCalledWith(1250);
  });
});
