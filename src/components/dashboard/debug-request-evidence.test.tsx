import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useDebugRequestEvidence = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useDebugRequestEvidence: (slug: string, id: string) =>
    useDebugRequestEvidence(slug, id) as unknown,
  useDeployment: () => ({
    data: { id: 'dep12345678', build_id: 'build-1' },
    error: null,
    isPending: false,
  }),
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

  it('groups observed facts, explanation, and supported investigation links', () => {
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    for (const name of ['What happened', 'Why', 'What to inspect next'])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getByText('req1')).toBeInTheDocument();
    expect(screen.getByText('trace1')).toBeInTheDocument();
    expect(screen.getByText('2026-09-08T09:00:00Z')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open release' })).toHaveAttribute(
      'href',
      '/dashboard/deployments?deployment=dep12345678'
    );
    expect(screen.getByRole('link', { name: 'Open build' })).toHaveAttribute(
      'href',
      '/dashboard/deployments?view=builds&build=build-1'
    );
    expect(screen.getByRole('link', { name: 'App logs' })).toHaveAttribute(
      'href',
      '/dashboard/logs?app=api'
    );
    expect(screen.getByText(/Wake and instance IDs were not returned/)).toBeInTheDocument();
  });

  it('renders relative span durations without inventing start offsets or blame', () => {
    const result = useDebugRequestEvidence();
    result.data.explanation.primary_span = null;
    result.data.spans = [
      span(),
      span({ span_id: 's2', parent_span_id: 's1', name: 'child', duration_nanos: 1_090_000_000 }),
    ];
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(
      screen.getByRole('img', { name: 'postgres.query: 2180 ms relative duration' })
    ).toHaveStyle({ width: '100%' });
    expect(screen.getByRole('img', { name: 'child: 1090 ms relative duration' })).toHaveStyle({
      width: '50%',
    });
    expect(screen.getByText(/Start offsets and overlap are not returned/)).toBeInTheDocument();
    expect(screen.getByText('Parent span: s1')).toBeInTheDocument();
    expect(screen.queryByText('blamed')).not.toBeInTheDocument();
  });

  it('copies a bounded allowlist and excludes raw payload, headers, SQL, and free-form explanation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const result = useDebugRequestEvidence();
    result.data.request.headers = { authorization: 'TOP_SECRET' };
    result.data.request.body = 'PRIVATE_BODY';
    result.data.explanation.headline = 'FREE_FORM_SECRET';
    result.data.spans = Array.from({ length: 300 }, (_, i) =>
      span({
        span_id: `s${i}`,
        db_statement: 'PRIVATE_SQL',
        name: 'PRIVATE_SPAN_NAME',
        raw_payload: 'PRIVATE_RAW',
      })
    );
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy safe support bundle' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain('req1');
    expect(copied).toContain('dep12345678');
    expect(copied).toContain('regression_detected');
    expect(copied).not.toMatch(
      /TOP_SECRET|PRIVATE_|FREE_FORM_SECRET|authorization|headers|db_statement|raw_payload/
    );
    expect(JSON.parse(copied).spans).toHaveLength(100);
    expect(JSON.parse(copied).spans_truncated).toBe(true);
    expect(screen.getByText('Support bundle copied')).toBeInTheDocument();
  });

  it('offers status-based suggestions and surfaces clipboard failure', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
    });
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByText(/Suggested check:.*5xx.*app logs/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy safe support bundle' }));
    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
  });

  it('explains absent spans and context with no unsupported diagnosis', () => {
    const result = useDebugRequestEvidence();
    result.data = {
      ...result.data,
      request: { ...request, status: 200, trace_id: null },
      spans: [],
      regression: null,
      explanation: { status: 'unobserved', headline: '' },
    };
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByText(/No deterministic explanation is available/)).toBeInTheDocument();
    expect(screen.getByText(/No spans were recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/Suggested check:.*5xx/i)).not.toBeInTheDocument();
  });

  it('keeps evidence errors retryable and calls out truncation', () => {
    const retry = vi.fn();
    useDebugRequestEvidence.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new Error('Evidence unavailable'),
      refetch: retry,
    });
    const view = render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry evidence' }));
    expect(retry).toHaveBeenCalledOnce();
    useDebugRequestEvidence.mockReturnValue({
      data: {
        request,
        spans: [],
        spans_truncated: true,
        explanation: { status: 'unobserved', headline: '' },
      },
      isPending: false,
      error: null,
    });
    view.rerender(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByText(/span list was cut/)).toBeInTheDocument();
  });
});
