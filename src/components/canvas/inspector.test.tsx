import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { CanvasNode, Topology } from './topology';

const metrics = vi.fn();
const series = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useAppMetrics: () => metrics() as unknown,
  useAppAnalyticsTimeseries: () => series() as unknown,
}));
vi.mock('@/lib/api/logs', () => ({ useLogStream: () => ({ lines: [], status: 'streaming' }) }));
vi.mock('@/components/dashboard/domain-doctor', () => ({ DomainDoctor: () => <p>doctor</p> }));
vi.mock('@/components/dither-kit', () => ({ Sparkline: () => <svg data-testid="spark" /> }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const { Inspector } = await import('./inspector');
const appNode: CanvasNode = {
  id: 'app:acme-api',
  data: { kind: 'app', slug: 'acme-api', phase: 'running', metrics: 'ready', connections: 'ready' },
};
const topo: Topology = {
  nodes: [
    appNode,
    {
      id: 'domain:api.acme.dev',
      data: {
        kind: 'domain',
        domain: 'api.acme.dev',
        verified: true,
        txtRecord: null,
        appSlug: 'acme-api',
      },
    },
  ],
  edges: [{ id: 'e', source: 'domain:api.acme.dev', target: 'app:acme-api', kind: 'ingress' }],
  issues: [],
};
const ok = (data: unknown) => ({ data, error: null, isPending: false });

describe('Inspector · app', () => {
  it('shows the 24h scalars, the hourly series, and the connections', () => {
    metrics.mockReturnValue(
      ok({
        request_count: 12_400,
        error_rate_pct: 0.31,
        latency_p95_ms: 84,
        wakes_24h: 9,
        cold_start_pct: 2.1,
      })
    );
    series.mockReturnValue(ok({ points: Array.from({ length: 24 }, (_, i) => ({ requests: i })) }));
    render(<Inspector node={appNode} topology={topo} onClose={vi.fn()} />);
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByTestId('spark')).toBeInTheDocument();
    expect(screen.getByText(/per hour/i)).toBeInTheDocument();
    expect(screen.getByText('api.acme.dev')).toBeInTheDocument();
  });

  it('says metrics need Hobby on 402', () => {
    const error = new ApiError({
      status: 402,
      code: 'plan_per_app_metrics_not_allowed',
      title: 'Upgrade',
    });
    metrics.mockReturnValue({ data: undefined, error, isPending: false });
    series.mockReturnValue({ data: undefined, error, isPending: false });
    render(<Inspector node={appNode} topology={topo} onClose={vi.fn()} />);
    expect(screen.getAllByText(/metrics need hobby/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('spark')).not.toBeInTheDocument();
  });

  it('says the series is unavailable instead of drawing a flat line', () => {
    metrics.mockReturnValue(
      ok({ request_count: 1, error_rate_pct: 0, latency_p95_ms: 5, cold_start_pct: 0 })
    );
    series.mockReturnValue({
      data: undefined,
      error: new ApiError({ status: 403, code: 'debug_telemetry_disabled', title: 'off' }),
      isPending: false,
    });
    render(<Inspector node={appNode} topology={topo} onClose={vi.fn()} />);
    expect(screen.getByText(/hourly series unavailable/i)).toBeInTheDocument();
  });
});

describe('Inspector · optional scalars', () => {
  it('never prints undefined when wakes are not reported', () => {
    metrics.mockReturnValue(
      ok({ request_count: 3, error_rate_pct: 0, latency_p95_ms: 5, cold_start_pct: 1.5 })
    );
    series.mockReturnValue(ok({ points: [] }));
    render(<Inspector node={appNode} topology={topo} onClose={vi.fn()} />);
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(screen.getByText('1.5% cold')).toBeInTheDocument();
  });
});

describe('Inspector · domain', () => {
  it('shows the TXT record while pending and the doctor', () => {
    const node: CanvasNode = {
      id: 'domain:new.acme.dev',
      data: {
        kind: 'domain',
        domain: 'new.acme.dev',
        verified: false,
        txtRecord: '_gregale-challenge TXT "abc"',
        appSlug: 'acme-api',
      },
    };
    render(<Inspector node={node} topology={topo} onClose={vi.fn()} />);
    expect(screen.getByText('_gregale-challenge TXT "abc"')).toBeInTheDocument();
    expect(screen.getByText('doctor')).toBeInTheDocument();
  });
});
