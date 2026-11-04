import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { DebugCoverage, DebugRunningView } from './debug-signals';
import { DebugStatusPanel } from './debug-status';
import { DebugDependencies } from './debug-dependencies';

const hooks = vi.hoisted(() => ({
  useDebugCoverage: vi.fn(),
  useDebugRunning: vi.fn(),
  useDebugStatus: vi.fn(),
  useDependencyLatency: vi.fn(),
}));
vi.mock('@/lib/api/debug', () => ({
  useDebugCoverage: hooks.useDebugCoverage,
  useDebugRunning: hooks.useDebugRunning,
  useDebugStatus: hooks.useDebugStatus,
}));
vi.mock('@/lib/api/queries', () => ({ useDependencyLatency: hooks.useDependencyLatency }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({
    access: 'on',
    capability: { key: 'production-debugger', maturity: 'preview' },
  }),
}));

const ok = <T,>(data: T) => ({
  data,
  isPending: false,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
});
const gated = {
  data: undefined,
  isPending: false,
  error: new ApiError({
    status: 402,
    code: 'plan_feature_gated',
    title: 'Upgrade',
    detail: "the free plan doesn't unlock debugger; upgrade to Hobby or higher.",
  }),
  refetch: vi.fn(),
};
const sig = (requests: number, rate: number) => ({ rows: requests, requests, rate_pct: rate });

beforeEach(() => vi.clearAllMocks());

