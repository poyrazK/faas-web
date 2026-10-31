import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createCron = vi.fn();
const updateCron = vi.fn();
const toast = vi.fn();
const scheduled = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useCrons: () => ({ data: scheduled.rows, isPending: false, error: null, refetch: vi.fn() }),
  useApps: () => ({ data: [{ id: '0123456789abcdef0123456789abcdef', slug: 'api' }] }),
  useCreateCron: () => ({ mutateAsync: createCron, isPending: false }),
  useRunCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCron: () => ({ mutateAsync: updateCron, isPending: false }),
  useCronRuns: () => ({ data: { runs: [] }, isPending: false, error: null }),
  useFireNowRequest: () => ({ data: undefined }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));

const { ScheduledRequestsBody } = await import('@/components/dashboard/jobs-scheduled');
const CronsPage = () => <ScheduledRequestsBody search={{}} onSelection={() => {}} />;

async function openCreation() {
  render(<CronsPage />);
  await userEvent.click(screen.getByRole('button', { name: 'New scheduled request' }));
  return within(screen.getByRole('dialog', { name: 'New scheduled request' }));
}

beforeEach(() => {
  scheduled.rows = [];
  createCron
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ schedule: '*/15 * * * *', path: '/' });
  updateCron.mockReset().mockResolvedValue({});
  toast.mockReset();
});

