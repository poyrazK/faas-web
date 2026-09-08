import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useJob = vi.fn();
const useJobRun = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useJob: (name: string) => useJob(name) as unknown,
  useJobRun: (name: string, id: string) => useJobRun(name, id) as unknown,
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
});

describe('JobRunDetail', () => {
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
