import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useJobRuns = vi.fn();
const cancel = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useJobRuns: (name: string) => useJobRuns(name) as unknown,
  useCancelJobRun: () => ({ mutateAsync: cancel, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { JobRuns } = await import('./job-runs');

function run(over: Record<string, unknown> = {}) {
  return {
    id: 'run1',
    job_id: 'j1',
    account_id: 'a1',
    trigger_kind: 'scheduled',
    tasks: 24,
    parallelism: 25,
    aggregate_status: 'running',
    tasks_succeeded: 12,
    tasks_failed: 0,
    tasks_cancelled: 0,
    created_at: '2026-09-06T10:00:00Z',
    updated_at: '2026-09-06T10:05:00Z',
    ...over,
  };
}
const ok = (runs: unknown[]) => ({
  data: { runs },
  isPending: false,
  error: null,
  refetch: vi.fn(),
});

beforeEach(() => {
  useJobRuns.mockReset().mockReturnValue(ok([run()]));
  cancel.mockReset().mockResolvedValue({});
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('JobRuns', () => {
  it('shows task progress against the total, not just a status word', () => {
    render(<JobRuns name="nightly-export" onSelect={vi.fn()} selectedRunId={null} />);
    expect(screen.getByText(/12\s*\/\s*24/)).toBeInTheDocument();
  });

  it('offers cancel only while a run can still be cancelled', () => {
    useJobRuns.mockReturnValue(ok([run({ id: 'a', aggregate_status: 'succeeded' })]));
    render(<JobRuns name="nightly-export" onSelect={vi.fn()} selectedRunId={null} />);
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('confirms before cancelling, since tasks in flight are lost', async () => {
    render(<JobRuns name="nightly-export" onSelect={vi.fn()} selectedRunId={null} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(cancel).toHaveBeenCalledWith({ name: 'nightly-export', runId: 'run1' });
  });

  it('explains a 409 as the run having already finished', async () => {
    cancel.mockRejectedValue(
      new ApiError({ status: 409, code: 'job_run_not_cancellable', title: 'Finished' })
    );
    render(<JobRuns name="nightly-export" onSelect={vi.fn()} selectedRunId={null} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'info' }));
  });

  it('selects a run when its id is clicked', async () => {
    const onSelect = vi.fn();
    render(<JobRuns name="nightly-export" onSelect={onSelect} selectedRunId={null} />);
    await userEvent.click(screen.getByRole('button', { name: /run1/i }));
    expect(onSelect).toHaveBeenCalledWith('run1');
  });

  it('says so when the job has never run', () => {
    useJobRuns.mockReturnValue(ok([]));
    render(<JobRuns name="nightly-export" onSelect={vi.fn()} selectedRunId={null} />);
    expect(screen.getByText(/has not run yet/i)).toBeInTheDocument();
  });
});
