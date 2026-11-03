import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useLogStream = vi.fn();
const useJobTaskAttempts = vi.fn();

vi.mock('@/lib/api/logs', () => ({
  MAX_LINES: 2000,
  useLogStream: (...args: unknown[]) => useLogStream(...args) as unknown,
}));
vi.mock('@/lib/api/jobs', () => ({
  useJobTaskAttempts: (...args: unknown[]) => useJobTaskAttempts(...args) as unknown,
}));

const { TaskOutput, TaskAttempts } = await import('./job-task-output');

const stream = (over: Record<string, unknown> = {}) => ({
  lines: [],
  status: 'streaming',
  truncated: false,
  gaps: 0,
  canRetry: false,
  clear: vi.fn(),
  retry: vi.fn(),
  ...over,
});
const stored = (over: Record<string, unknown> = {}) => ({
  data: { log_content: 'stored line', truncated: false, max_bytes: 65536 },
  isPending: false,
  error: null,
  refetch: vi.fn(),
  ...over,
});
const attempts = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  data: { pages: [{ attempts: rows }] },
  isPending: false,
  error: null,
  hasNextPage: false,
  refetch: vi.fn(),
  ...over,
});
const task = (status: string) => ({
  run_id: 'run-1',
  task_index: 3,
  status,
  attempt: 1,
  created_at: '2026-11-03T10:00:00Z',
});

beforeEach(() => {
  useLogStream.mockReset().mockReturnValue(stream());
  useJobTaskAttempts.mockReset().mockReturnValue(attempts([]));
});

describe('TaskOutput', () => {
  it('follows a running task live, over the task stream', () => {
    useLogStream.mockReturnValue(
      stream({
        lines: [
          { id: '1', ts: 0, text: 'step 1' },
          { id: '2', ts: 0, text: 'step 2' },
        ],
      })
    );
    render(
      <TaskOutput
        name="nightly"
        runId="run-1"
        task={task('claimed') as never}
        stored={stored()}
        onEnded={vi.fn()}
      />
    );
    expect(useLogStream).toHaveBeenCalledWith(
      { kind: 'task', job: 'nightly', runId: 'run-1', index: 3 },
      true
    );
    expect(screen.getByLabelText('Live output of task 3')).toHaveTextContent('step 1 step 2');
    expect(screen.getByRole('status')).toHaveTextContent('Live');
  });

  it('says a queued task is waiting rather than silent', () => {
    render(
      <TaskOutput
        name="nightly"
        runId="run-1"
        task={task('queued') as never}
        stored={stored()}
        onEnded={vi.fn()}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the task to start.');
  });

  it('pauses the connection without losing what it showed', async () => {
    const user = userEvent.setup();
    render(
      <TaskOutput
        name="nightly"
        runId="run-1"
        task={task('claimed') as never}
        stored={stored()}
        onEnded={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(useLogStream).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  it('reads a finished task from its stored tail and opens no stream', () => {
    render(
      <TaskOutput
        name="nightly"
        runId="run-1"
        task={task('failed') as never}
        stored={stored()}
        onEnded={vi.fn()}
      />
    );
    expect(useLogStream).not.toHaveBeenCalled();
    expect(screen.getByText('stored line')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Live' })).toBeNull();
  });

  it('points at the stored tail when the task ended before its output was relayed', async () => {
    const onEnded = vi.fn();
    useLogStream.mockReturnValue(stream({ status: 'ended', reason: 'stored_output' }));
    const user = userEvent.setup();
    render(
      <TaskOutput
        name="nightly"
        runId="run-1"
        task={task('claimed') as never}
        stored={stored()}
        onEnded={onEnded}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(/stored tail has the rest/);
    expect(onEnded).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Read the stored tail' }));
    expect(screen.getByText('stored line')).toBeInTheDocument();
  });

  it('says when the VM dropped lines, and offers a retry after the stream gave up', () => {
    const retry = vi.fn();
    useLogStream.mockReturnValue(stream({ status: 'error', gaps: 1, canRetry: true, retry }));
    render(
      <TaskOutput
        name="nightly"
        runId="run-1"
        task={task('claimed') as never}
        stored={stored()}
        onEnded={vi.fn()}
      />
    );
    expect(screen.getByText(/already dropped some earlier lines/)).toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry log stream' }).click();
    expect(retry).toHaveBeenCalled();
  });
});

describe('TaskAttempts', () => {
  it('lists each finished attempt with its outcome, decision and log', async () => {
    useJobTaskAttempts.mockReturnValue(
      attempts([
        {
          run_id: 'run-1',
          task_index: 3,
          attempt: 1,
          status: 'failed',
          exit_code: 65,
          error_class: 'failed',
          error_message: 'exit status 65',
          outcome_code: 'upstream_unavailable',
          work_decision: {
            classification: 'retryable_failure',
            action: 'retry',
            reason: 'outcome_rule',
            policy_version: 1,
          },
          started_at: '2026-11-03T10:00:00Z',
          finished_at: '2026-11-03T10:01:05Z',
          log_content: 'attempt one output',
          log_truncated: true,
        },
        {
          run_id: 'run-1',
          task_index: 3,
          attempt: 2,
          status: 'oom',
          finished_at: '2026-11-03T10:05:00Z',
          log_content: '',
          log_truncated: false,
        },
      ])
    );
    render(<TaskAttempts name="nightly" runId="run-1" index={3} />);
    expect(useJobTaskAttempts).toHaveBeenCalledWith('nightly', 'run-1', 3);
    const list = screen.getByRole('list');
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('Attempt 1');
    expect(first).toHaveTextContent('Failed');
    expect(first).toHaveTextContent('exit 65');
    expect(first).toHaveTextContent('1m 5s');
    expect(first).toHaveTextContent('upstream_unavailable');
    expect(first).toHaveTextContent('retried (outcome rule)');
    expect(first).toHaveTextContent('tail only');
    expect(second).toHaveTextContent('Out of memory');
    expect(second).toHaveTextContent('This attempt wrote no output.');
  });

  it('says when no attempt has finished yet', () => {
    render(<TaskAttempts name="nightly" runId="run-1" index={0} />);
    expect(screen.getByText('No attempt has finished yet.')).toBeInTheDocument();
  });

  it('pages through a long history', async () => {
    const fetchNextPage = vi.fn();
    useJobTaskAttempts.mockReturnValue(
      attempts(
        [{ attempt: 1, status: 'failed', finished_at: '2026-11-03T10:00:00Z', log_content: '' }],
        { hasNextPage: true, fetchNextPage }
      )
    );
    render(<TaskAttempts name="nightly" runId="run-1" index={0} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load more attempts' }));
    expect(fetchNextPage).toHaveBeenCalled();
  });
});
