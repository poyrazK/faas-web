import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { DeadLetterEvent } from '@/lib/api/dead-letters';

const access = vi.hoisted(() => ({ value: 'on' as string }));
const ledger = vi.fn();
const inspect = vi.fn();
const replay = vi.fn();
const discard = vi.fn();
const replayAll = vi.fn();
const purge = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.value, refresh: vi.fn() }),
}));
vi.mock('@/lib/api/dead-letters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/dead-letters')>()),
  useDeadLetterLedger: (slug: string) => ledger(slug) as unknown,
  useDeadLetterEvent: (slug: string, id: string | null) => inspect(slug, id) as unknown,
  useReplayDeadLetterEvent: () => ({ mutateAsync: replay, isPending: false }),
  useDiscardDeadLetterEvent: () => ({ mutateAsync: discard, isPending: false }),
  useReplayAllDeadLetters: () => ({ mutateAsync: replayAll, isPending: false }),
  usePurgeDeadLetters: () => ({ mutateAsync: purge, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { DeadLetterLedger } = await import('./dead-letter-ledger');

const base = {
  source_id: 'b'.repeat(32),
  payload: { order_id: 7 },
  headers: { 'content-type': 'application/json' },
  error_kind: 'handler_error',
  error_detail: { status: 500 },
  retry_count: 5,
  first_failed_at: '2026-11-01T10:00:00Z',
  last_failed_at: '2026-11-01T11:00:00Z',
  replayed_at: null,
  created_at: '2026-11-01T11:00:00Z',
};
const waiting = { ...base, id: '1'.repeat(32), source: 'trigger_record', origin: 'kafka' };
const replayed = {
  ...base,
  id: '2'.repeat(32),
  source: 'invocation',
  origin: 'queue',
  replayed_at: '2026-11-02T09:00:00Z',
};
const routing = {
  ...base,
  id: '3'.repeat(32),
  source: 'event_route',
  error_kind: 'target_unavailable',
};
const events = [waiting, replayed, routing] as DeadLetterEvent[];

function page(list: DeadLetterEvent[], extra: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ app_slug: 'api', events: list }] },
    isPending: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...extra,
  };
}

beforeEach(() => {
  access.value = 'on';
  for (const fn of [ledger, inspect, replay, discard, replayAll, purge, confirm, toast])
    fn.mockReset();
  ledger.mockReturnValue(page(events));
  inspect.mockReturnValue({ data: waiting, isPending: false, error: null, refetch: vi.fn() });
  confirm.mockResolvedValue(true);
});

describe('DeadLetterLedger', () => {
  it.each(['off', 'plan-not-entitled', 'runtime-unavailable'])(
    'reads nothing while dead-letter-queues is %s',
    (state) => {
      access.value = state;
      render(<DeadLetterLedger slug="api" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(ledger).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /replay/i })).not.toBeInTheDocument();
    }
  );

  it('labels each entry with an icon and text, and offers replay only where it can work', () => {
    render(<DeadLetterLedger slug="api" />);
    expect(screen.getByText('Dead-lettered')).toBeInTheDocument();
    expect(screen.getByText('Replayed')).toBeInTheDocument();
    expect(screen.getByText('Not replayable')).toBeInTheDocument();
    expect(screen.getByText('Trigger record')).toBeInTheDocument();
    expect(screen.getByText('Event routing')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^replay$/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^discard$/i })).toHaveLength(3);
  });

  it('confirms a replay, says what it does, and sends nothing when cancelled', async () => {
    confirm.mockResolvedValueOnce(false);
    render(<DeadLetterLedger slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /^replay$/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/back to pending/i) })
    );
    expect(replay).not.toHaveBeenCalled();
    replay.mockResolvedValue({});
    await userEvent.click(screen.getByRole('button', { name: /^replay$/i }));
    await waitFor(() => expect(replay).toHaveBeenCalledWith({ id: waiting.id }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it.each([
    ['not_found', 'info', /already replayed/i],
    ['dead_letter_not_replayable', 'error', /nothing to replay/i],
    ['keyed_replay_expired', 'error', /deadline passed/i],
    ['event_delivery_capacity_exhausted', 'error', /capacity exhausted/i],
  ])('explains a replay refused with %s', async (code, kind, title) => {
    replay.mockRejectedValue(new ApiError({ status: 409, code, title: 'Refused' }));
    render(<DeadLetterLedger slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /^replay$/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind, title: expect.stringMatching(title) })
      )
    );
  });

  it('confirms a discard as destructive and irreversible', async () => {
    discard.mockResolvedValue(undefined);
    render(<DeadLetterLedger slug="api" />);
    await userEvent.click(screen.getAllByRole('button', { name: /^discard$/i })[0]);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/cannot be undone/i),
      })
    );
    await waitFor(() => expect(discard).toHaveBeenCalledWith({ id: waiting.id }));
  });

  it('inspects one entry with a fresh read of its payload and last error', async () => {
    render(<DeadLetterLedger slug="api" />);
    await userEvent.click(
      screen.getByRole('button', { name: `Inspect Trigger record ${waiting.id}` })
    );
    expect(inspect).toHaveBeenLastCalledWith('api', waiting.id);
    expect(screen.getByText('Payload')).toBeInTheDocument();
    expect(screen.getByText(/"order_id": 7/)).toBeInTheDocument();
    expect(screen.getByText('Last error')).toBeInTheDocument();
  });

  it('replays all after confirmation and reports the count', async () => {
    replayAll.mockResolvedValue({ app_slug: 'api', replayed: 1 });
    render(<DeadLetterLedger slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /replay all/i }));
    await waitFor(() => expect(replayAll).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '1 entry replayed' }));
  });

  it('makes discarding the ledger type the app slug first', async () => {
    purge.mockResolvedValue({ app_slug: 'api', purged: 3 });
    render(<DeadLetterLedger slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /discard all/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, typeToConfirm: 'api' })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '3 entries discarded' }))
    );
  });

  it('hides replay all when nothing is waiting', () => {
    ledger.mockReturnValue(page([replayed, routing] as DeadLetterEvent[]));
    render(<DeadLetterLedger slug="api" />);
    expect(screen.queryByRole('button', { name: /replay all/i })).not.toBeInTheDocument();
  });

  it('keeps loading, empty, error and unreachable apart', () => {
    ledger.mockReturnValue(page([], { data: undefined, isPending: true }));
    const first = render(<DeadLetterLedger slug="api" />);
    expect(screen.getByText(/reading the dead-letter ledger/i)).toBeInTheDocument();
    first.unmount();
    ledger.mockReturnValue(page([]));
    const second = render(<DeadLetterLedger slug="api" />);
    expect(screen.getByText(/nothing has been dead-lettered/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discard all/i })).not.toBeInTheDocument();
    second.unmount();
    ledger.mockReturnValue(
      page([], {
        data: undefined,
        error: new ApiError({ status: 500, code: 'internal', title: 'Boom' }),
      })
    );
    render(<DeadLetterLedger slug="api" />);
    expect(screen.queryByText(/nothing has been dead-lettered/i)).not.toBeInTheDocument();
  });

  it('pages older entries with the cursor', async () => {
    const fetchNextPage = vi.fn();
    ledger.mockReturnValue(page(events, { hasNextPage: true, fetchNextPage }));
    render(<DeadLetterLedger slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /load older entries/i }));
    expect(fetchNextPage).toHaveBeenCalled();
  });
});
