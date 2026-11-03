import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startRun = vi.fn();
const deleteJob = vi.fn();
const confirm = vi.fn();
const readJobs = vi.fn();
const cap = vi.hoisted(() => ({ access: 'on' as string }));

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

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: cap.access, refresh: vi.fn() }),
  useCapabilityStage: () => 'Beta',
}));
vi.mock('@/components/dashboard/registry-credentials', () => ({
  JobRegistryCredentialsPanel: ({ name }: { name: string }) => <p>registries for {name}</p>,
}));
vi.mock('@/lib/api/queries', () => ({
  useInfiniteJobs: () => {
    readJobs();
    return {
      data: { pages: [{ jobs: [job] }] },
      error: null,
      isPending: false,
      hasNextPage: false,
      refetch: vi.fn(),
    };
  },
  useJobs: () => ({ data: { jobs: [job] }, error: null, isPending: false, refetch: vi.fn() }),
  useStartJobRun: () => ({ mutateAsync: startRun, isPending: false }),
  useDeleteJob: () => ({ mutateAsync: deleteJob, isPending: false }),
  useSetJobStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  readJobs.mockReset();
  cap.access = 'on';
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

describe('Workloads capability', () => {
  it('labels the section with the capability maturity', () => {
    setup(false);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it("shows the selected workload's own registries", () => {
    setup();
    expect(screen.getByText('registries for nightly-export')).toBeInTheDocument();
  });

  it('reads nothing while the account does not have jobs and workflows', () => {
    cap.access = 'off';
    setup(false);
    expect(readJobs).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Not enabled for this account/);
    expect(screen.queryByRole('button', { name: /New workload/ })).not.toBeInTheDocument();
  });
});