describe('DebugCoverage', () => {
  it('shows each signal as a share of retained requests, not a capture rate', () => {
    hooks.useDebugCoverage.mockReturnValue(
      ok({
        app_id: 'a',
        since: '24h',
        window_start: '2026-11-02T12:00:00Z',
        window_end: '2026-11-03T12:00:00Z',
        plan_retention_days: 7,
        telemetry_rows: 300,
        represented_requests: 1200,
        error_requests: 12,
        trace_linked: sig(1100, 91.7),
        span_evidence: sig(480, 40),
        wake_evidence: sig(36, 3),
        guest_evidence: sig(0, 0),
      })
    );
    render(<DebugCoverage slug="api" since="24h" />);
    const row = screen.getByRole('row', { name: /Linked to a trace/ });
    expect(within(row).getByText('91.7%')).toBeInTheDocument();
    expect(screen.getByText(/not a capture rate/)).toBeInTheDocument();
    expect(screen.getByText(/1,200 requests in 300 retained/)).toBeInTheDocument();
  });

  it('explains the plan instead of failing on Free', () => {
    hooks.useDebugCoverage.mockReturnValue(gated);
    render(<DebugCoverage slug="api" since="24h" />);
    expect(screen.getByText(/doesn't unlock debugger/)).toBeInTheDocument();
  });

  it('says nothing was retained rather than drawing zeros', () => {
    hooks.useDebugCoverage.mockReturnValue(
      ok({ telemetry_rows: 0, represented_requests: 0 } as never)
    );
    render(<DebugCoverage slug="api" since="24h" />);
    expect(screen.getByText(/No request telemetry was retained/)).toBeInTheDocument();
  });
});

describe('DebugRunningView', () => {
  it('names each observed cause in words with its evidence', () => {
    hooks.useDebugRunning.mockReturnValue(
      ok({
        app_id: 'a',
        since: '24h',
        window_start: '2026-11-02T12:00:00Z',
        window_end: '2026-11-03T12:00:00Z',
        retention_clamped: false,
        current: [
          {
            code: 'request_activity',
            summary: 'Requests kept arriving within the idle timeout.',
            instance_count: 1,
            request: {
              telemetry_id: 't',
              deployment_id: 'd',
              route: '/health',
              method: 'GET',
              received_at: '2026-11-03T11:59:00Z',
              count: 3,
              match_delta_ms: 10,
            },
          },
        ],
        config: {
          configured_min_instances: 0,
          effective_min_instances: 0,
          idle_timeout_seconds: 300,
        },
        history: [],
        history_truncated: false,
      })
    );
    render(<DebugRunningView slug="api" since="24h" />);
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('Requests kept arriving within the idle timeout.')).toBeInTheDocument();
    expect(screen.getByText(/one of 3 collapsed requests/)).toBeInTheDocument();
    expect(screen.getByText(/no saving is estimated/)).toBeInTheDocument();
  });
});

describe('DebugStatusPanel', () => {
  const status = {
    verdict: 'failing',
    headline: '20 of 21 requests failed with a server error.',
    since: '1h',
    window_start: '2026-11-03T11:00:00Z',
    window_end: '2026-11-03T12:00:00Z',
    health: { requests: 1240, server_errors: 23, p95_ms: 182 },
    deployments: [{ id: 'dep-1', traffic_percent: 100, created_at: '2026-11-03T09:00:00Z' }],
    regressions: [],
    regressions_total: 0,
    recent_failures: [
      {
        id: 'req-1',
        route: '/checkout',
        method: 'GET',
        status: 500,
        cold_boot: false,
        received_at: '2026-11-03T11:58:00Z',
      },
    ],
    oom_kills: [
      {
        at: '2026-11-03T11:50:02Z',
        deployment_id: 'dep-1',
        peak_mb: 600,
        plan_mb: 512,
        deployment_failed: false,
      },
    ],
    oom_kills_total: 1,
    oom_fix: '• upgrade to a plan with at least 608 MB of RAM\n• trim in-memory state',
    tracing_enabled: false,
    generated_at: '2026-11-03T12:00:00Z',
  };

  it('leads with apid’s verdict as icon and word, labelled preview', () => {
    hooks.useDebugStatus.mockReturnValue(ok(status));
    render(<DebugStatusPanel slug="api" since="1h" onOpenRequest={vi.fn()} />);
    const verdict = screen.getByRole('status', { name: 'Debug verdict' });
    expect(verdict).toHaveTextContent('Failing');
    expect(verdict.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText(status.headline)).toBeInTheDocument();
    expect(screen.getByText('1,240')).toBeInTheDocument();
  });

  it('opens a recent failure’s evidence and lists the memory fix', () => {
    const open = vi.fn();
    hooks.useDebugStatus.mockReturnValue(ok(status));
    render(<DebugStatusPanel slug="api" since="1h" onOpenRequest={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open evidence' }));
    expect(open).toHaveBeenCalledWith('req-1');
    expect(screen.getByText('trim in-memory state')).toBeInTheDocument();
    expect(screen.getByText(/peak 600 MB, plan\s+512 MB/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn on request tracing' })).toHaveAttribute(
      'href',
      '/docs/tracing'
    );
  });
});

describe('DebugDependencies', () => {
  const deps = {
    app_id: 'a',
    since: '24h',
    window_start: '2026-11-02T12:00:00Z',
    window_end: '2026-11-03T12:00:00Z',
    retention_clamped: false,
    complete: false,
    truncated: false,
    telemetry_rows: 10,
    represented_requests: 900,
    span_samples: 400,
    dependencies: [
      {
        type: 'managed_binding',
        kind: 'postgres',
        name: 'orders-db',
        calls: 800,
        error_calls: 0,
        error_rate_pct: 0,
        p50_ms: 20,
        p95_ms: 1610,
        p99_ms: 2000,
        p95_delta_ms: 1570,
        regression: true,
        failure_regression: false,
        queries: [
          {
            pattern: 'SELECT * FROM orders WHERE id = $1',
            calls: 800,
            error_calls: 0,
            p95_ms: 1610,
            regression: true,
            failure_regression: false,
          },
        ],
      },
    ],
    edges: [
      {
        from: { type: 'application', name: 'GET /orders/{id}' },
        to: { type: 'managed_binding', name: 'orders-db' },
        exemplars: [
          {
            request_id: 'req-7',
            window: 'current',
            received_at: '2026-11-03T11:00:00Z',
            duration_ms: 1900,
            http_status: 200,
            error: false,
            count: 1,
          },
        ],
        calls: 800,
        error_calls: 0,
        error_rate_pct: 0,
        p50_ms: 20,
        p95_ms: 1610,
        p99_ms: 2000,
        exclusive_p50_ms: 18,
        exclusive_p95_ms: 1600,
        exclusive_p99_ms: 1990,
        regression: true,
      },
    ],
  };

  it('flags a regressed dependency and its query, and says when it is sampled', () => {
    hooks.useDependencyLatency.mockReturnValue(ok(deps));
    render(<DebugDependencies slug="api" since="24h" />);
    const row = screen.getByRole('row', { name: /orders-db/ });
    expect(within(row).getByText(/Slower \+1,570 ms/)).toBeInTheDocument();
    expect(screen.getByText('SELECT * FROM orders WHERE id = $1')).toBeInTheDocument();
    expect(screen.getByText(/Sampled: caps were reached/)).toBeInTheDocument();
  });

  it('opens a representative request only where request evidence is available', () => {
    hooks.useDependencyLatency.mockReturnValue(ok(deps));
    const open = vi.fn();
    const { unmount } = render(<DebugDependencies slug="api" since="24h" onOpenRequest={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open request' }));
    expect(open).toHaveBeenCalledWith('req-7');
    unmount();
    render(<DebugDependencies slug="api" since="24h" />);
    expect(screen.queryByRole('button', { name: 'Open request' })).not.toBeInTheDocument();
    expect(screen.getByText('req-7')).toBeInTheDocument();
  });
});
