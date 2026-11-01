import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';

const confirm = vi.fn();
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { JobSchedule } = await import('./job-schedule');

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const problem = (status: number, code: string, detail: string) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail },
    response: new Response(null, { status }),
  });

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  name: 'nightly-export',
  kind: 'recurring',
  status: 'active',
  image_ref: 'registry/export:v1',
  command: ['export'],
  ram_mb: 512,
  max_parallelism: 2,
  retry_max: 1,
  task_timeout_sec: 60,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  schedule: '0 3 * * *',
  timezone: 'Europe/Istanbul',
  last_scheduled_at: '2026-11-01T00:00:00Z',
  schedule_policy: {
    version: 1,
    overlap: 'skip',
    start_deadline_seconds: 120,
    missed_runs: 'skip',
  },
  ...over,
});
const batch = () =>
  job({
    kind: 'batch',
    schedule: undefined,
    timezone: undefined,
    last_scheduled_at: undefined,
    schedule_policy: undefined,
  });

function mount(children: ReactNode = <JobSchedule name="nightly-export" />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function serve(data: Record<string, unknown>) {
  spyApi('GET').mockImplementation(() => ok(data));
}

beforeEach(() => confirm.mockReset().mockResolvedValue(true));
afterEach(() => vi.restoreAllMocks());

describe('JobSchedule', () => {
  it('shows the cron, its zone and the policy the scheduler applies', async () => {
    serve(job());
    mount();
    expect(await screen.findByText('0 3 * * *')).toBeInTheDocument();
    expect(screen.getByText('Europe/Istanbul')).toBeInTheDocument();
    expect(screen.getByText(/03:00 Europe\/Istanbul/)).toBeInTheDocument();
    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
    expect(screen.getByText('Skip while running')).toBeInTheDocument();
    expect(screen.getByText('2m 0s')).toBeInTheDocument();
    expect(screen.getByText('Record as skipped')).toBeInTheDocument();
  });

  it('says a batch workload has no schedule and offers to add one', async () => {
    serve(batch());
    mount();
    expect(await screen.findByText(/runs only when started/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add schedule' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove schedule' })).not.toBeInTheDocument();
  });

  it('cannot edit an image run, which apid manages itself', async () => {
    serve(job({ kind: 'image_run', schedule: undefined }));
    mount();
    expect(await screen.findByText(/managed by its image run/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /schedule/i })).not.toBeInTheDocument();
  });

  it('sends only the fields that changed', async () => {
    serve(job());
    const patch = spyApi('PATCH').mockImplementation(() => ok(job({ schedule: '30 3 * * *' })));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit schedule' }));
    const dialog = await screen.findByRole('dialog');
    const cron = within(dialog).getByRole('textbox', { name: 'Schedule' });
    await userEvent.clear(cron);
    await userEvent.type(cron, '30 3 * * *');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/jobs/{name}', {
        params: { path: { name: 'nightly-export' } },
        body: { schedule: '30 3 * * *' },
      })
    );
    expect(await screen.findByText('Schedule updated')).toBeInTheDocument();
  });

  it('sends the whole policy when one of its fields changes', async () => {
    serve(job());
    const patch = spyApi('PATCH').mockImplementation(() => ok(job()));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit schedule' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Missed runs' }),
      'coalesce_latest'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/jobs/{name}', {
        params: { path: { name: 'nightly-export' } },
        body: {
          schedule_policy: {
            version: 1,
            overlap: 'skip',
            start_deadline_seconds: 120,
            missed_runs: 'coalesce_latest',
          },
        },
      })
    );
  });

  it('adds a schedule to a batch workload with its zone', async () => {
    serve(batch());
    const patch = spyApi('PATCH').mockImplementation(() => ok(job()));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Schedule' }), '0 3 * * *');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/jobs/{name}', {
        params: { path: { name: 'nightly-export' } },
        body: { schedule: '0 3 * * *', timezone: 'UTC' },
      })
    );
  });

  it('refuses an invalid cron before sending it', async () => {
    serve(job());
    const patch = spyApi('PATCH');
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit schedule' }));
    const dialog = await screen.findByRole('dialog');
    const cron = within(dialog).getByRole('textbox', { name: 'Schedule' });
    await userEvent.clear(cron);
    await userEvent.type(cron, 'every night');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    expect(within(dialog).getByText(/five-field cron schedule/i)).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('keeps the draft and says why when apid refuses, such as active runs', async () => {
    serve(job());
    spyApi('PATCH').mockImplementation(() =>
      problem(
        409,
        'validation_failed',
        'wait for active runs to finish or cancel them before updating this job'
      )
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit schedule' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Overlap' }),
      'allow'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    expect(await within(dialog).findByText(/wait for active runs/)).toBeInTheDocument();
  });

  it('removes the schedule after saying what stops', async () => {
    serve(job());
    const patch = spyApi('PATCH').mockImplementation(() => ok(batch()));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove schedule' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Remove the schedule of nightly-export?',
        destructive: true,
      })
    );
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/jobs/{name}', {
        params: { path: { name: 'nightly-export' } },
        body: { schedule: '' },
      })
    );
  });
});
