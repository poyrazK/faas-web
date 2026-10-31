import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { ApiError } from '@/lib/api/errors';

const toast = vi.fn();
const confirm = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { CronOccurrences, CancelCronRunButton } = await import('./cron-occurrences');

const CRON = '0123456789abcdef0123456789abcdef';
const TASK = '11111111-2222-4333-8444-555555555555';
const INVOCATION = '66666666-7777-4888-9999-aaaaaaaaaaaa';

const httpCron = {
  id: CRON,
  schedule: '*/15 * * * *',
  timezone: 'UTC',
  enabled: true,
  command: false,
  suspended: false,
};
const commandCron = { ...httpCron, command: true };

function occurrence(over: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    schedule_revision: 1,
    scheduled_for: '2026-10-30T02:00:00Z',
    schedule_policy: {},
    status: 'succeeded',
    created_at: '2026-10-30T02:00:00Z',
    ...over,
  };
}

let pages: Record<string, { occurrences: unknown[]; limit: number; next_before?: string }>;

function mount(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  pages = { '': { occurrences: [], limit: 50 } };
  spyApi('GET').mockImplementation(async (path, init) => {
    if (path !== '/v1/crons/{id}/occurrences') throw new Error(`Unexpected GET ${path}`);
    const before = (init as { params: { query: { before?: string } } }).params.query.before ?? '';
    return { data: pages[before], response: new Response() };
  });
});
afterEach(() => vi.restoreAllMocks());

describe('CronOccurrences', () => {
  it('lists each recorded fire time with its decision, reason and run', async () => {
    pages[''] = {
      limit: 50,
      occurrences: [
        occurrence({ status: 'succeeded', invocation_id: INVOCATION }),
        occurrence({
          status: 'skipped_overlap',
          reason: 'previous run still active',
          scheduled_for: '2026-10-30T01:45:00Z',
        }),
        occurrence({ status: 'missed_deadline', scheduled_for: '2026-10-30T01:30:00Z' }),
      ],
    };
    const onOpenRun = vi.fn();
    mount(<CronOccurrences cron={httpCron} onOpenRun={onOpenRun} />);
    const list = await screen.findByRole('list', { name: 'Recorded fire times' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Succeeded')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Skipped: still running')).toBeInTheDocument();
    expect(within(rows[1]).getByText('previous run still active')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Missed start deadline')).toBeInTheDocument();
    // Only an occurrence that produced a run links to one.
    expect(within(rows[1]).queryByRole('button', { name: /view run/i })).toBeNull();
    await userEvent.click(within(rows[0]).getByRole('button', { name: /view run/i }));
    expect(onOpenRun).toHaveBeenCalledWith(INVOCATION);
    // An HTTP cron has nothing to cancel.
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('pages older decisions with the cursor the server returned', async () => {
    pages[''] = { limit: 50, occurrences: [occurrence({})], next_before: 'cursor-1' };
    pages['cursor-1'] = {
      limit: 50,
      occurrences: [occurrence({ status: 'coalesced', scheduled_for: '2026-10-29T02:00:00Z' })],
    };
    mount(<CronOccurrences cron={httpCron} onOpenRun={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load older' }));
    expect(await screen.findByText('Coalesced')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });

  it('previews upcoming UTC times and says why there are none otherwise', async () => {
    const { unmount } = mount(<CronOccurrences cron={httpCron} onOpenRun={vi.fn()} />);
    const upcoming = await screen.findByRole('list', { name: 'Upcoming fire times' });
    expect(within(upcoming).getAllByRole('listitem')).toHaveLength(3);
    expect(upcoming.querySelectorAll('time[datetime]')).toHaveLength(3);
    unmount();

    for (const [cron, text] of [
      [{ ...httpCron, enabled: false }, /paused/i],
      [{ ...httpCron, suspended: true }, /suspended until the next successful deploy/i],
      [{ ...httpCron, timezone: 'Europe/Istanbul' }, /previewed for UTC schedules/i],
    ] as const) {
      const view = mount(<CronOccurrences cron={cron} onOpenRun={vi.fn()} />);
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Upcoming fire times' })).toBeNull();
      view.unmount();
    }
  });

  it('separates an empty history from a failed read', async () => {
    const view = mount(<CronOccurrences cron={httpCron} onOpenRun={vi.fn()} />);
    expect(await screen.findByText(/no fire times recorded yet/i)).toBeInTheDocument();
    view.unmount();

    spyApi('GET').mockRejectedValue(
      new ApiError({ status: 400, code: 'validation_failed', title: 'History unavailable' })
    );
    mount(<CronOccurrences cron={httpCron} onOpenRun={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable');
  });

  it('offers cancel on an active command occurrence, not on a settled one', async () => {
    pages[''] = {
      limit: 50,
      occurrences: [
        occurrence({ status: 'running', app_task_id: TASK }),
        occurrence({ status: 'succeeded', app_task_id: crypto.randomUUID() }),
      ],
    };
    mount(<CronOccurrences cron={commandCron} onOpenRun={vi.fn()} />);
    const rows = within(
      await screen.findByRole('list', { name: 'Recorded fire times' })
    ).getAllByRole('listitem');
    expect(within(rows[0]).getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button', { name: 'Cancel run' })).toBeNull();
  });
});

describe('CancelCronRunButton', () => {
  function post() {
    return spyApi('POST');
  }

  it('confirms, cancels the task, and reports a queued run as cancelled', async () => {
    const cancel = post().mockResolvedValue({
      data: { id: TASK, status: 'cancelled' },
      response: new Response(null, { status: 202 }),
    });
    mount(<CancelCronRunButton cronId={CRON} runId={TASK} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith('/v1/crons/{id}/runs/{run_id}/cancel', {
        params: { path: { id: CRON, run_id: TASK } },
      })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'Run cancelled' })
      )
    );
  });

  it('reports an active run as stopping, since its worker ends it', async () => {
    post().mockResolvedValue({
      data: { id: TASK, status: 'running', cancel_requested_at: '2026-10-30T02:00:05Z' },
      response: new Response(null, { status: 202 }),
    });
    mount(<CancelCronRunButton cronId={CRON} runId={TASK} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'Cancellation requested' })
      )
    );
  });

  it('sends nothing when the confirm is declined', async () => {
    confirm.mockResolvedValue(false);
    const cancel = post();
    mount(<CancelCronRunButton cronId={CRON} runId={TASK} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([
    ['not_implemented', 501, 'Command runs are off on this host'],
    ['not_found', 404, 'Run not found'],
    ['rate_limited', 429, 'Could not cancel'],
  ])('explains %s by its code', async (code, status, title) => {
    post().mockRejectedValue(new ApiError({ status, code, title: 'problem', detail: 'detail' }));
    mount(<CancelCronRunButton cronId={CRON} runId={TASK} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', title }))
    );
  });
});
