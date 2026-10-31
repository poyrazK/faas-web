import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';

const toast = vi.fn();
const confirm = vi.fn();
vi.mock('@tanstack/react-router', () => ({ Link: () => null }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { ScheduledRequestsBody } = await import('./jobs-scheduled');

const APP = '0123456789abcdef0123456789abcdef';
const HTTP = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const COMMAND = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TASK = '11111111-2222-4333-8444-555555555555';
const DONE = '22222222-2222-4333-8444-555555555555';

const crons = [
  { id: HTTP, app_id: APP, kind: 'http', schedule: '*/15 * * * *', path: '/sync', enabled: true },
  {
    id: COMMAND,
    app_id: APP,
    kind: 'command',
    schedule: '0 2 * * *',
    command: ['bin/rebuild-index'],
    enabled: true,
  },
];
const runs: Record<string, unknown[]> = {
  [HTTP]: [{ id: 'inv-1', outcome: 'running', attempts: 1, started_at: '2026-10-30T02:00:00Z' }],
  [COMMAND]: [
    {
      id: TASK,
      task_id: TASK,
      outcome: 'running',
      attempts: 1,
      started_at: '2026-10-30T02:00:00Z',
    },
    {
      id: DONE,
      task_id: DONE,
      outcome: 'success',
      attempts: 1,
      started_at: '2026-10-29T02:00:00Z',
    },
  ],
};

beforeEach(() => {
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  spyApi('GET').mockImplementation(async (path, init) => {
    const id = (init as { params?: { path?: { id?: string } } } | undefined)?.params?.path?.id;
    const data: Record<string, unknown> = {
      '/v1/crons': crons,
      '/v1/apps': [{ id: APP, slug: 'api' }],
      '/v1/crons/{id}/runs': { runs: runs[id ?? ''] ?? [] },
      '/v1/crons/{id}/occurrences': {
        limit: 50,
        occurrences: [
          {
            id: '33333333-2222-4333-8444-555555555555',
            schedule_revision: 1,
            scheduled_for: '2026-10-30T02:00:00Z',
            schedule_policy: {},
            status: 'running',
            app_task_id: TASK,
            created_at: '2026-10-30T02:00:00Z',
          },
        ],
      },
    };
    if (!(path in data)) throw new Error(`Unexpected GET ${path}`);
    return { data: data[path], response: new Response() };
  });
});
afterEach(() => vi.restoreAllMocks());

function mount(schedule: string, onSelection = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ScheduledRequestsBody search={{ schedule }} onSelection={onSelection} />
    </QueryClientProvider>
  );
  return onSelection;
}

describe('cron history', () => {
  it('switches to occurrences and opens a run from one', async () => {
    const onSelection = mount(COMMAND);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('tab', { name: 'Occurrences' }));
    const list = await within(dialog).findByRole('list', { name: 'Recorded fire times' });
    await userEvent.click(within(list).getByRole('button', { name: `View run ${TASK}` }));
    expect(onSelection).toHaveBeenCalledWith({ execution: TASK });
    expect(within(dialog).getByRole('tab', { name: 'Runs' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('offers cancel on a running command run, by its task id', async () => {
    const post = spyApi('POST').mockResolvedValue({
      data: { id: TASK, status: 'cancelled' },
      response: new Response(null, { status: 202 }),
    });
    mount(COMMAND);
    const dialog = await screen.findByRole('dialog');
    const cancel = await within(dialog).findAllByRole('button', { name: 'Cancel run' });
    // The settled run has nothing to cancel.
    expect(cancel).toHaveLength(1);
    await userEvent.click(cancel[0]);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/crons/{id}/runs/{run_id}/cancel', {
        params: { path: { id: COMMAND, run_id: TASK } },
      })
    );
  });

  it('offers no cancel on an HTTP cron, whose runs are not app tasks', async () => {
    mount(HTTP);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Execution inv-1')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Cancel run' })).toBeNull();
  });
});
