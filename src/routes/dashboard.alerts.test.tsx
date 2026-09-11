import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAlert = vi.fn();
const toast = vi.fn();

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useAlerts: () => ({ data: [], isPending: false, error: null, refetch: vi.fn() }),
  useCreateAlert: () => ({ mutateAsync: createAlert, isPending: false }),
  useDeleteAlert: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRotateAlertSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAlert: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: () => null,
  ResourceTable: () => null,
}));
vi.mock('@/components/dashboard/alert-deliveries', () => ({ AlertDeliveries: () => null }));
vi.mock('@/components/dashboard/alert-presets', () => ({ AlertPresets: () => null }));
vi.mock('@/components/dashboard/app-select', () => ({
  AppScope: ({ children }: { children: React.ReactNode }) => children,
  AppSelect: () => null,
  useSelectedApp: () => ({ slug: 'api', apps: [], select: vi.fn() }),
}));

const { AlertsBody } = await import('./dashboard.alerts');

beforeEach(() => {
  createAlert
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ name: 'Error rate' });
  toast.mockReset();
});

describe('alert form validation', () => {
  it('reports the first malformed or out-of-range field and preserves values for retry', async () => {
    render(<AlertsBody slug="api" />);
    const name = screen.getByRole('textbox', { name: 'Name' });
    const url = screen.getByRole('textbox', { name: 'Webhook URL' });
    const secret = screen.getByLabelText('Webhook secret');
    const cooldown = screen.getByRole('spinbutton', { name: 'Cooldown' });

    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription('Enter a name for this rule.');

    await userEvent.type(name, 'Error rate');
    await userEvent.type(url, 'http://hooks.example.com');
    await userEvent.type(secret, 'x');
    await userEvent.clear(cooldown);
    await userEvent.type(cooldown, '1{Enter}');
    expect(url).toHaveFocus();
    expect(url).toHaveAccessibleDescription('Enter a complete HTTPS webhook URL.');

    await userEvent.clear(url);
    await userEvent.type(url, 'https://hooks.example.com');
    await userEvent.type(cooldown, '{Enter}');
    expect(cooldown).toHaveFocus();
    expect(cooldown).toHaveAccessibleDescription('Enter whole minutes from 5 to 1440.');
    expect(createAlert).not.toHaveBeenCalled();

    await userEvent.clear(cooldown);
    await userEvent.type(cooldown, '5{Enter}');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(name).toHaveValue('Error rate');
    await userEvent.type(cooldown, '{Enter}');
    await waitFor(() => expect(createAlert).toHaveBeenCalledTimes(2));
  });

  it('includes the required failure source for failed-invocation alerts', async () => {
    createAlert.mockReset().mockResolvedValue({ name: 'Failures' });
    render(<AlertsBody slug="api" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Failures');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Metric' }),
      'failed_invocations'
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Webhook URL' }),
      'https://hooks.example.com'
    );
    await userEvent.type(screen.getByLabelText('Webhook secret'), 'x');
    expect(screen.getByRole('combobox', { name: 'Failure source' })).toHaveValue('any');
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    await waitFor(() =>
      expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ failure_source: 'any' }))
    );
  });
});
