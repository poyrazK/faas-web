import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useTriggerDeadLetter = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useTriggerDeadLetter: (id: string, reason: string) => useTriggerDeadLetter(id, reason) as unknown,
}));

const { TriggerDeadLetter } = await import('./trigger-dlq');

function row(over: Record<string, unknown> = {}) {
  return {
    record_id: 'r1',
    trigger_id: 't1',
    reason: 'max_attempts',
    routed_to: 'manual_retry',
    detail: { attempts: 5, last_status: 500 },
    created_at: '2026-09-06T10:00:00Z',
    ...over,
  };
}
const ok = (records: unknown[]) => ({ data: { records }, isPending: false, error: null });

beforeEach(() => {
  useTriggerDeadLetter.mockReset();
  useTriggerDeadLetter.mockReturnValue(ok([row()]));
});

describe('TriggerDeadLetter', () => {
  it('says why the record was dead-lettered', () => {
    render(<TriggerDeadLetter triggerId="t1" />);
    // Scoped to the row: the reason filter carries the same words as options.
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('max_attempts')).toBeInTheDocument();
  });

  it('says where it went, which decides whether anything can still act on it', () => {
    render(<TriggerDeadLetter triggerId="t1" />);
    expect(within(screen.getByRole('listitem')).getByText(/manual_retry/)).toBeInTheDocument();
  });

  it('filters by reason through the query', async () => {
    render(<TriggerDeadLetter triggerId="t1" />);
    expect(useTriggerDeadLetter).toHaveBeenLastCalledWith('t1', '');
    await userEvent.selectOptions(screen.getByLabelText(/reason/i), 'poison_record');
    expect(useTriggerDeadLetter).toHaveBeenLastCalledWith('t1', 'poison_record');
  });

  it('shows the per-reason detail, whose shape differs by reason', async () => {
    render(<TriggerDeadLetter triggerId="t1" />);
    await userEvent.click(screen.getByRole('button', { name: /r1/i }));
    expect(screen.getByText(/"last_status": 500/)).toBeInTheDocument();
  });

  it('says so when nothing has been dead-lettered', () => {
    useTriggerDeadLetter.mockReturnValue(ok([]));
    render(<TriggerDeadLetter triggerId="t1" />);
    expect(screen.getByText(/nothing has been dead-lettered/i)).toBeInTheDocument();
  });
});