describe('scheduled request creation', () => {
  it('shows readable UTC schedules and distinguishes paused and non-UTC previews', () => {
    scheduled.rows = [
      {
        id: 'utc',
        app_id: '0123456789abcdef0123456789abcdef',
        schedule: '*/15 * * * *',
        path: '/utc',
        timezone: 'UTC',
        enabled: true,
      },
      {
        id: 'paused',
        app_id: '0123456789abcdef0123456789abcdef',
        schedule: '0 * * * *',
        path: '/paused',
        timezone: 'UTC',
        enabled: false,
      },
      {
        id: 'zoned',
        app_id: '0123456789abcdef0123456789abcdef',
        schedule: '0 9 * * *',
        path: '/zoned',
        timezone: 'America/New_York',
        enabled: true,
      },
    ];
    render(<CronsPage />);
    expect(screen.getByText('Every 15 minutes')).toBeInTheDocument();
    expect(screen.getByText('Daily at 09:00 America/New_York')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(screen.getByText('Preview unavailable').closest('tr')?.querySelector('time')).toBeNull();
    expect(screen.getByText('/utc').closest('tr')?.querySelector('time')).toHaveAttribute(
      'datetime'
    );
  });

  it('previews a preset and submits its expression without changing the app or path', async () => {
    createCron.mockReset().mockResolvedValue({ schedule: '0 9 * * MON-FRI', path: '/report' });
    const dialog = await openCreation();
    await userEvent.selectOptions(
      dialog.getByRole('combobox', { name: 'Schedule preset' }),
      '0 9 * * MON-FRI'
    );
    expect(dialog.getByRole('textbox', { name: 'Schedule' })).toHaveValue('0 9 * * MON-FRI');
    expect(dialog.getByRole('list').children).toHaveLength(3);
    expect(createCron).not.toHaveBeenCalled();
    await userEvent.clear(dialog.getByRole('textbox', { name: 'Path' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Path' }), '/report');
    await userEvent.click(dialog.getByRole('button', { name: 'Create scheduled request' }));
    await waitFor(() =>
      expect(createCron).toHaveBeenCalledWith({
        app_id: '0123456789abcdef0123456789abcdef',
        schedule: '0 9 * * MON-FRI',
        path: '/report',
      })
    );
  });

  it('blocks a syntactically valid schedule that never occurs', async () => {
    const dialog = await openCreation();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Schedule' }), '0 0 30 FEB *{Enter}');
    expect(dialog.getByRole('textbox', { name: 'Schedule' })).toHaveAccessibleDescription(
      'Choose a schedule with an upcoming run within five years.'
    );
    expect(createCron).not.toHaveBeenCalled();
  });
  it('opens creation on demand and discards a cancelled draft', async () => {
    render(<CronsPage />);
    const opener = screen.getByRole('button', { name: 'New scheduled request' });
    expect(screen.queryByRole('textbox', { name: 'Schedule' })).not.toBeInTheDocument();

    await userEvent.click(opener);
    const dialog = within(screen.getByRole('dialog', { name: 'New scheduled request' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Schedule' }), '*/15 * * * *');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Path' }), 'refresh');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(createCron).not.toHaveBeenCalled();
    await userEvent.click(opener);
    expect(screen.getByRole('textbox', { name: 'Schedule' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Path' })).toHaveValue('/');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    '99 * * * *',
    'a b c d e',
    '* * * * 7',
    '0 0 * FOO MON',
    '0 0 * DEC-JAN MON',
    '0 0 * JAN MON/0',
  ])('rejects the range-invalid or malformed schedule %s', async (invalidSchedule) => {
    await openCreation();
    const schedule = screen.getByRole('textbox', { name: 'Schedule' });

    await userEvent.type(schedule, `${invalidSchedule}{Enter}`);

    expect(schedule).toHaveFocus();
    expect(schedule).toHaveAccessibleDescription('Enter a five-field cron schedule.');
    expect(createCron).not.toHaveBeenCalled();
  });

  it.each(['0 0 * JAN MON', '0 9 ? JAN,MAR MON-FRI/2', '*/15 9-17/2 1,15 JAN-DEC SUN,SAT'])(
    'submits the backend-supported symbolic schedule %s',
    async (validSchedule) => {
      createCron.mockReset().mockResolvedValue({ schedule: validSchedule, path: '/' });
      await openCreation();
      const schedule = screen.getByRole('textbox', { name: 'Schedule' });

      await userEvent.type(schedule, `${validSchedule}{Enter}`);

      await waitFor(() =>
        expect(createCron).toHaveBeenCalledWith(
          expect.objectContaining({ schedule: validSchedule })
        )
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
  );

  it('reports malformed keyboard submissions, then supports failure, retry, and success', async () => {
    await openCreation();
    const schedule = screen.getByRole('textbox', { name: 'Schedule' });

    await userEvent.type(schedule, 'not a cron{Enter}');
    expect(schedule).toHaveFocus();
    expect(schedule).toHaveAccessibleDescription('Enter a five-field cron schedule.');
    expect(createCron).not.toHaveBeenCalled();

    await userEvent.clear(schedule);
    await userEvent.type(schedule, '*/15 * * * *{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(schedule).toHaveValue('*/15 * * * *');

    await userEvent.type(schedule, '{Enter}');
    await waitFor(() => expect(createCron).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'New scheduled request' })).toHaveFocus();
  });
});

const APP_ID = '0123456789abcdef0123456789abcdef';
const httpCron = {
  id: 'cron-http',
  app_id: APP_ID,
  kind: 'http',
  schedule: '0 9 * * *',
  path: '/report',
  timezone: 'America/New_York',
  skip_if_running: true,
  enabled: true,
};
const commandCron = {
  id: 'cron-cmd',
  app_id: APP_ID,
  kind: 'command',
  schedule: '0 2 * * *',
  command: ['bin/reindex', '--delta'],
  timezone: 'UTC',
  skip_if_running: false,
  retry_max: 1,
  retry_backoff_seconds: 30,
  enabled: true,
};

async function openEdit(row: Record<string, unknown>) {
  scheduled.rows = [row];
  render(<CronsPage />);
  await userEvent.click(
    screen.getByRole('button', { name: `Edit scheduled request ${String(row.schedule)}` })
  );
  return within(screen.getByRole('dialog', { name: 'Edit scheduled request' }));
}

describe('scheduled request editing', () => {
  it('opens a dialog prefilled from the cron, with nothing to save yet', async () => {
    const dialog = await openEdit(httpCron);
    expect(dialog.getByRole('textbox', { name: 'Schedule' })).toHaveValue('0 9 * * *');
    expect(dialog.getByRole('textbox', { name: 'Path' })).toHaveValue('/report');
    expect(dialog.getByRole('combobox', { name: 'Timezone' })).toHaveValue('America/New_York');
    expect(dialog.getByRole('combobox', { name: 'Overlap' })).toHaveValue('skip');
    expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('sends only the changed fields and says what changed', async () => {
    const dialog = await openEdit(httpCron);
    const path = dialog.getByRole('textbox', { name: 'Path' });
    await userEvent.clear(path);
    await userEvent.type(path, '/nightly');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateCron).toHaveBeenCalledWith({ id: 'cron-http', path: '/nightly' })
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        title: 'Scheduled request updated',
        description: 'Changed path.',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('changes schedule, timezone and overlap skipping together', async () => {
    const dialog = await openEdit(httpCron);
    const schedule = dialog.getByRole('textbox', { name: 'Schedule' });
    await userEvent.clear(schedule);
    await userEvent.type(schedule, '30 6 * * *');
    const zone = dialog.getByRole('combobox', { name: 'Timezone' });
    await userEvent.clear(zone);
    await userEvent.type(zone, 'Europe/Istanbul');
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Overlap' }), 'allow');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateCron).toHaveBeenCalledWith({
        id: 'cron-http',
        schedule: '30 6 * * *',
        timezone: 'Europe/Istanbul',
        schedule_policy: { version: 1, overlap: 'allow', missed_runs: 'skip' },
      })
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Changed schedule, timezone and overlap.' })
    );
  });

  it('shows the overlap from schedule_policy even when skip_if_running disagrees', async () => {
    const dialog = await openEdit({
      ...httpCron,
      skip_if_running: false,
      schedule_policy: { version: 1, overlap: 'replace', missed_runs: 'skip' },
    });
    expect(dialog.getByRole('combobox', { name: 'Overlap' })).toHaveValue('replace');
    expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('shows allow or skip from skip_if_running when the cron has no policy', async () => {
    const dialog = await openEdit({ ...httpCron, skip_if_running: false });
    expect(dialog.getByRole('combobox', { name: 'Overlap' })).toHaveValue('allow');
  });

  it('says replace waits for an HTTP request but stops a command task', async () => {
    const http = await openEdit(httpCron);
    await userEvent.selectOptions(http.getByRole('combobox', { name: 'Overlap' }), 'replace');
    expect(http.getByRole('combobox', { name: 'Overlap' })).toHaveAccessibleDescription(
      /waited for, not cancelled/
    );
    cleanup();
    const command = await openEdit(commandCron);
    await userEvent.selectOptions(command.getByRole('combobox', { name: 'Overlap' }), 'replace');
    const hint = command.getByRole('combobox', { name: 'Overlap' });
    expect(hint).toHaveAccessibleDescription(/asked to stop/);
    expect(hint).not.toHaveAccessibleDescription(/not cancelled/);
  });

  it('sends the full policy, carrying missed_runs and the start deadline', async () => {
    const dialog = await openEdit({
      ...httpCron,
      skip_if_running: false,
      schedule_policy: {
        version: 1,
        overlap: 'allow',
        missed_runs: 'coalesce_latest',
        start_deadline_seconds: 900,
      },
    });
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Overlap' }), 'replace');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(updateCron).toHaveBeenCalledWith({
        id: 'cron-http',
        schedule_policy: {
          version: 1,
          overlap: 'replace',
          missed_runs: 'coalesce_latest',
          start_deadline_seconds: 900,
        },
      })
    );
    expect(updateCron.mock.calls[0][0]).not.toHaveProperty('skip_if_running');
  });

  it('resets a cleared timezone to UTC', async () => {
    const dialog = await openEdit(httpCron);
    await userEvent.clear(dialog.getByRole('combobox', { name: 'Timezone' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(updateCron).toHaveBeenCalledWith({ id: 'cron-http', timezone: 'UTC' })
    );
  });

  it('keeps the dialog open and shows the API refusal inline', async () => {
    updateCron.mockRejectedValueOnce(new Error('Unknown timezone "Mars/Olympus".'));
    const dialog = await openEdit(httpCron);
    const zone = dialog.getByRole('combobox', { name: 'Timezone' });
    await userEvent.clear(zone);
    await userEvent.type(zone, 'Mars/Olympus');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent('Unknown timezone "Mars/Olympus".');
    expect(screen.getByRole('dialog', { name: 'Edit scheduled request' })).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
  });

  it('refuses a malformed schedule before calling the API', async () => {
    const dialog = await openEdit(httpCron);
    const schedule = dialog.getByRole('textbox', { name: 'Schedule' });
    await userEvent.clear(schedule);
    await userEvent.type(schedule, 'not a cron{Enter}');
    expect(schedule).toHaveAccessibleDescription('Enter a five-field cron schedule.');
    expect(schedule).toHaveFocus();
    expect(updateCron).not.toHaveBeenCalled();
  });

  it('edits retries for a command cron, which has no path', async () => {
    const dialog = await openEdit(commandCron);
    expect(dialog.queryByRole('textbox', { name: 'Path' })).not.toBeInTheDocument();
    expect(dialog.getByText('$ bin/reindex --delta')).toBeInTheDocument();
    const retries = dialog.getByRole('spinbutton', { name: 'Retries' });
    expect(retries).toHaveValue(1);
    await userEvent.clear(retries);
    await userEvent.type(retries, '3');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateCron).toHaveBeenCalledWith({ id: 'cron-cmd', retry_max: 3 }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Changed retries.' })
    );
  });

  it('rejects retries outside the 0 to 5 range', async () => {
    const dialog = await openEdit(commandCron);
    const retries = dialog.getByRole('spinbutton', { name: 'Retries' });
    await userEvent.clear(retries);
    await userEvent.type(retries, '9{Enter}');
    expect(retries).toHaveAccessibleDescription('Enter a whole number from 0 to 5.');
    expect(updateCron).not.toHaveBeenCalled();
  });

  it('offers no retry options for an HTTP cron', async () => {
    const dialog = await openEdit(httpCron);
    expect(dialog.queryByRole('spinbutton', { name: 'Retries' })).not.toBeInTheDocument();
  });

  it('discards a cancelled edit', async () => {
    const dialog = await openEdit(httpCron);
    await userEvent.type(dialog.getByRole('textbox', { name: 'Path' }), 'x');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(updateCron).not.toHaveBeenCalled();
  });
});

describe('scheduled request creation options', () => {
  it('no longer promises UTC only, and defaults the timezone to UTC', async () => {
    const dialog = await openCreation();
    expect(dialog.queryByText(/recurring UTC schedule/)).not.toBeInTheDocument();
    expect(dialog.getByRole('combobox', { name: 'Timezone' })).toHaveValue('UTC');
    expect(dialog.getByRole('combobox', { name: 'Overlap' })).toHaveValue('allow');
  });

  it('offers the shared IANA zone list as suggestions', async () => {
    await openCreation();
    const input = screen.getByRole('combobox', { name: 'Timezone' });
    const list = document.getElementById(input.getAttribute('list') ?? 'none');
    const zones = Array.from(list?.querySelectorAll('option') ?? []).map((o) => o.value);
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Europe/Istanbul');
  });

  it('sends a schedule policy for skip', async () => {
    createCron.mockReset().mockResolvedValue({ schedule: '0 9 * * *', path: '/' });
    const dialog = await openCreation();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Schedule' }), '0 9 * * *');
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Overlap' }), 'skip');
    await userEvent.click(dialog.getByRole('button', { name: 'Create scheduled request' }));
    await waitFor(() =>
      expect(createCron).toHaveBeenCalledWith({
        app_id: APP_ID,
        schedule: '0 9 * * *',
        path: '/',
        schedule_policy: { version: 1, overlap: 'skip', missed_runs: 'skip' },
      })
    );
  });

  it('sends no policy for the default allow overlap', async () => {
    createCron.mockReset().mockResolvedValue({ schedule: '0 9 * * *', path: '/' });
    const dialog = await openCreation();
    expect(dialog.getByRole('combobox', { name: 'Overlap' })).toHaveValue('allow');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Schedule' }), '0 9 * * *');
    await userEvent.click(dialog.getByRole('button', { name: 'Create scheduled request' }));
    await waitFor(() =>
      expect(createCron).toHaveBeenCalledWith({
        app_id: APP_ID,
        schedule: '0 9 * * *',
        path: '/',
      })
    );
  });

  it('sends the chosen timezone and overlap option', async () => {
    createCron.mockReset().mockResolvedValue({ schedule: '0 9 * * *', path: '/' });
    const dialog = await openCreation();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Schedule' }), '0 9 * * *');
    const zone = dialog.getByRole('combobox', { name: 'Timezone' });
    await userEvent.clear(zone);
    await userEvent.type(zone, 'Europe/Istanbul');
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Overlap' }), 'replace');
    await userEvent.click(dialog.getByRole('button', { name: 'Create scheduled request' }));
    await waitFor(() =>
      expect(createCron).toHaveBeenCalledWith({
        app_id: APP_ID,
        schedule: '0 9 * * *',
        path: '/',
        timezone: 'Europe/Istanbul',
        schedule_policy: { version: 1, overlap: 'replace', missed_runs: 'skip' },
      })
    );
  });

  it('resets the timezone choice when a draft is discarded', async () => {
    const dialog = await openCreation();
    await userEvent.clear(dialog.getByRole('combobox', { name: 'Timezone' }));
    await userEvent.type(dialog.getByRole('combobox', { name: 'Timezone' }), 'Asia/Tokyo');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'New scheduled request' }));
    expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveValue('UTC');
  });
});
