import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Job } from '@/lib/api/queries';

const update = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/jobs', () => ({
  useUpdateJobSchedule: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const {
  JobScheduleDialog,
  NO_SCHEDULE,
  jobScheduleRows,
  scheduleDraftErrors,
  scheduleDraftFrom,
  schedulePolicyFrom,
} = await import('./job-schedule');

const NOW = Date.parse('2026-11-03T10:00:00Z');

function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    account_id: 'a1',
    name: 'nightly-export',
    kind: 'batch',
    image_ref: 'ghcr.io/acme/export:v1',
    image_materialization_status: 'ready',
    command: ['export'],
    ram_mb: 512,
    task_timeout_sec: 60,
    max_parallelism: 2,
    retry_max: 1,
    status: 'active',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-05T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  update.mockReset().mockResolvedValue({});
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('schedule drafts', () => {
  it('needs a five-field cron, and holds the start deadline to 30 days', () => {
    expect(scheduleDraftErrors(NO_SCHEDULE, NOW).schedule).toMatch(/five-field/);
    expect(
      scheduleDraftErrors(
        { ...NO_SCHEDULE, schedule: '0 3 * * *', policy: true, deadline: '2592001' },
        NOW
      )
    ).toEqual({ schedule: undefined, deadline: expect.stringMatching(/30 days/) });
  });

  it('sends a policy only when one is chosen, and leaves out a blank deadline', () => {
    expect(schedulePolicyFrom({ ...NO_SCHEDULE, schedule: '0 3 * * *' })).toBeUndefined();
    expect(
      schedulePolicyFrom({ ...NO_SCHEDULE, policy: true, overlap: 'replace', missedRuns: 'skip' })
    ).toEqual({ version: 1, overlap: 'replace', missed_runs: 'skip' });
    expect(
      schedulePolicyFrom({ ...NO_SCHEDULE, policy: true, deadline: '120' })?.start_deadline_seconds
    ).toBe(120);
  });

  it('reads a stored schedule back into a draft', () => {
    expect(
      scheduleDraftFrom(
        job({
          schedule: '*/5 * * * *',
          timezone: 'Europe/Istanbul',
          schedule_policy: {
            version: 1,
            overlap: 'allow',
            missed_runs: 'coalesce_latest',
            start_deadline_seconds: 60,
          },
        })
      )
    ).toEqual({
      schedule: '*/5 * * * *',
      timezone: 'Europe/Istanbul',
      policy: true,
      overlap: 'allow',
      missedRuns: 'coalesce_latest',
      deadline: '60',
    });
  });

  it('describes a stored schedule, and nothing for a batch job', () => {
    expect(jobScheduleRows(job())).toEqual([]);
    const rows = jobScheduleRows(
      job({
        schedule: '0 3 * * *',
        timezone: 'Europe/Istanbul',
        schedule_policy: { version: 1, overlap: 'skip', missed_runs: 'skip' },
      })
    );
    expect(rows.map(([label]) => label)).toEqual([
      'Schedule',
      'Timezone',
      'Last scheduled',
      'Schedule policy',
    ]);
    expect(rows[3][1]).toBe('Skip while running · skip missed times · no start deadline');
  });
});

describe('JobScheduleDialog', () => {
  it('adds a schedule with its zone and policy', async () => {
    render(<JobScheduleDialog job={job()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Schedule'), '0 3 * * *');
    const zone = screen.getByLabelText('Timezone');
    await userEvent.clear(zone);
    await userEvent.type(zone, 'Europe/Istanbul');
    await userEvent.click(screen.getByLabelText(/Apply a schedule policy/));
    await userEvent.selectOptions(screen.getByLabelText('Overlap'), 'replace');
    await userEvent.selectOptions(screen.getByLabelText('Missed runs'), 'coalesce_latest');
    await userEvent.type(screen.getByLabelText(/Start deadline/), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        name: 'nightly-export',
        schedule: '0 3 * * *',
        timezone: 'Europe/Istanbul',
        schedule_policy: {
          version: 1,
          overlap: 'replace',
          missed_runs: 'coalesce_latest',
          start_deadline_seconds: 120,
        },
      })
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Schedule added' }));
  });

  it('refuses an invalid cron before sending anything', async () => {
    render(<JobScheduleDialog job={job()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Schedule'), 'every night');
    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(screen.getByText(/five-field cron/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('removes a schedule with an empty one, after asking', async () => {
    render(
      <JobScheduleDialog
        job={job({ kind: 'recurring', schedule: '0 3 * * *', timezone: 'UTC' })}
        onClose={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove schedule' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ name: 'nightly-export', schedule: '' })
    );
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
  });

  it('keeps a stored policy, which apid can replace but not remove', () => {
    render(
      <JobScheduleDialog
        job={job({
          kind: 'recurring',
          schedule: '0 3 * * *',
          timezone: 'UTC',
          schedule_policy: { version: 1, overlap: 'skip', missed_runs: 'skip' },
        })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/Apply a schedule policy/)).toBeChecked();
    expect(screen.getByLabelText(/Apply a schedule policy/)).toBeDisabled();
  });

  it('explains the refusal while runs are active', async () => {
    update.mockRejectedValue(
      new ApiError({ status: 409, code: 'validation_failed', title: 'Job has active runs' })
    );
    render(
      <JobScheduleDialog
        job={job({ kind: 'recurring', schedule: '0 3 * * *', timezone: 'UTC' })}
        onClose={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/active runs/);
  });
});
