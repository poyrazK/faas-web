import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const startRun = vi.fn();
const deleteJob = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useStartJobRun: () => ({ mutateAsync: startRun, isPending: false }),
  useDeleteJob: () => ({ mutateAsync: deleteJob, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { JobActions } = await import('./job-actions');

const queued = { id: 'run-new', tasks: 3, aggregate_status: 'queued' };

function setup(status = 'active') {
  const onStarted = vi.fn();
  const onDeleted = vi.fn();
  render(
    <JobActions name="nightly-export" status={status} onStarted={onStarted} onDeleted={onDeleted} />
  );
  return { onStarted, onDeleted, user: userEvent.setup() };
}

beforeEach(() => {
  startRun.mockReset().mockResolvedValue(queued);
  deleteJob.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('JobActions start run', () => {
  it('asks for a task count, confirms the billable start, then queues and opens the run', async () => {
    const { user, onStarted } = setup();
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    const dialog = await screen.findByRole('dialog', { name: /start a run/i });
    const tasks = within(dialog).getByLabelText('Number of tasks');
    await user.clear(tasks);
    await user.type(tasks, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        title: 'Start 3 tasks of nightly-export?',
        description: expect.stringMatching(/billable/i),
        confirmLabel: 'Start run',
      })
    );
    await waitFor(() =>
      expect(startRun).toHaveBeenCalledWith({
        name: 'nightly-export',
        tasks: 3,
        idempotencyKey: expect.any(String),
      })
    );
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('run-new'));
  });

  it('says the run was queued, never that it finished', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const message = toast.mock.calls[0]?.[0] as {
      kind: string;
      title: string;
      description: string;
    };
    expect(message.kind).toBe('success');
    expect(message.title).toBe('Run queued');
    expect(message.description).toMatch(/3 tasks .*queued/i);
    expect(`${message.title} ${message.description}`).not.toMatch(/finish|complete|started/i);
  });

  it('starts nothing when the confirm is declined', async () => {
    confirm.mockResolvedValue(false);
    const { user, onStarted } = setup();
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(startRun).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /start a run/i })).toBeInTheDocument();
  });

  it.each(['', '0', '2.5', '5001'])('rejects %j as a task count before any confirm', async (v) => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    const tasks = await screen.findByLabelText('Number of tasks');
    await user.clear(tasks);
    if (v) await user.type(tasks, v);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/whole number from 1 to 5000/i)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  it('shows an API refusal inside the dialog and keeps it open for another try', async () => {
    startRun.mockRejectedValue(
      new ApiError({ status: 402, code: 'plan_limit', title: 'Too many live tasks' })
    );
    const { user, onStarted } = setup();
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many live tasks');
    expect(onStarted).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /start a run/i })).toBeInTheDocument();
  });

  describe('idempotency key', () => {
    // `retry` is how the second attempt ends; a success closes the dialog, so a
    // test that goes on to edit the count has the retry fail too.
    const attemptTwice = async (first: unknown, retry: unknown = queued) => {
      startRun.mockReset().mockRejectedValueOnce(first);
      if (retry === queued) startRun.mockResolvedValue(queued);
      else startRun.mockRejectedValueOnce(retry).mockResolvedValue(queued);
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'Start run' }));
      const tasks = await screen.findByLabelText('Number of tasks');
      const submit = () => user.click(screen.getByRole('button', { name: 'Continue' }));
      const sent = () =>
        startRun.mock.calls.map(([vars]) => vars as { tasks: number; idempotencyKey: string });
      await submit();
      await screen.findByRole('alert');
      await submit();
      await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));
      return { user, tasks, submit, sent };
    };

    it('is reused when the outcome is unknown (network failure), so a retry cannot bill twice', async () => {
      const { sent } = await attemptTwice(new TypeError('Failed to fetch'));
      const [first, retry] = sent();
      expect(first?.tasks).toBe(1);
      expect(retry?.idempotencyKey).toBe(first?.idempotencyKey);
    });

    it.each([409, 500])(
      'is replaced after the API answered %s, because apid replays a stored refusal for 24 hours',
      async (status) => {
        const { sent } = await attemptTwice(
          new ApiError({ status, code: 'job_has_live_instances', title: 'Refused' })
        );
        const [first, retry] = sent();
        expect(retry?.idempotencyKey).toEqual(expect.any(String));
        expect(retry?.idempotencyKey).not.toBe(first?.idempotencyKey);
      }
    );

    it('is replaced when the count changes', async () => {
      const { user, tasks, submit, sent } = await attemptTwice(
        new TypeError('Failed to fetch'),
        new TypeError('Failed to fetch')
      );
      await user.clear(tasks);
      await user.type(tasks, '5');
      await submit();
      await waitFor(() => expect(startRun).toHaveBeenCalledTimes(3));
      const [first, , changed] = sent();
      expect(changed?.tasks).toBe(5);
      expect(changed?.idempotencyKey).not.toBe(first?.idempotencyKey);
    });
  });

  it('is unavailable for a paused workload, and says why', () => {
    setup('paused');
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
    expect(screen.getByText(/paused workload cannot start runs/i)).toBeInTheDocument();
  });
});

describe('JobActions delete', () => {
  it('requires the workload name to be typed and says what happens to its runs', async () => {
    const { user, onDeleted } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        typeToConfirm: 'nightly-export',
        confirmLabel: 'Delete workload',
        description: expect.stringMatching(/cancel .*runs/i),
      })
    );
    await waitFor(() => expect(deleteJob).toHaveBeenCalledWith('nightly-export'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Workload deleted' }));
  });

  it('deletes nothing when the confirm is declined', async () => {
    confirm.mockResolvedValue(false);
    const { user, onDeleted } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(deleteJob).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('explains job_has_live_instances as "cancel the runs first" and keeps the workload selected', async () => {
    deleteJob.mockRejectedValue(
      new ApiError({ status: 409, code: 'job_has_live_instances', title: 'raw server prose' })
    );
    const { user, onDeleted } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const message = toast.mock.calls[0]?.[0] as {
      kind: string;
      title: string;
      description: string;
    };
    expect(message.kind).toBe('error');
    expect(message.title).toBe('Workload still has tasks running');
    expect(message.description).toMatch(/cancel .*runs/i);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('reports any other failure with the API message', async () => {
    deleteJob.mockRejectedValue(new ApiError({ status: 500, code: 'internal', title: 'Boom' }));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Could not delete', description: 'Boom' })
      )
    );
  });
});
