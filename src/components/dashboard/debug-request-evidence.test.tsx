import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// The replay control has its own tests (debug-replay.test.tsx); here it only has to be offered.
vi.mock('./debug-replay', () => ({
  DebugReplayAction: ({ reqId }: { reqId: string }) => <p>Replay offered for {reqId}</p>,
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
      timeline: [],
      correlation: { stages: [], complete: false },
      dependency_latency: [],
      dependency_latency_truncated: false,
      logs: [],
      logs_truncated: false,
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
  it('places spans by their recorded start and end times when the API kept them', () => {
    const result = useDebugRequestEvidence();
    result.data.spans = [
      span({ start_time: '2026-09-08T09:00:00.000Z', end_time: '2026-09-08T09:00:02.000Z' }),
      span({
        span_id: 's2',
        name: 'redis.get',
        duration_nanos: 500_000_000,
        start_time: '2026-09-08T09:00:01.000Z',
        end_time: '2026-09-08T09:00:01.500Z',
      }),
    ];
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(
      screen.getByRole('img', { name: 'redis.get: starts at 1000 ms, lasts 500 ms' })
    ).toHaveStyle({ left: '50%', width: '25%' });
    expect(screen.getByText(/recorded start and end time/)).toBeInTheDocument();
  });

  it('shows the timeline, correlation, critical path, dependencies, logs and findings as returned', () => {
    const result = useDebugRequestEvidence();
    Object.assign(result.data, {
      request: {
        ...request,
        request_id: 'pub-req-1',
        instance_id: 'inst-1',
        guest: {
          runtime: 'node22',
          duration_ms: 2300,
          outcome: 'handler_error',
          error_class: 'handler_exec',
        },
      },
      timeline: [
        {
          at: '2026-09-08T09:00:00Z',
          phase: 'wake',
          kind: 'restore',
          summary: 'Restored from snapshot',
          duration_ms: 180,
        },
        {
          at: '2026-09-08T09:00:02Z',
          phase: 'error',
          kind: 'http_5xx',
          summary: 'Answered 500',
          status: 500,
          approximate: true,
        },
      ],
      correlation: {
        complete: false,
        stages: [
          { phase: 'edge', status: 'observed', duration_ms: 3 },
          { phase: 'billing', status: 'missing', reason: 'usage not yet rolled up' },
        ],
      },
      critical_path: {
        duration_ms: 2400,
        complete: true,
        span_count: 1,
        slowest_span_id: 's1',
        slowest_span_name: 'postgres.query',
        slowest_exclusive_ms: 2180,
        spans: [
          {
            span_id: 's1',
            name: 'postgres.query',
            kind: 'client',
            start_time: '2026-09-08T09:00:00Z',
            end_time: '2026-09-08T09:00:02.180Z',
            duration_ms: 2180,
            exclusive_ms: 2180,
          },
        ],
      },
      dependency_latency: [
        {
          type: 'managed_binding',
          kind: 'postgres',
          name: 'orders-db',
          calls: 3,
          errors: 1,
          total_duration_ms: 2190,
          max_duration_ms: 2180,
        },
      ],
      logs: [
        {
          occurred_at: '2026-09-08T09:00:01Z',
          source: 'runtime',
          level: 'error',
          message: 'query timed out',
        },
      ],
      logs_truncated: true,
      explanation: {
        ...result.data.explanation,
        diagnosis: 'dependency_regression',
        confidence: 'high',
        findings: [
          {
            code: 'db_slow',
            title: 'orders-db is 40× slower',
            detail: 'p95 rose from 40 ms to 1610 ms.',
            confidence: 'high',
          },
        ],
        recommendations: [{ action: 'inspect_query', detail: 'Check the orders query plan.' }],
      },
    });
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByText('pub-req-1')).toBeInTheDocument();
    expect(screen.getByText(/node22 · Handler error \(handler_exec\)/)).toBeInTheDocument();
    expect(screen.getByText('Dependency regression')).toBeInTheDocument();
    expect(screen.getByText(/orders-db is 40× slower/)).toBeInTheDocument();
    expect(screen.getByText('Check the orders query plan.')).toBeInTheDocument();
    const timeline = screen.getByRole('region', { name: 'Timeline' });
    expect(timeline).toHaveTextContent(/Restored from snapshot/);
    expect(timeline).toHaveTextContent(/approximate/);
    const correlation = screen.getByRole('region', { name: 'Edge to billing' });
    expect(correlation).toHaveTextContent(/unknown, not zero/);
    expect(correlation).toHaveTextContent('Missing');
    expect(correlation).toHaveTextContent('usage not yet rolled up');
    expect(screen.getByRole('region', { name: 'Critical path' })).toHaveTextContent(
      /2400 ms across 1 span/
    );
    expect(screen.getByRole('region', { name: 'Dependencies on this request' })).toHaveTextContent(
      'orders-db'
    );
    const logs = screen.getByRole('region', { name: 'Logs from this request' });
    expect(logs).toHaveTextContent('query timed out');
    expect(logs).toHaveTextContent(/last 20/);
    expect(screen.queryByText(/Wake and instance IDs were not returned/)).not.toBeInTheDocument();
  });

  it('says when only the request ID was kept', () => {
    const result = useDebugRequestEvidence();
    result.data.request = { ...request, evidence_status: 'request_id_only' } as typeof request;
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByText(/Only the request ID was kept/)).toBeInTheDocument();
  });

  it('leads with the platform’s own explanation and marks the span it blames', () => {
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByText(/takes 7× longer than before/)).toBeInTheDocument();
    expect(screen.getByText('regression')).toBeInTheDocument();
    expect(screen.getByText('blamed')).toBeInTheDocument();
    expect(screen.getByText('2180 ms')).toBeInTheDocument();
  });

  it('lets the request ID and trace ID be copied in full', () => {
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Copy: request ID req1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy: trace ID trace1' })).toBeInTheDocument();
  });

  it('offers no trace copy button when the request has no trace ID', () => {
    const current = useDebugRequestEvidence() as { data: object };
    useDebugRequestEvidence.mockReturnValue({
      ...current,
      data: { ...current.data, request: { ...request, trace_id: '' } },
    });
    render(<DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} />);
    expect(screen.getByText('Not reported', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Copy: trace ID/ })).not.toBeInTheDocument();
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
      '/dashboard/releases?deployment=dep12345678'
    );
    expect(screen.getByRole('link', { name: 'Open build' })).toHaveAttribute(
      'href',
      '/dashboard/releases?view=builds&build=build-1'
    );
    expect(screen.getByRole('link', { name: 'App logs' })).toHaveAttribute(
      'href',
      '/dashboard/logs?app=api'
    );
    expect(screen.getByText(/Wake and instance IDs were not returned/)).toBeInTheDocument();
    expect(screen.getByText('Replay offered for req1')).toBeInTheDocument();
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
    expect(screen.getByText(/do not show chronology/)).toBeInTheDocument();
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

  it('offers the wake a cold request admitted, and nothing for a warm one', async () => {
    const onOpenWake = vi.fn();
    const base = useDebugRequestEvidence('api', 'req1');
    useDebugRequestEvidence.mockReturnValue({
      ...base,
      data: { ...base.data, request: { ...base.data.request, cold_boot: true, wake_id: 'wk-7' } },
    });
    const { unmount } = render(
      <DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} onOpenWake={onOpenWake} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Woke the app · Open wake' }));
    expect(onOpenWake).toHaveBeenCalledWith('wk-7');
    unmount();

    useDebugRequestEvidence.mockReturnValue(base);
    render(
      <DebugRequestEvidence slug="api" reqId="req1" onClose={vi.fn()} onOpenWake={onOpenWake} />
    );
    expect(
      screen.queryByRole('button', { name: 'Woke the app · Open wake' })
    ).not.toBeInTheDocument();
  });
});
