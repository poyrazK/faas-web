import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useInfiniteJobs = vi.fn();
const useJobs = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useInfiniteJobs: () => useInfiniteJobs() as unknown,
  useJobs: () => useJobs() as unknown,
}));
vi.mock('./job-create-dialog', () => ({ JobCreateDialog: () => null }));
vi.mock('@/components/dashboard/job-runs', () => ({ JobRuns: () => null }));
vi.mock('@/components/dashboard/job-tasks', () => ({ JobTasks: () => null }));
vi.mock('@/components/dashboard/job-detail', () => ({
  JobDefinition: () => <p>definition body</p>,
  JobRunDetail: () => null,
}));

const { WorkloadsBody } = await import('./jobs-workloads');

const job = {
  id: 'job-1',
  name: 'nightly-report',
  kind: 'recurring',
  status: 'active',
  image_ref: 'ghcr.io/acme/report:1',
  ram_mb: 512,
  max_parallelism: 4,
  retry_max: 2,
};

beforeEach(() => {
  useInfiniteJobs.mockReset().mockReturnValue({
    data: { pages: [{ jobs: [job] }] },
    isPending: false,
    error: null,
    hasNextPage: false,
    refetch: vi.fn(),
  });
  useJobs.mockReset().mockReturnValue({ data: undefined, isPending: false, error: null });
});

describe('WorkloadsBody', () => {
  it('names the CLI commands to run and delete the selected workload', () => {
    useJobs.mockReturnValue({ data: { jobs: [job] }, isPending: false, error: null });
    render(<WorkloadsBody search={{ job: 'job-1' }} onSelection={vi.fn()} />);

    expect(screen.getByText('gregale jobs run nightly-report --tasks 1')).toBeInTheDocument();
    expect(screen.getByText('gregale jobs rm nightly-report')).toBeInTheDocument();
    expect(screen.queryByText(/Further changes can be made with the CLI/)).not.toBeInTheDocument();
  });

  it('warns beside the run command that pasting it starts real, billed work', () => {
    useJobs.mockReturnValue({ data: { jobs: [job] }, isPending: false, error: null });
    render(<WorkloadsBody search={{ job: 'job-1' }} onSelection={vi.fn()} />);

    expect(
      screen.getByText('Start a run with one task. This starts real, billed work right away.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Delete this workload. The CLI does not ask first.')
    ).toBeInTheDocument();
  });

  it('names the copy buttons as short nouns, not as the warning sentences', () => {
    useJobs.mockReturnValue({ data: { jobs: [job] }, isPending: false, error: null });
    render(<WorkloadsBody search={{ job: 'job-1' }} onSelection={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Copy: run command for nightly-report' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy: delete command for nightly-report' })
    ).toBeInTheDocument();
  });

  it('shows no command until a workload is selected', () => {
    render(<WorkloadsBody search={{}} onSelection={vi.fn()} />);

    expect(screen.queryByText(/gregale jobs/)).not.toBeInTheDocument();
  });
});
