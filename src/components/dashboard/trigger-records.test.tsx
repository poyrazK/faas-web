import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useTriggerRecords = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useTriggerRecords: (id: string, state: string) => useTriggerRecords(id, state) as unknown,
}));

// The actions have their own suite; here they are a boundary, so this keeps
// these tests about the list and out of toast/confirm provider setup.
vi.mock('./trigger-record-actions', () => ({
  TriggerRecordActions: ({ recordId, retryable }: { recordId: string; retryable?: boolean }) => (
    <div data-testid="actions" data-record={recordId} data-retryable={String(retryable ?? true)} />
  ),
}));

const { TriggerRecords } = await import('./trigger-records');

function record(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    trigger_id: 't1',
    item_identifier: 'orders.v1@4213',
    payload: '{"order":7}',
    headers: '{}',
    metadata: '{"delivery_count":2}',
    state: 'retry',
    attempts: 2,
    next_fire_at: '2026-09-06T10:05:00Z',
    received_at: '2026-09-06T10:00:00Z',
    last_error: 'handler returned 500',
    ...over,
  };
}
const ok = (records: unknown[]) => ({ data: { records }, isPending: false, error: null });

beforeEach(() => {
  useTriggerRecords.mockReset();
  useTriggerRecords.mockReturnValue(ok([record()]));
});

describe('TriggerRecords', () => {
  it('identifies a record by its broker identifier', () => {
    render(<TriggerRecords triggerId="t1" />);
    expect(screen.getByText('orders.v1@4213')).toBeInTheDocument();
  });

  it('leads with why a record failed', () => {
    render(<TriggerRecords triggerId="t1" />);
    expect(screen.getByText(/handler returned 500/)).toBeInTheDocument();
  });

  it('filters by state through the query, not in the client', async () => {
    render(<TriggerRecords triggerId="t1" />);
    expect(useTriggerRecords).toHaveBeenLastCalledWith('t1', '');
    await userEvent.selectOptions(screen.getByLabelText(/state/i), 'dead_letter');
    expect(useTriggerRecords).toHaveBeenLastCalledWith('t1', 'dead_letter');
  });

  it('says so when the trigger has received nothing', () => {
    useTriggerRecords.mockReturnValue(ok([]));
    render(<TriggerRecords triggerId="t1" />);
    expect(screen.getByText(/no records/i)).toBeInTheDocument();
  });

  it('shows the payload as formatted json rather than a raw string', async () => {
    render(<TriggerRecords triggerId="t1" />);
    await userEvent.click(screen.getByRole('button', { name: /orders.v1@4213/i }));
    expect(screen.getByText(/"order": 7/)).toBeInTheDocument();
  });

  it('offers a retry only from the states the API accepts', () => {
    useTriggerRecords.mockReturnValue(
      ok([record({ id: 'a', state: 'succeeded' }), record({ id: 'b', state: 'dead_letter' })])
    );
    render(<TriggerRecords triggerId="t1" />);
    const actions = screen.getAllByTestId('actions');
    expect(actions.map((el) => el.dataset.retryable)).toEqual(['false', 'true']);
  });
});
