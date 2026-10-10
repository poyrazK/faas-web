import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  statuses: {} as Record<string, Record<string, unknown>>,
  listError: false,
  capability: 'available',
  retry: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'account-1', plan: 'hobby' } }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ accountId: 'account-1', state: state.capability, refresh: vi.fn() }),
}));
vi.mock('@/lib/api/queue-bindings', () => ({
  useQueueBindings: () => ({
    data: state.rows,
    isPending: false,
    error: state.listError ? new Error('offline') : null,
    refetch: state.retry,
  }),
  useQueueBindingStatus: (_account: string, _slug: string, id: string) => ({
    data: state.statuses[id],
    isPending: false,
    error: null,
    refetch: state.retry,
  }),
}));
const { QueueConsumers } = await import('./queue-consumers');

beforeEach(() => {
  state.capability = 'available';
  state.listError = false;
  state.retry.mockClear();
  state.rows = [
    {
      id: 'push-1',
      name: 'orders',
      queue_name: 'orders',
      mode: 'push',
      workload_class: 'worker',
      enabled: true,
      max_concurrency: 2,
    },
    {
      id: 'pull-1',
      name: 'exports',
      queue_name: 'exports',
      mode: 'pull',
      workload_class: 'worker',
      enabled: true,
      max_concurrency: 1,
    },
  ];
  state.statuses = {
    'push-1': {
      binding_id: 'push-1',
      consumer_state: 'active',
      consumer_liveness: 'stale',
      last_poll_at: '2026-10-10T12:00:00Z',
      depth: 5,
      in_flight: 2,
      dead_letter: 1,
      generated_at: '2026-10-10T12:01:00Z',
    },
    'pull-1': {
      binding_id: 'pull-1',
      consumer_state: 'external',
      consumer_liveness: 'external',
      depth: 0,
      in_flight: 0,
      dead_letter: 0,
      generated_at: '2026-10-10T12:01:00Z',
    },
  };
});

it('keeps configured state separate from stale push liveness and external pull observation', () => {
  render(<QueueConsumers slug="worker-1" />);
  expect(screen.getByText(/orders · push worker/)).toBeInTheDocument();
  expect(screen.getByText(/Consumer state: active/)).toBeInTheDocument();
  expect(screen.getByText(/Scheduler liveness: stale/)).toBeInTheDocument();
  expect(screen.getByText(/Active configuration does not prove a healthy consumer/)).toBeVisible();
  expect(screen.getByText(/exports · pull worker/)).toBeInTheDocument();
  expect(screen.getByText(/External pull consumers are not observed/)).toBeVisible();
  expect(screen.getByText(/Depth 5 · In flight 2 · Dead letter 1/)).toBeVisible();
});

it('shows a paused consumer without claiming a live handler', () => {
  state.statuses['push-1'] = {
    ...state.statuses['push-1'],
    consumer_state: 'paused',
    consumer_liveness: 'not_observed',
  };
  render(<QueueConsumers slug="worker-1" />);
  expect(screen.getByText(/Consumer state: paused/)).toBeVisible();
  expect(screen.queryByText(/healthy consumer/)).not.toBeInTheDocument();
});

it('preserves a binding list failure and offers retry', () => {
  state.listError = true;
  render(<QueueConsumers slug="worker-1" />);
  expect(screen.getByRole('alert')).toHaveTextContent(/Could not read queue bindings/);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
});
