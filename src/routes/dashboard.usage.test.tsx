import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setCap = vi.fn();
const toast = vi.fn();
const usage = vi.hoisted(() => ({
  rows: [] as { app_id: string; mb_seconds: number; requests: number; cold_boots: number }[],
}));

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useUsageSummary: () => ({
    data: { month: '2026-08', used_gb_hours: 1, included_gb_hours: 50, overage_gb_hours: 0 },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useApps: () => ({ data: [] }),
  usePerAppUsage: () => ({ data: usage.rows, isPending: false, error: null }),
  useSetOverageCap: () => ({ mutateAsync: setCap, isPending: false }),
  useOverageCap: () => ({ data: { overage_cap_cents: null }, isPending: false, error: null }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { plan: 'hobby', app_count: 1 } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/dashboard/object-storage-usage', () => ({
  ObjectStorageUsagePanel: () => null,
}));

const { Route } = await import('./dashboard.usage');
const UsagePage = (Route as unknown as { component: React.ComponentType }).component;

beforeEach(() => {
  usage.rows = [];
  setCap
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ overage_cap_cents: 1250 });
  toast.mockReset();
});

describe('compact per-app usage', () => {
  it('shows the five largest consumers and expands without changing their share of total usage', async () => {
    usage.rows = Array.from({ length: 7 }, (_, i) => ({
      app_id: `app-${i + 1}`,
      mb_seconds: (i + 1) * 1024 * 3600,
      requests: 1,
      cold_boots: 0,
    }));
    render(<UsagePage />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).queryByText('app-1')).not.toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('app-7');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('25%');
    const toggle = screen.getByRole('button', { name: 'Show all 7 apps' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(within(table).getAllByRole('row')).toHaveLength(8);
    expect(within(table).getByText('app-1')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('25%');
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(toggle).toHaveFocus();
  });
  it.each([0, 3, 5])('does not offer expansion for %s apps', (count) => {
    usage.rows = Array.from({ length: count }, (_, i) => ({
      app_id: `app-${i}`,
      mb_seconds: 0,
      requests: 0,
      cold_boots: 0,
    }));
    render(<UsagePage />);
    expect(screen.queryByRole('button', { name: /Show all|Show fewer/ })).not.toBeInTheDocument();
    if (count)
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(count + 1);
  });
});

describe('spend-cap validation', () => {
  it('converts decimal euro amounts to exact whole cents', async () => {
    setCap.mockReset().mockResolvedValue({ overage_cap_cents: 110 });
    render(<UsagePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Manage spend cap' }));
    const cap = screen.getByRole('spinbutton', { name: 'Cap (EUR)' });

    await userEvent.type(cap, '0.29{Enter}');
    await waitFor(() => expect(setCap).toHaveBeenLastCalledWith(29));

    await userEvent.clear(cap);
    await userEvent.type(cap, '1.10{Enter}');
    await waitFor(() => expect(setCap).toHaveBeenLastCalledWith(110));
  });

  it('treats zero as a zero-overage ceiling and clears only with null', async () => {
    setCap.mockReset().mockResolvedValue({ overage_cap_cents: 0 });
    render(<UsagePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Manage spend cap' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Manage spend cap' }));
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
