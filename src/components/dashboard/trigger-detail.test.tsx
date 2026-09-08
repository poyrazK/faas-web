import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useTrigger = vi.fn();
vi.mock('@/lib/api/queries', () => ({ useTrigger: (id: string) => useTrigger(id) as unknown }));

const { TriggerConfiguration } = await import('./trigger-detail');

beforeEach(() => {
  useTrigger.mockReset().mockReturnValue({
    data: {
      id: 'trg1',
      kind: 'queue',
      enabled: false,
      source: 'orders-inbound',
      target: 'api-gateway',
      filter: 'type = "order.created"',
      batch_size: 10,
      created_at: '2026-09-01T00:00:00Z',
    },
    isPending: false,
    error: null,
  });
});

describe('TriggerConfiguration', () => {
  it('shows the fields that explain why nothing is arriving', () => {
    render(<TriggerConfiguration triggerId="trg1" />);
    expect(screen.getByText('paused')).toBeInTheDocument();
    expect(screen.getByText('orders-inbound')).toBeInTheDocument();
    expect(screen.getByText('type = "order.created"')).toBeInTheDocument();
  });

  it('reads a 404 as the trigger being gone', () => {
    useTrigger.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 404, code: 'trigger_not_found', title: 'Not found' }),
    });
    render(<TriggerConfiguration triggerId="trg1" />);
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
  });
});
