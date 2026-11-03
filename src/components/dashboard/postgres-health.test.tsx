import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const access = vi.hoisted(() => ({ conditions: 'on' }));
const usePostgresStatus = vi.fn();
const usePostgresConnectionBudget = vi.fn();

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.conditions, refresh: vi.fn() }),
  useCapabilityStage: () => 'Preview',
}));
vi.mock('@/lib/api/postgres', () => ({
  usePostgresStatus: (id: string, enabled: boolean) => usePostgresStatus(id, enabled) as unknown,
  usePostgresConnectionBudget: (id: string) => usePostgresConnectionBudget(id) as unknown,
}));

const { ConnectionBudget, DatabaseConditions } = await import('./postgres-health');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const status = {
  kind: 'database',
  name: 'orders',
  observed_at: '2026-11-03T08:00:00Z',
  conditions: [
    {
      type: 'Ready',
      status: 'True',
      reason: 'suspended',
      message: 'Compute scaled to zero; the next connection wakes it.',
    },
    {
      type: 'Progressing',
      status: 'False',
      reason: 'complete',
      message: 'Nothing is in progress.',
    },
    {
      type: 'Degraded',
      status: 'Unknown',
      reason: 'not_assessed',
      message: 'No health observation is available.',
    },
  ],
};
const budget = (over: Record<string, unknown> = {}) => ({
  version: 1,
  database_id: 'db1',
  database_name: 'orders',
  state: 'unknown',
  checked_at: '2026-11-03T08:00:00Z',
  expires_at: '2026-11-03T08:05:00Z',
  enforced: false,
  model: 'canonical_runtime_pools',
  inventory: {
    bindings: 2,
    data_api_consumers: 0,
    auth_consumers: 0,
    migration_bindings: 0,
    other_bindings: 2,
    resident_instances: 1,
    parked_instances: 3,
    auxiliary_instances: 0,
    active_tasks: 0,
    rotation_pending: 0,
    overlap_consumers: 0,
    stale_node_instances: 0,
  },
  demand: {
    data_api_resident_estimate: 0,
    data_api_wake_estimate: 0,
    auth_wake_estimate: 0,
    control_headroom: 2,
    migration_headroom: 0,
    modeled_peak_connections: 2,
  },
  capacity: { state: 'unknown' },
  reasons: ['capacity_unverified', 'client_pool_sizes_unknown'],
  ...over,
});
const database = { id: 'db1', name: 'orders' } as never;

beforeEach(() => {
  access.conditions = 'on';
  usePostgresStatus.mockReset().mockReturnValue(ready(status));
  usePostgresConnectionBudget.mockReset().mockReturnValue(ready(budget()));
});

describe('DatabaseConditions', () => {
  it('lists each condition with its state in words, its reason and its message', () => {
    render(<DatabaseConditions database={database} />);
    const section = screen.getByRole('region', { name: 'Conditions' });
    expect(within(section).getByText('Preview')).toBeInTheDocument();
    expect(within(section).getByText('Ready: True')).toBeInTheDocument();
    expect(within(section).getByText('suspended')).toBeInTheDocument();
    expect(within(section).getByText(/next connection wakes it/)).toBeInTheDocument();
    expect(within(section).getByText('Degraded: Unknown')).toBeInTheDocument();
  });

  it('is neither shown nor read while the capability is off', () => {
    access.conditions = 'off';
    const { container } = render(<DatabaseConditions database={database} />);
    expect(container).toBeEmptyDOMElement();
    expect(usePostgresStatus).toHaveBeenLastCalledWith('db1', false);
  });

  it('says when it could not read them', () => {
    usePostgresStatus.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        status: 503,
        code: 'managed_postgres_unavailable',
        title: 't',
        detail: 'Provider down',
      }),
      refetch: vi.fn(),
    });
    render(<DatabaseConditions database={database} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Provider down');
  });
});

describe('ConnectionBudget', () => {
  it('says the budget is unknown and why, rather than implying it fits', () => {
    render(<ConnectionBudget database={database} />);
    const section = screen.getByRole('region', { name: 'Connection planning' });
    expect(within(section).getByText('Unknown')).toBeInTheDocument();
    expect(within(section).getByText(/2 connections at modeled peak/)).toBeInTheDocument();
    expect(within(section).getByText(/usable capacity unknown/i)).toBeInTheDocument();
    expect(within(section).getByText('capacity_unverified')).toBeInTheDocument();
    expect(within(section).getByText(/verified connection capacity/i)).toBeInTheDocument();
    expect(within(section).getByText(/does not wake the database/i)).toBeInTheDocument();
  });

  it('marks a database over its budget', () => {
    usePostgresConnectionBudget.mockReturnValue(
      ready(
        budget({
          state: 'over_budget',
          capacity: { state: 'verified', usable_connections: 1 },
          reasons: [],
        })
      )
    );
    render(<ConnectionBudget database={database} />);
    expect(screen.getByText('Over budget')).toBeInTheDocument();
    expect(screen.getByText(/1 usable/)).toBeInTheDocument();
  });

  it('keeps loading apart from a failed read', () => {
    usePostgresConnectionBudget.mockReturnValue({ data: undefined, isPending: true, error: null });
    render(<ConnectionBudget database={database} />);
    expect(screen.getByText(/reading connection planning/i)).toBeInTheDocument();
  });
});
