import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { CanvasNode, Topology } from './topology';

const metrics = vi.fn();
const series = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useAppMetrics: () => metrics() as unknown,
  useAppAnalyticsTimeseries: () => series() as unknown,
}));
vi.mock('@/lib/api/logs', () => ({
  useLogStream: () => ({
    lines: [{ id: '1', ts: 0, text: 'GET /v1/orders 200', raw: '' }],
    status: 'streaming',
  }),
}));
vi.mock('@/components/dashboard/domain-doctor', () => ({ DomainDoctor: () => <p>doctor</p> }));
vi.mock('@/components/dither-kit', () => ({ Sparkline: () => <svg data-testid="spark" /> }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const { Inspector } = await import('./inspector');
const appNode: CanvasNode = {
  id: 'app:acme-api',
  data: {
    kind: 'app',
    slug: 'acme-api',
    phase: 'running',
    metrics: 'ready',
    connections: 'ready',
    runtime: 'node24',
    url: 'https://acme-api.gregale.app',
  },
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
const fullMetrics = {
  request_count: 441_600,
  error_rate_pct: 0.16,
  latency_p95_ms: 160,
  cold_start_pct: 5.5,
};

describe('Inspector · app', () => {
  it('leads with status, runtime and the real URL', () => {
    metrics.mockReturnValue(ok(fullMetrics));
    series.mockReturnValue(ok({ points: [{ requests: 1 }, { requests: 31_200 }] }));
    render(<Inspector node={appNode} topology={topo} onClose={vi.fn()} onFly={vi.fn()} />);
    expect(screen.getByText(/Serving · node24/)).toBeInTheDocument();
    expect(screen.getByText('acme-api.gregale.app')).toBeInTheDocument();
  });

  it('shows four compact KPIs and the hourly series with its peak', () => {
    metrics.mockReturnValue(ok(fullMetrics));
    series.mockReturnValue(ok({ points: [{ requests: 1 }, { requests: 31_200 }] }));
    render(<Inspector node={appNode} topology={topo} onClose={vi.fn()} onFly={vi.fn()} />);
    expect(screen.getByText('441.6k')).toBeInTheDocument();
    expect(screen.getByText('5.5')).toBeInTheDocument();
    expect(screen.getByText('peak 31.2k')).toBeInTheDocument();
    expect(screen.getByTestId('spark')).toBeInTheDocument();
  });

  it('says metrics need Hobby on 402, and never prints a number', () => {
    const error = new ApiError({ status: 402, code: 'plan', title: 'Upgrade' });
    metrics.mockReturnValue({ data: undefined, error, isPending: false });
    series.mockReturnValue({ data: undefined, error, isPending: false });
    render(<Inspector node={appNode} topology={topo} onClose={vi.fn()} onFly={vi.fn()} />);
    expect(screen.getAllByText(/metrics need hobby/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('spark')).not.toBeInTheDocument();
  });

  it('switches to logs and to connections, and flies to a connection', () => {
    metrics.mockReturnValue(ok(fullMetrics));
    series.mockReturnValue(ok({ points: [] }));
    const onFly = vi.fn();
    render(<Inspector node={appNode} topology={topo} onClose={vi.fn()} onFly={onFly} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Logs' }));
    expect(screen.getByText('GET /v1/orders 200')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Connections/ }));
    fireEvent.click(screen.getByRole('button', { name: /api\.acme\.dev/ }));
    expect(onFly).toHaveBeenCalledWith('domain:api.acme.dev');
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
    render(<Inspector node={node} topology={topo} onClose={vi.fn()} onFly={vi.fn()} />);
    expect(screen.getByText('_gregale-challenge TXT "abc"')).toBeInTheDocument();
    expect(screen.getByText('doctor')).toBeInTheDocument();
  });
});
