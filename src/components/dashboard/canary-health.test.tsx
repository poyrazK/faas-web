import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanaryHealth } from './canary-health';

const hooks = vi.hoisted(() => ({
  useRouteHealthReport: vi.fn(),
  useRouteHealthHistory: vi.fn(),
}));
vi.mock('@/lib/api/route-health', () => hooks);

const ok = <T,>(data: T) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const counts = (requests: number, errors: number) => ({
  requests,
  server_errors: errors,
  error_rate: errors / requests,
});

describe('CanaryHealth', () => {
  it('compares each critical route and lists the saved decisions', () => {
    hooks.useRouteHealthReport.mockReturnValue(
      ok({
        status: 'regressed',
        reason: 'POST /v1/orders regressed.',
        canary_step: 2,
        mode: 'enforce',
        on_regression: 'hold',
        coverage: 'observed_only',
        stable_deployment_id: 'dep-stable',
        minimum_requests: 50,
        routes: [
          {
            method: 'POST',
            path: '/v1/orders',
            status: 'regressed',
            reason: 'Candidate 5xx above stable.',
            windows: [
              {
                start: '',
                end: '',
                candidate: counts(200, 10),
                stable: counts(2000, 4),
                status: 'regressed',
                reason: '',
                latency_delta_ms: 42,
              },
            ],
          },
        ],
      })
    );
    hooks.useRouteHealthHistory.mockReturnValue(
      ok({
        entries: [
          {
            id: 'd1',
            checked_at: '2026-10-15T10:00:00Z',
            traffic_percent: 10,
            requested_traffic_percent: 10,
            decision: { status: 'blocked', reason: 'Held at 10%: route regressed.' },
          },
        ],
      })
    );
    render(<CanaryHealth slug="api" deploymentId="dep-1" />);
    expect(screen.getByText('POST /v1/orders regressed.')).toBeInTheDocument();
    expect(screen.getByText(/on regression: hold/)).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /POST \/v1\/orders/ });
    expect(within(row).getByText('5.0% of 200')).toBeInTheDocument();
    expect(within(row).getByText('0.20% of 2000')).toBeInTheDocument();
    expect(within(row).getByText('+42 ms')).toBeInTheDocument();
    const decisions = screen.getByRole('list', { name: 'Rollout decisions' });
    expect(within(decisions).getByText('blocked')).toBeInTheDocument();
    expect(within(decisions).getByText('Held at 10%: route regressed.')).toBeInTheDocument();
  });

  it('says when there is no single stable release to compare against', () => {
    hooks.useRouteHealthReport.mockReturnValue(
      ok({
        status: 'unknown',
        reason: 'No stable predecessor.',
        canary_step: 1,
        mode: 'report',
        coverage: 'observed_only',
        stable_deployment_id: '',
        minimum_requests: 50,
        routes: [],
      })
    );
    hooks.useRouteHealthHistory.mockReturnValue(ok({ entries: [] }));
    render(<CanaryHealth slug="api" deploymentId="dep-1" />);
    expect(screen.getByText(/no single stable release to compare against/)).toBeInTheDocument();
  });
});
