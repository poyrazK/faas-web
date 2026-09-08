import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useJobTasks = vi.fn();
const useJobTaskLog = vi.fn();

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
});

describe('JobTasks', () => {
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
    await userEvent.click(screen.getByRole('button', { name: /task 1/i }));
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
