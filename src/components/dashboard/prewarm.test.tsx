import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localInputToIso } from './prewarm';

const state = vi.hoisted(() => ({
  items: [] as unknown[],
  schedule: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('@/lib/api/prewarm', () => ({
  usePrewarms: () => ({ data: state.items, isPending: false, error: null, refetch: vi.fn() }),
  useSchedulePrewarm: () => ({ mutateAsync: state.schedule, isPending: false }),
  useCancelPrewarm: () => ({ mutateAsync: state.cancel, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { PrewarmPanel } = await import('./prewarm');

beforeEach(() => {
  state.items = [];
  state.schedule.mockReset().mockResolvedValue({});
  state.cancel.mockReset().mockResolvedValue(undefined);
  state.confirm.mockReset().mockResolvedValue(true);
});

describe('PrewarmPanel', () => {
  it('schedules a future window as instants', async () => {
    render(<PrewarmPanel slug="api" />);
    const count = screen.getByLabelText('Instances');
    await userEvent.clear(count);
    await userEvent.type(count, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule prewarm' }));
    await waitFor(() => expect(state.schedule).toHaveBeenCalled());
    const body = state.schedule.mock.calls[0][0];
    expect(body.count).toBe(3);
    expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.parse(body.wake_at));
    expect(body.wake_at).toMatch(/Z$/);
  });

  it('refuses a window that ends before it starts', async () => {
    render(<PrewarmPanel slug="api" />);
    const until = screen.getByLabelText('Until');
    await userEvent.clear(until);
    await userEvent.type(until, '2020-01-01T00:00');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule prewarm' }));
    expect(screen.getByText('The window must end after it starts.')).toBeInTheDocument();
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it('refuses a window that has already started', async () => {
    render(<PrewarmPanel slug="api" />);
    const from = screen.getByLabelText('From');
    await userEvent.clear(from);
    await userEvent.type(from, '2020-01-01T00:00');
    const until = screen.getByLabelText('Until');
    await userEvent.clear(until);
    await userEvent.type(until, '2020-01-01T02:00');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule prewarm' }));
    expect(screen.getByText('The window must start in the future.')).toBeInTheDocument();
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it('shows admitted against requested and cancels only pending windows', async () => {
    state.items = [
      {
        id: 'p1',
        app_id: 'a',
        count: 4,
        wake_at: '2026-10-20T09:00:00Z',
        expires_at: '2026-10-20T11:00:00Z',
        trigger: 'calendar',
        status: 'pending',
        created_at: '2026-10-15T00:00:00Z',
      },
      {
        id: 'p0',
        app_id: 'a',
        count: 4,
        admitted_count: 2,
        wake_at: '2026-10-10T09:00:00Z',
        expires_at: '2026-10-10T11:00:00Z',
        trigger: 'calendar',
        status: 'succeeded',
        created_at: '2026-10-09T00:00:00Z',
      },
    ];
    render(<PrewarmPanel slug="api" />);
    expect(screen.getByText('2 of 4 instances')).toBeInTheDocument();
    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    expect(cancels).toHaveLength(1);
    await userEvent.click(cancels[0]);
    await waitFor(() => expect(state.cancel).toHaveBeenCalledWith('p1'));
  });
});

describe('localInputToIso', () => {
  it('turns a local wall time into an instant and rejects nonsense', () => {
    expect(localInputToIso('2026-10-20T09:00')).toMatch(/^2026-10-20T\d\d:00:00.000Z$/);
    expect(localInputToIso('not a date')).toBeNull();
  });
});
