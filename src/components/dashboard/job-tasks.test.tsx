import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useJobTasks = vi.fn();
const useJobTaskLog = vi.fn();
const retry = vi.fn();
const download = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/jobs', () => ({
  isManagedArtifact: (uri: string) => uri.startsWith('obj://'),
  useRetryJobTask: () => ({ mutateAsync: retry, isPending: false }),
  useDownloadJobArtifact: () => ({ mutateAsync: download, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

vi.mock('@/lib/api/queries', () => ({
  useJobTasks: (name: string, runId: string) => useJobTasks(name, runId) as unknown,
  useJobTaskLog: (name: string, runId: string, idx: number | null) =>
    useJobTaskLog(name, runId, idx) as unknown,
}));

const { JobTasks } = await import('./job-tasks');

const task = (over: Record<string, unknown> = {}) => ({
  run_id: 'run1',
  task_index: 0,
  status: 'succeeded',
  attempt: 1,
  ...over,
});
const ok = (tasks: unknown[]) => ({ data: { tasks }, isPending: false, error: null });
const log = (over: Record<string, unknown> = {}) => ({
  data: {
    task_status: 'succeeded',
    log_content: 'step 1 complete',
    truncated: false,
    max_bytes: 65536,
    ...over,
  },
  isPending: false,
  error: null,
});

beforeEach(() => {
  useJobTasks.mockReset().mockReturnValue(ok([task(), task({ task_index: 1, status: 'oom' })]));
  useJobTaskLog.mockReset().mockReturnValue(log());
  retry.mockReset().mockResolvedValue({
    task: task({ task_index: 1, status: 'queued', attempt: 2 }),
    run: {},
    retried_at: '2026-11-03T10:00:00Z',
    next_attempt_at: '2026-11-03T10:00:02Z',
  });
  download.mockReset();
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('JobTasks', () => {
  it('shows the log read error and a retry instead of claiming no log exists', async () => {
    const refetch = vi.fn();
    useJobTaskLog.mockReturnValue({ ...log(), error: new Error('Log service offline'), refetch });
    render(<JobTasks name="nightly-export" runId="run1" />);
    await userEvent.click(screen.getByRole('button', { name: 'task 0' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Log service offline');
    expect(screen.queryByText('No log for this task.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('offers retry after task-list failure', async () => {
    const refetch = vi.fn();
    useJobTasks.mockReturnValue({ ...ok([]), error: new Error('Tasks offline'), refetch });
    render(<JobTasks name="nightly-export" runId="run1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Tasks offline');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('lists tasks by index with their status', () => {
    render(<JobTasks name="nightly-export" runId="run1" />);
    expect(screen.getByText('oom')).toBeInTheDocument();
  });

  it('shows the retry attempt only when there has been one', () => {
    useJobTasks.mockReturnValue(ok([task({ attempt: 3 })]));
    render(<JobTasks name="nightly-export" runId="run1" />);
    expect(screen.getByText(/attempt 3/i)).toBeInTheDocument();
  });

  it('fetches no log until a task is chosen', () => {
    render(<JobTasks name="nightly-export" runId="run1" />);
    expect(useJobTaskLog).toHaveBeenLastCalledWith('nightly-export', 'run1', null);
  });

  it('fetches the log for the task that was opened', async () => {
    render(<JobTasks name="nightly-export" runId="run1" />);
    await userEvent.click(screen.getByRole('button', { name: 'task 1' }));
    expect(useJobTaskLog).toHaveBeenLastCalledWith('nightly-export', 'run1', 1);
  });

  it('says when a log was cut rather than passing it off as complete', async () => {
    useJobTaskLog.mockReturnValue(log({ truncated: true, max_bytes: 65536 }));
    render(<JobTasks name="nightly-export" runId="run1" />);
    await userEvent.click(screen.getByRole('button', { name: /task 0/i }));
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
    expect(screen.getByText(/65536/)).toBeInTheDocument();
  });

  it('says so when the run has no tasks', () => {
    useJobTasks.mockReturnValue(ok([]));
    render(<JobTasks name="nightly-export" runId="run1" />);
    expect(screen.getByText(/no tasks/i)).toBeInTheDocument();
  });
});

describe('JobTasks retry', () => {
  it('offers retry only on failed, timed-out, OOM and cancelled tasks', () => {
    useJobTasks.mockReturnValue(
      ok(
        ['succeeded', 'failed', 'timeout', 'oom', 'cancelled', 'claimed', 'queued'].map(
          (status, i) => task({ task_index: i, status })
        )
      )
    );
    render(<JobTasks name="nightly-export" runId="run1" />);
    const names = screen
      .getAllByRole('button', { name: /^Retry task/ })
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Retry task 1', 'Retry task 2', 'Retry task 3', 'Retry task 4']);
  });

  it('asks, then retries with an idempotency key, and says when the attempt starts', async () => {
    render(<JobTasks name="nightly-export" runId="run1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 1' }));
    await waitFor(() => expect(retry).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Retry task' }));
    expect(retry).toHaveBeenCalledWith({
      name: 'nightly-export',
      runId: 'run1',
      index: 1,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Task 1 queued for attempt 2' })
    );
  });

  it('sends nothing when the confirmation is dismissed', async () => {
    confirm.mockResolvedValue(false);
    render(<JobTasks name="nightly-export" runId="run1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 1' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(retry).not.toHaveBeenCalled();
  });

  it('points at Replay failed once the retry budget is spent', async () => {
    retry.mockRejectedValue(
      new ApiError({ status: 409, code: 'job_task_max_retries_reached', title: 'Spent' })
    );
    render(<JobTasks name="nightly-export" runId="run1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 1' }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', description: expect.stringMatching(/Replay/) })
    );
  });

  it('reuses the key after a lost answer, so a second click cannot spend two attempts', async () => {
    retry.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<JobTasks name="nightly-export" runId="run1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 1' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 1' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(2));
    const [first, second] = retry.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey
    );
    expect(second).toBe(first);
  });

  it('shows why a task failed', () => {
    useJobTasks.mockReturnValue(
      ok([
        task({
          status: 'failed',
          error_class: 'failed',
          error_message: 'process exited',
          exit_code: 2,
        }),
      ])
    );
    render(<JobTasks name="nightly-export" runId="run1" />);
    expect(screen.getByText('failed: process exited (exit 2)')).toBeInTheDocument();
  });

  it('names the task a replay came from', () => {
    useJobTasks.mockReturnValue(ok([task({ status: 'queued', source_task_index: 7 })]));
    render(<JobTasks name="nightly-export" runId="run1" />);
    expect(screen.getByText('from task 7')).toBeInTheDocument();
  });
});

describe('JobTasks artifacts', () => {
  const manifest = {
    version: 1,
    artifacts: [
      {
        name: 'result',
        uri: 'obj://app/bucket/shard-a.parquet',
        size_bytes: 1_234_567,
        sha256: `sha256:${'ab'.repeat(32)}`,
      },
      {
        name: 'report',
        uri: 's3://my-results/report.json',
        size_bytes: 2048,
        sha256: `sha256:${'cd'.repeat(32)}`,
      },
    ],
  };

  beforeEach(() => {
    useJobTasks.mockReturnValue(ok([task({ output_manifest: manifest })]));
  });

  it('lists what a successful task published, with sizes', () => {
    render(<JobTasks name="nightly-export" runId="run1" />);
    expect(screen.getByText('result')).toBeInTheDocument();
    expect(screen.getByText('1.2 MB')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('downloads only a Gregale-managed artifact, and shows the location of the rest', () => {
    render(<JobTasks name="nightly-export" runId="run1" />);
    expect(screen.getByRole('button', { name: 'Download result' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download report' })).not.toBeInTheDocument();
    expect(screen.getByText('s3://my-results/report.json')).toBeInTheDocument();
  });

  it('verifies, then follows the signed link and reports the checksum', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    download.mockResolvedValue({
      name: 'result',
      size_bytes: 1_234_567,
      sha256: `sha256:${'ab'.repeat(32)}`,
      verified_at: '2026-11-03T10:00:00Z',
      download: {
        url: 'https://s3.gregale.dev/b/shard-a.parquet?sig=x',
        method: 'GET',
        headers: {},
        expires_at: '2026-11-03T10:05:00Z',
      },
    });
    render(<JobTasks name="nightly-export" runId="run1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Download result' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(download).toHaveBeenCalledWith({
      name: 'nightly-export',
      runId: 'run1',
      index: 0,
      artifact: 'result',
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'result verified' })
    );
    click.mockRestore();
  });

  it('reports a changed object rather than downloading it', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    download.mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'validation_failed',
        title: 'Output artifact verification failed',
        detail: "the object bytes differ from the task's output manifest",
      })
    );
    render(<JobTasks name="nightly-export" runId="run1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Download result' }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(click).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', title: 'Could not download result' })
    );
    click.mockRestore();
  });
});
