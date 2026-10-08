import { render, screen, waitFor, within } from '@testing-library/react';
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

const { ScheduledRequestsBody } = await import('@/components/dashboard/jobs-scheduled');
const CronsPage = () => <ScheduledRequestsBody search={{}} onSelection={() => {}} />;

async function openCreation() {
  render(<CronsPage />);
  await userEvent.click(screen.getByRole('button', { name: 'New scheduled request' }));
  return within(screen.getByRole('dialog', { name: 'New scheduled request' }));
}

beforeEach(() => {
  createCron
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ schedule: '*/15 * * * *', path: '/' });
  toast.mockReset();
});

describe('scheduled request creation', () => {
  it('opens creation on demand and discards a cancelled draft', async () => {
    render(<CronsPage />);
    const opener = screen.getByRole('button', { name: 'New scheduled request' });
    expect(screen.queryByRole('textbox', { name: 'Schedule' })).not.toBeInTheDocument();

    await userEvent.click(opener);
    const dialog = within(screen.getByRole('dialog', { name: 'New scheduled request' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Schedule' }), '*/15 * * * *');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Path' }), 'refresh');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(createCron).not.toHaveBeenCalled();
    await userEvent.click(opener);
    expect(screen.getByRole('textbox', { name: 'Schedule' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Path' })).toHaveValue('/');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    '99 * * * *',
    'a b c d e',
    '* * * * 7',
    '0 0 * FOO MON',
    '0 0 * DEC-JAN MON',
    '0 0 * JAN MON/0',
  ])('rejects the range-invalid or malformed schedule %s', async (invalidSchedule) => {
    await openCreation();
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
      await openCreation();
      const schedule = screen.getByRole('textbox', { name: 'Schedule' });

      await userEvent.type(schedule, `${validSchedule}{Enter}`);

      await waitFor(() =>
        expect(createCron).toHaveBeenCalledWith(
          expect.objectContaining({ schedule: validSchedule })
        )
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
  );

  it('reports malformed keyboard submissions, then supports failure, retry, and success', async () => {
    await openCreation();
    const schedule = screen.getByRole('textbox', { name: 'Schedule' });

    await userEvent.type(schedule, 'not a cron{Enter}');
    expect(schedule).toHaveFocus();
    expect(schedule).toHaveAccessibleDescription('Enter a five-field cron schedule.');
    expect(createCron).not.toHaveBeenCalled();

    await userEvent.clear(schedule);
    await userEvent.type(schedule, '*/15 * * * *{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(schedule).toHaveValue('*/15 * * * *');

    await userEvent.type(schedule, '{Enter}');
    await waitFor(() => expect(createCron).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'New scheduled request' })).toHaveFocus();
  });
});
