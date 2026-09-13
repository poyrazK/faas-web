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

const { ScheduledRequestsBody } = await import('@/components/dashboard/jobs-scheduled');
const CronsPage = () => <ScheduledRequestsBody search={{}} onSelection={() => {}} />;

beforeEach(() => {
  createCron
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ schedule: '*/15 * * * *', path: '/' });
  toast.mockReset();
});

describe('cron form validation', () => {
  it.each([
    '99 * * * *',
    'a b c d e',
    '* * * * 7',
    '0 0 * FOO MON',
    '0 0 * DEC-JAN MON',
    '0 0 * JAN MON/0',
  ])('rejects the range-invalid or malformed schedule %s', async (invalidSchedule) => {
    render(<CronsPage />);
    const schedule = screen.getByRole('textbox', { name: 'Schedule' });

    await userEvent.type(schedule, `${invalidSchedule}{Enter}`);

    expect(schedule).toHaveFocus();
    expect(schedule).toHaveAccessibleDescription('Enter a five-field cron schedule.');
    expect(createCron).not.toHaveBeenCalled();
  });

  it.each(['0 0 * JAN MON', '0 9 ? JAN,MAR MON-FRI/2', '*/15 9-17/2 1,15 JAN-DEC SUN,SAT'])(
    'submits the backend-supported symbolic schedule %s',
    async (validSchedule) => {
      createCron.mockReset().mockResolvedValue({ schedule: validSchedule, path: '/' });
      render(<CronsPage />);
      const schedule = screen.getByRole('textbox', { name: 'Schedule' });

      await userEvent.type(schedule, `${validSchedule}{Enter}`);

      await waitFor(() =>
        expect(createCron).toHaveBeenCalledWith(
          expect.objectContaining({ schedule: validSchedule })
        )
      );
      expect(schedule).not.toHaveAccessibleDescription('Enter a five-field cron schedule.');
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
