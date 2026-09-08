import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useTrigger = vi.fn();
vi.mock('@/lib/api/queries', () => ({ useTrigger: (id: string) => useTrigger(id) as unknown }));

const { TriggerConfiguration } = await import('./trigger-detail');

// The field names are the schema's own: a trigger has filter_criteria,
// batch_size_max and max_attempts — not filter, batch_size or max_retries.
const trigger = (over: Record<string, unknown> = {}) => ({
  id: 'trg1',
  account_id: 'acct',
  app_id: 'app1',
  kind: 'queue',
  slug: 'orders-inbound',
  enabled: false,
  config: { broker: 'kafka', topic: 'orders', group_id: 'gregale' },
  batch_size_max: 10,
  batch_window_ms: 2000,
  max_attempts: 5,
  payload_max_bytes: 262144,
  broker_poison_strategy: 'commit',
  filter_criteria: { type: 'order.created' },
  source: 'queue',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-05T00:00:00Z',
  ...over,
});

beforeEach(() => {
  useTrigger.mockReset().mockReturnValue({ data: trigger(), isPending: false, error: null });
});

describe('TriggerConfiguration', () => {
  it('shows the fields that explain why nothing is arriving', () => {
    render(<TriggerConfiguration triggerId="trg1" />);
    expect(screen.getByText('paused')).toBeInTheDocument();
    expect(screen.getByText('orders-inbound')).toBeInTheDocument();
    expect(screen.getByText(/"type": "order\.created"/)).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2000 ms')).toBeInTheDocument();
  });

  it('renders the broker coordinates from config rather than inventing field names', () => {
    render(<TriggerConfiguration triggerId="trg1" />);
    expect(screen.getByText(/Source configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/"topic": "orders"/)).toBeInTheDocument();
  });

  it('says an unfiltered trigger takes everything, rather than showing nothing', () => {
    useTrigger.mockReturnValue({
      data: trigger({ filter_criteria: undefined }),
      isPending: false,
      error: null,
    });
    render(<TriggerConfiguration triggerId="trg1" />);
    expect(screen.getByText(/every record from the source is dispatched/i)).toBeInTheDocument();
  });

  it('reads trigger_not_found as the trigger being gone', () => {
    useTrigger.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 404, code: 'trigger_not_found', title: 'Gone' }),
    });
    render(<TriggerConfiguration triggerId="trg1" />);
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
  });
});
