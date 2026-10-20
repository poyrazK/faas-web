import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startRun = vi.fn();
const deleteJob = vi.fn();
const confirm = vi.fn();

const job = {
  id: 'job-1',
  name: 'nightly-export',
  kind: 'batch',
  status: 'active',
  image_ref: 'ghcr.io/acme/export:v1',
  ram_mb: 512,
  max_parallelism: 4,
  retry_max: 1,
};

vi.mock('@/lib/api/queries', () => ({
  useInfiniteJobs: () => ({
    data: { pages: [{ jobs: [job] }] },
    error: null,
    isPending: false,
    hasNextPage: false,
    refetch: vi.fn(),
  }),
  useJobs: () => ({ data: { jobs: [job] }, error: null, isPending: false, refetch: vi.fn() }),
  useStartJobRun: () => ({ mutateAsync: startRun, isPending: false }),
  useDeleteJob: () => ({ mutateAsync: deleteJob, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
// Unrelated panels: their own tests cover them.
vi.mock('./job-create-dialog', () => ({ JobCreateDialog: () => null }));
vi.mock('@/components/dashboard/job-runs', () => ({ JobRuns: () => null }));
vi.mock('@/components/dashboard/job-tasks', () => ({ JobTasks: () => null }));
vi.mock('@/components/dashboard/job-detail', () => ({
  JobDefinition: () => <p>definition</p>,
  JobRunDetail: () => null,
}));

const { WorkloadsBody } = await import('./jobs-workloads');

beforeEach(() => {
  startRun.mockReset().mockResolvedValue({ id: 'run-new', tasks: 1, aggregate_status: 'queued' });
  deleteJob.mockReset().mockResolvedValue(undefined);
  confirm.mockReset().mockResolvedValue(true);
});

function setup(selected = true) {
  const onSelection = vi.fn();
  render(
    <WorkloadsBody
      search={selected ? { job: 'job-1', run: 'old-run', task: 2 } : {}}
      onSelection={onSelection}
    />
  );
  return { onSelection, user: userEvent.setup() };
}

describe('Workloads start and delete', () => {
  it('offers neither action until a workload is selected', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: 'Start run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('opens the queued run in the run views, replacing the previously selected run and task', async () => {
    const { user, onSelection } = setup();
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(onSelection).toHaveBeenCalledWith({ run: 'run-new', task: undefined })
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'nightly-export', tasks: 1 })
    );
  });

  it('clears the selection once the workload is deleted', async () => {
    const { user, onSelection } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(onSelection).toHaveBeenCalledWith({
        job: undefined,
        run: undefined,
        task: undefined,
      })
    );
    expect(deleteJob).toHaveBeenCalledWith('nightly-export');
  });
});
