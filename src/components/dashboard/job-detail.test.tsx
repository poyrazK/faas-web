import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useJob = vi.fn();
const useJobRun = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useJob: (name: string) => useJob(name) as unknown,
  useJobRun: (name: string, id: string) => useJobRun(name, id) as unknown,
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api/jobs', () => ({
  useUpdateJobDefinition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateJobSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { JobDefinition, JobRunDetail } = await import('./job-detail');

beforeEach(() => {
  useJob.mockReset().mockReturnValue({
    data: {
      id: 'j1',
      account_id: 'a1',
      name: 'nightly-export',
      kind: 'recurring',
      image_ref: 'ghcr.io/acme/export:2.1',
      command: ['python', '-m', 'export'],
      env_overrides: { REGION: 'eu' },
      ram_mb: 512,
      task_timeout_sec: 90,
      max_parallelism: 8,
      retry_max: 2,
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-05T00:00:00Z',
    },
    isPending: false,
    error: null,
  });
  useJobRun.mockReset().mockReturnValue({
    data: {
      id: 'r1',
      job_id: 'j1',
      account_id: 'a1',
      trigger_kind: 'scheduled',
      tasks: 24,
      parallelism: 8,
      retry_max: 2,
      task_timeout_sec: 90,
      aggregate_status: 'succeeded',
      tasks_succeeded: 22,
      tasks_failed: 0,
      tasks_cancelled: 0,
      tasks_running: 0,
      dead_letter_count: 2,
      started_at: '2026-09-08T09:00:00Z',
      finished_at: '2026-09-08T09:02:30Z',
      created_at: '2026-09-08T09:00:00Z',
    },
    isPending: false,
    error: null,
  });
});

describe('JobDefinition', () => {
  it('shows the fields that explain how a run will behave', () => {
    render(<JobDefinition name="nightly-export" />);
    expect(screen.getByText('python -m export')).toBeInTheDocument();
    expect(screen.getByText('1m 30s')).toBeInTheDocument();
    expect(screen.getByText('REGION=eu')).toBeInTheDocument();
    expect(screen.getByText('ghcr.io/acme/export:2.1')).toBeInTheDocument();
  });

  it('reads a 404 as the job being gone', () => {
    useJob.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 404, code: 'job_not_found', title: 'Gone' }),
    });
    render(<JobDefinition name="nightly-export" />);
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
  });

  it('shows the schedule, its zone and its policy, with a way to edit it', () => {
    const current = useJob();
    useJob.mockReturnValue({
      ...current,
      data: {
        ...current.data,
        schedule: '0 3 * * *',
        timezone: 'Europe/Istanbul',
        schedule_policy: {
          version: 1,
          overlap: 'replace',
          missed_runs: 'coalesce_latest',
          start_deadline_seconds: 120,
        },
      },
    });
    render(<JobDefinition name="nightly-export" />);
    expect(screen.getByText('Europe/Istanbul')).toBeInTheDocument();
    expect(
      screen.getByText('Replace the running one · run the latest missed time · start within 120s')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit schedule' })).toBeInTheDocument();
  });

  it('offers to add a schedule to a batch job', () => {
    const current = useJob();
    useJob.mockReturnValue({ ...current, data: { ...current.data, kind: 'batch' } });
    render(<JobDefinition name="nightly-export" />);
    expect(screen.getByRole('button', { name: 'Add a schedule' })).toBeInTheDocument();
    expect(screen.getByText(/Runs start only when you start them/)).toBeInTheDocument();
  });

  it("offers no schedule for an image run's runner job, which apid manages", () => {
    const current = useJob();
    useJob.mockReturnValue({ ...current, data: { ...current.data, kind: 'image_run' } });
    render(<JobDefinition name="nightly-export" />);
    expect(screen.queryByRole('button', { name: /schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit definition' })).not.toBeInTheDocument();
  });

  it('opens the definition editor', async () => {
    render(<JobDefinition name="nightly-export" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit definition' }));
    expect(screen.getByRole('dialog', { name: 'Edit nightly-export' })).toBeInTheDocument();
  });

  it('shows the failure rules a task is classified by', () => {
    const current = useJob();
    useJob.mockReturnValue({
      ...current,
      data: {
        ...current.data,
        failure_rules: {
          version: 1,
          rules: [{ exit_codes: [65], action: 'fail_partition' }],
          unmatched_failure: 'retry',
          uncertain_outcome: 'hold',
        },
      },
    });
    render(<JobDefinition name="nightly-export" />);
    expect(screen.getByText('Exit 65 → fail the partition')).toBeInTheDocument();
    expect(screen.getByText('Any other failure → retry')).toBeInTheDocument();
    expect(
      screen.getByText('Lost completion receipt → hold for reconciliation')
    ).toBeInTheDocument();
  });

  it('says when the image could not be prepared, and that runs are refused until it changes', () => {
    const current = useJob();
    useJob.mockReturnValue({
      ...current,
      data: {
        ...current.data,
        image_materialization_status: 'failed',
        image_materialization_error: 'manifest unknown',
      },
    });
    render(<JobDefinition name="nightly-export" />);
    expect(screen.getByText('Image failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The image could not be prepared: manifest unknown'
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/refused until the image reference/);
  });
});

describe('JobRunDetail', () => {
  it('lists the options the run started with', () => {
    const current = useJobRun();
    useJobRun.mockReturnValue({
      ...current,
      data: {
        ...current.data,
        execution_class: 'flexible',
        eligible_at: '2026-11-03T10:00:00Z',
        latest_start_at: '2026-11-03T14:00:00Z',
        failure_policy: 'fail_fast',
        command: ['python', '--dataset', '2026-09'],
        input_manifest_uri: 'obj://app/bkt/in.json',
        input_manifest_sha256: 'sha256:abc',
        source_run_id: 'run-0',
        env_overrides: { DATASET: '2026-09' },
      },
    });
    render(<JobRunDetail name="nightly-export" runId="r1" />);
    const settings = screen.getByLabelText('Run settings');
    expect(settings).toHaveTextContent(/Flexible ·/);
    expect(settings).toHaveTextContent('Fail fast: cancel unstarted tasks');
    expect(settings).toHaveTextContent('python --dataset 2026-09');
    expect(settings).toHaveTextContent('obj://app/bkt/in.json (sha256:abc)');
    expect(settings).toHaveTextContent('run-0');
    expect(settings).toHaveTextContent('DATASET');
  });

  it('surfaces dead-lettered tasks, which the aggregate status hides', async () => {
    render(<JobRunDetail name="nightly-export" runId="r1" />);
    expect(screen.getByText('succeeded')).toBeInTheDocument();
    expect(screen.getByText('Dead-lettered')).toBeInTheDocument();
    expect(await screen.findByText('exhausted every retry')).toBeInTheDocument();
  });

  it('reports how long the run took', () => {
    render(<JobRunDetail name="nightly-export" runId="r1" />);
    expect(screen.getByText(/ran 2m 30s/)).toBeInTheDocument();
  });

  it('says a still-running run has run "so far"', () => {
    const current = useJobRun();
    useJobRun.mockReturnValue({
      ...current,
      data: { ...current.data, aggregate_status: 'running', finished_at: undefined },
    });
    render(<JobRunDetail name="nightly-export" runId="r1" />);
    expect(screen.getByText(/so far/)).toBeInTheDocument();
  });
});
