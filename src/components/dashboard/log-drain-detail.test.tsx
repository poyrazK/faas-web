import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogDrain } from '@/lib/api/log-drains';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const state = vi.hoisted(() => ({
  health: {} as Record<string, unknown>,
  buckets: [] as unknown[],
}));
vi.mock('@/lib/api/log-drains', () => ({
  useUpdateLogDrain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteLogDrain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLogDrainHealth: () => ({ data: state.health, isPending: false, error: null }),
  useLogDrainAnalytics: () => ({
    data: {
      buckets: state.buckets,
      summary: { success_rate: 1, average_latency_ms: 90, retries: 0, dead_letters: 0 },
    },
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/lib/api/log-drain-capabilities', () => ({
  useLogDrainKinds: () => ['http_json', 'otlp', 'datadog'],
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/dither-kit', () => ({
  Area: () => null,
  AreaChart: () => <div data-testid="chart" />,
  Grid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const { LogDrainDetail } = await import('./log-drain-detail');

const drain: LogDrain = {
  id: 'ld-1',
  app_id: 'app-1',
  account_id: 'acct',
  kind: 'datadog',
  target_url: 'https://http-intake.logs.datadoghq.eu/api/v2/logs',
  auth_header_masked: '***',
  enabled: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  state.buckets = [];
  state.health = {
    log_drain_id: 'ld-1',
    status: 'degraded',
    active: true,
    queue_depth: 7,
    queue_capacity: 10000,
    pending_records: 7,
    pending_bytes: 2048,
    pending_bytes_capacity: 8388608,
    dead_letter_total: 2,
    oldest_pending_at: ago(4 * 60_000),
    delivered_total: 1200,
    failed_total: 4,
    dropped_total: 0,
    retries_total: 31,
    stream_reconnects_total: 1,
    gaps_total: 0,
    last_success_at: ago(30_000),
    last_failure_at: ago(2 * 3600_000),
    last_error: 'endpoint returned an unsuccessful HTTP status',
    updated_at: ago(10_000),
  };
});

describe('LogDrainDetail', () => {
  it('names a Datadog drain by its site', () => {
    render(<LogDrainDetail slug="api" drain={drain} onClose={vi.fn()} />);
    expect(screen.getByText('Datadog · eu1')).toBeInTheDocument();
  });

  it('shows when delivery last worked and failed, and how far behind it is', () => {
    render(<LogDrainDetail slug="api" drain={drain} onClose={vi.fn()} />);
    const facts = screen.getByRole('list', { name: 'Delivery health' });
    expect(within(facts).getByText('Last delivered').nextSibling).toHaveTextContent(/ago|now/);
    expect(within(facts).getByText('Last failed').nextSibling).toHaveTextContent(/2h/);
    expect(within(facts).getByText('Oldest undelivered line').nextSibling).toHaveTextContent(/4m/);
    expect(within(facts).getByText('Retries')).toBeInTheDocument();
    expect(within(facts).getByText('31')).toBeInTheDocument();
    expect(within(facts).getByText('Dead-lettered')).toBeInTheDocument();
  });

  it('says nothing is waiting when the queue is empty, instead of a blank lag', () => {
    state.health = { ...state.health, oldest_pending_at: undefined, last_failure_at: undefined };
    render(<LogDrainDetail slug="api" drain={drain} onClose={vi.fn()} />);
    const facts = screen.getByRole('list', { name: 'Delivery health' });
    expect(within(facts).getByText('Oldest undelivered line').nextSibling).toHaveTextContent(
      'Nothing waiting'
    );
    expect(within(facts).getByText('Last failed').nextSibling).toHaveTextContent('Never');
  });

  it('does not pass the fallback stamp of a drain with no report yet off as a report', () => {
    state.health = { ...state.health, status: 'unknown' };
    render(<LogDrainDetail slug="api" drain={drain} onClose={vi.fn()} />);
    expect(screen.getByText(/No delivery report yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Reported by the log pipeline/)).not.toBeInTheDocument();
  });

  it('opens the edit dialog for this destination', async () => {
    render(<LogDrainDetail slug="api" drain={drain} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit log destination' });
    expect(within(dialog).getByLabelText('Datadog site')).toHaveValue('eu1');
  });
});
