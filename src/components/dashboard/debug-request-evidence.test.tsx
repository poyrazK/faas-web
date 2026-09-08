import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useDebugRequestEvidence = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useDebugRequestEvidence: (slug: string, id: string) =>
    useDebugRequestEvidence(slug, id) as unknown,
}));

const { DebugRequestEvidence } = await import('./debug-request-evidence');

const request = {
  id: 'req1',
  deployment_id: 'dep12345678',
  route: '/orders/{id}',
  method: 'GET',
  status: 500,
  latency_ms: 2400,
  count: 1,
  cold_boot: false,
  trace_id: 'trace1',
  received_at: '2026-09-08T09:00:00Z',
};
const span = (over: Record<string, unknown> = {}) => ({
  trace_id: 'trace1',
  span_id: 's1',
  name: 'postgres.query',
  kind: 'client',
  duration_nanos: 2_180_000_000,
  status: 'OK',
  ...over,
});

beforeEach(() => {
  useDebugRequestEvidence.mockReset().mockReturnValue({
    data: {
      request,
      regression: {
        deployment_id: 'dep12345678',
        route: '/orders/{id}',
        p95_ms: 1840,
        p95_base_ms: 260,
        affected_count: 412,
        regression_factor: '7.08',
        first_detected_at: '2026-09-08T08:00:00Z',
        last_detected_at: '2026-09-08T09:00:00Z',
      },
      spans: [span(), span({ span_id: 's2', name: 'redis.get', duration_nanos: 3_400_000 })],
      spans_truncated: false,
      explanation: {
        status: 'regression_detected',
        headline: 'A database query on this route takes 7× longer than before.',
        primary_span: span(),
      },
      generated_at: '2026-09-08T09:05:00Z',
    },
    isPending: false,
    error: null,
  });
});

describe('DebugRequestEvidence', () => {
  it('leads with the platform’s own explanation and marks the span it blames', () => {
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByText(/takes 7× longer than before/)).toBeInTheDocument();
    expect(screen.getByText('regression')).toBeInTheDocument();
    expect(screen.getByText('blamed')).toBeInTheDocument();
    expect(screen.getByText('2180 ms')).toBeInTheDocument();
  });

  it('states the matched regression against its baseline', () => {
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByText(/baseline of 260 ms/)).toBeInTheDocument();
    expect(screen.getByText(/412 requests/)).toBeInTheDocument();
  });

  it('says telemetry is gone rather than reporting a failure on 404', () => {
    useDebugRequestEvidence.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 404, code: 'not_found', title: 'Not found' }),
    });
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByText(/no telemetry is kept/i)).toBeInTheDocument();
  });

  it('stays closed with no request selected', () => {
    render(<DebugRequestEvidence slug="api" reqId={null} onClose={vi.fn()} />);
    expect(screen.queryByText(/request evidence/i)).not.toBeInTheDocument();
  });
});
