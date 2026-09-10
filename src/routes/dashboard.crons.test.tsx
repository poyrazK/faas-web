import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createCron = vi.fn();
const toast = vi.fn();

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useCrons: () => ({ data: [], isPending: false, error: null, refetch: vi.fn() }),
  useApps: () => ({ data: [{ id: '0123456789abcdef0123456789abcdef', slug: 'api' }] }),
  useCreateCron: () => ({ mutateAsync: createCron, isPending: false }),
  useRunCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCronRuns: () => ({ data: { runs: [] }, isPending: false, error: null }),
  useFireNowRequest: () => ({ data: undefined }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: () => null,
  ResourceTable: () => null,
}));
vi.mock('@/components/ui/modal', () => ({ Modal: () => null }));

const { Route } = await import('./dashboard.crons');
const CronsPage = (Route as unknown as { component: React.ComponentType }).component;

beforeEach(() => {
  createCron
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ schedule: '*/15 * * * *', path: '/' });
  toast.mockReset();
});

describe('cron form validation', () => {
  it.each(['99 * * * *', 'a b c d e'])(
    'rejects the range-invalid or malformed schedule %s',
    async (invalidSchedule) => {
      render(<CronsPage />);
      const schedule = screen.getByRole('textbox', { name: 'Schedule' });

      await userEvent.type(schedule, `${invalidSchedule}{Enter}`);

      expect(schedule).toHaveFocus();
      expect(schedule).toHaveAccessibleDescription('Enter a five-field cron schedule.');
      expect(createCron).not.toHaveBeenCalled();
    }
  );

  it('reports malformed keyboard submissions, then supports failure, retry, and success', async () => {
    render(<CronsPage />);
    const schedule = screen.getByRole('textbox', { name: 'Schedule' });

    await userEvent.type(schedule, 'not a cron{Enter}');
    expect(schedule).toHaveFocus();
    expect(schedule).toHaveAccessibleDescription('Enter a five-field cron schedule.');
    expect(createCron).not.toHaveBeenCalled();

    await userEvent.clear(schedule);
    await userEvent.type(schedule, '*/15 * * * *{Enter}');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(schedule).toHaveValue('*/15 * * * *');

    await userEvent.type(schedule, '{Enter}');
    await waitFor(() => expect(createCron).toHaveBeenCalledTimes(2));
    expect(schedule).toHaveValue('');
  });
});
