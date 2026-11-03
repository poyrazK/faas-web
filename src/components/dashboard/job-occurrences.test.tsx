import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useJobOccurrences = vi.fn();
vi.mock('@/lib/api/jobs', () => ({
  ACTIVE_JOB_OCCURRENCE: new Set(['pending', 'queued', 'running', 'waiting_replacement']),
  useJobOccurrences: (...args: unknown[]) => useJobOccurrences(...args) as unknown,
}));

const { JobOccurrences } = await import('./job-occurrences');

const page = (occurrences: unknown[], over: Record<string, unknown> = {}) => ({
  data: { pages: [{ occurrences, limit: 50 }] },
  isPending: false,
  error: null,
  hasNextPage: false,
  refetch: vi.fn(),
  ...over,
});
const occurrence = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  schedule_revision: 2,
  scheduled_for: '2026-11-03T10:00:00Z',
  schedule_policy: { version: 1, overlap: 'skip', missed_runs: 'skip' },
  status: 'succeeded',
  created_at: '2026-11-03T10:00:00Z',
  ...over,
});
const policy = { version: 1 as const, overlap: 'skip' as const, missed_runs: 'skip' as const };

beforeEach(() => useJobOccurrences.mockReset().mockReturnValue(page([])));

describe('JobOccurrences', () => {
  it('lists each decision with its status and opens the run it started', async () => {
    useJobOccurrences.mockReturnValue(
      page([
        occurrence({ status: 'running', job_run_id: 'run-9' }),
        occurrence({
          status: 'skipped_overlap',
          reason: 'a previous scheduled run was still active',
        }),
        occurrence({ status: 'missed_deadline', start_deadline_at: '2026-11-03T08:02:00Z' }),
      ])
    );
    const onOpenRun = vi.fn();
    render(
      <JobOccurrences job={{ name: 'reindex', schedule_policy: policy }} onOpenRun={onOpenRun} />
    );
    expect(useJobOccurrences).toHaveBeenCalledWith('reindex');
    const rows = within(screen.getByRole('list', { name: 'Schedule occurrences' })).getAllByRole(
      'listitem'
    );
    expect(rows[0]).toHaveTextContent('Running');
    expect(rows[1]).toHaveTextContent('Skipped: still running');
    expect(rows[1]).toHaveTextContent('a previous scheduled run was still active');
    expect(rows[2]).toHaveTextContent('Missed start deadline');
    expect(rows[2]).toHaveTextContent('start by');
    expect(screen.getByText(/refreshes while one is in progress/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View run run-9' }));
    expect(onOpenRun).toHaveBeenCalledWith('run-9');
  });

  it('says that without a policy only started times are recorded', () => {
    render(<JobOccurrences job={{ name: 'reindex' }} onOpenRun={vi.fn()} />);
    expect(screen.getByText(/only the times that started a run are recorded/)).toBeInTheDocument();
    expect(screen.getByText('No scheduled time has been reached yet.')).toBeInTheDocument();
  });

  it('shows a refusal as an error, not as an empty history', () => {
    useJobOccurrences.mockReturnValue(
      page([], {
        data: undefined,
        error: new ApiError({ status: 503, code: 'capacity', title: 'History unavailable' }),
      })
    );
    render(<JobOccurrences job={{ name: 'reindex' }} onOpenRun={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('History unavailable');
    expect(screen.queryByText('No scheduled time has been reached yet.')).toBeNull();
  });

  it('loads older decisions on request', async () => {
    const fetchNextPage = vi.fn();
    useJobOccurrences.mockReturnValue(page([occurrence({})], { hasNextPage: true, fetchNextPage }));
    render(<JobOccurrences job={{ name: 'reindex' }} onOpenRun={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load older' }));
    expect(fetchNextPage).toHaveBeenCalled();
  });
});
