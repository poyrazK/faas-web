import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const replay = vi.fn();
const useDeadLetter = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useDeadLetter: (slug: string) => useDeadLetter(slug) as unknown,
  useReplayDeadLetter: () => ({ mutateAsync: replay, isPending: false, variables: undefined }),
}));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { DeadLetterPanel } = await import('./dead-letter-panel');

function rows(messages: unknown[]) {
  return { data: { messages }, isPending: false, error: null, refetch: vi.fn() };
}

const MSG = {
  id: 'a'.repeat(32),
  created_at: '2026-09-06T10:00:00Z',
  attempts: 3,
  failed_at: '2026-09-06T11:00:00Z',
};

beforeEach(() => {
  replay.mockReset();
  toast.mockReset();
  useDeadLetter.mockReturnValue(rows([MSG]));
});

describe('DeadLetterPanel', () => {
  it('offers a replay action per dead-lettered row', () => {
    render(<DeadLetterPanel slug="api" />);
    expect(screen.getByRole('button', { name: /replay/i })).toBeInTheDocument();
  });

  it('replays the row it was pressed on', async () => {
    replay.mockResolvedValue({});
    render(<DeadLetterPanel slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /replay/i }));
    await waitFor(() => expect(replay).toHaveBeenCalledWith(MSG.id));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('treats a 404 as already replayed, not as a failure', async () => {
    // The contract: a second replay finds the row already pending and 404s.
    replay.mockRejectedValue(
      new ApiError({ status: 404, code: 'not_found', title: 'No such row' })
    );
    render(<DeadLetterPanel slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /replay/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'info' }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
  });

  it('reports a real failure as an error', async () => {
    replay.mockRejectedValue(new ApiError({ status: 500, code: 'internal', title: 'Boom' }));
    render(<DeadLetterPanel slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /replay/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
  });

  it('says so when nothing has been dead-lettered', () => {
    useDeadLetter.mockReturnValue(rows([]));
    render(<DeadLetterPanel slug="api" />);
    expect(screen.getByText(/nothing has been dead-lettered/i)).toBeInTheDocument();
  });
});
