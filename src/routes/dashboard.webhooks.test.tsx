import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createWebhook = vi.fn();
const toast = vi.fn();

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useWebhooks: () => ({ data: [], isPending: false, error: null, refetch: vi.fn() }),
  useCreateWebhook: () => ({ mutateAsync: createWebhook, isPending: false }),
  useDeleteWebhook: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRotateWebhookSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWebhook: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useWebhookDeliveries: () => ({ data: { deliveries: [] }, isPending: false, error: null }),
  useRetryDelivery: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: () => null,
  ResourceTable: () => null,
}));
vi.mock('@/components/ui/modal', () => ({ Modal: () => null }));
vi.mock('@/components/dashboard/app-select', () => ({
  AppScope: ({ children }: { children: React.ReactNode }) => children,
  AppSelect: () => null,
  useSelectedApp: () => ({ slug: 'api', apps: [], select: vi.fn() }),
}));

const { WebhooksBody } = await import('./dashboard.webhooks');

beforeEach(() => {
  createWebhook
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ id: 'webhook-1' });
  toast.mockReset();
});

describe('webhook form validation', () => {
  it('handles empty and malformed submit, API failure, retry, and success', async () => {
    render(<WebhooksBody slug="api" />);
    const target = screen.getByRole('textbox', { name: 'Target URL' });
    const secret = screen.getByLabelText('Secret');

    await userEvent.click(screen.getByRole('button', { name: 'Add webhook' }));
    expect(target).toHaveFocus();
    expect(target).toHaveAccessibleDescription('Enter a complete HTTPS target URL.');

    await userEvent.type(target, 'http://hooks.example.com');
    await userEvent.type(secret, 'x{Enter}');
    expect(target).toHaveAccessibleDescription('Enter a complete HTTPS target URL.');
    expect(createWebhook).not.toHaveBeenCalled();

    await userEvent.clear(target);
    await userEvent.type(target, 'https://hooks.example.com{Enter}');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(target).toHaveValue('https://hooks.example.com');

    await userEvent.type(target, '{Enter}');
    await waitFor(() => expect(createWebhook).toHaveBeenCalledTimes(2));
  });

  it('offers the complete API event vocabulary and sends the selected filter', async () => {
    createWebhook.mockReset().mockResolvedValue({ id: 'webhook-1' });
    render(<WebhooksBody slug="api" />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Target URL' }),
      'https://hooks.example.com'
    );
    await userEvent.type(screen.getByLabelText('Secret'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'budget.threshold' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add webhook' }));

    await waitFor(() =>
      expect(createWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ event_filter: ['budget.threshold'] })
      )
    );
  });

  it('enforces the API target URL length before sending', async () => {
    createWebhook.mockReset().mockResolvedValue({ id: 'webhook-1' });
    render(<WebhooksBody slug="api" />);
    const target = screen.getByRole('textbox', { name: 'Target URL' });
    fireEvent.change(target, { target: { value: `https://example.com/${'a'.repeat(2030)}` } });
    await userEvent.type(screen.getByLabelText('Secret'), 'x{Enter}');

    expect(target).toHaveAccessibleDescription('Target URLs can be at most 2048 characters.');
    expect(createWebhook).not.toHaveBeenCalled();
  });
});
