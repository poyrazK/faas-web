import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHealthPanel } from './app-health';
import type { AppHealth } from '@/lib/api/queries';
import { ApiError } from '@/lib/api/errors';

const query = vi.hoisted(() => ({
  data: undefined as AppHealth | undefined,
  error: null as Error | null,
  isPending: false,
  isFetching: false,
  refetch: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({ useAppHealth: () => query }));
const healthy = (): AppHealth => ({
  app_id: 'app',
  status: 'healthy',
  phase: 'serving',
  scope: 'default',
  summary: 'No issues in available evidence.',
  evaluated_at: new Date().toISOString(),
  valid_for_seconds: 120,
  serving_deployment_ids: ['serving'],
  capacity: { known: true, required: 1, ready: 1, starting: 0, unready: 0, unknown: 0 },
  checks: [{ code: 'readiness', status: 'pass', detail: 'One replica is ready.' }],
});
const navigate = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  query.data = healthy();
  query.error = null;
  query.isPending = false;
  query.isFetching = false;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('observed app health', () => {
  it('shows the server assessment and evidence', () => {
    render(<AppHealthPanel slug="alpha" onNavigate={navigate} />);
    expect(screen.getByRole('heading', { name: 'Healthy' })).toBeInTheDocument();
    expect(screen.getByText('One replica is ready.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh health' }));
    expect(query.refetch).toHaveBeenCalled();
  });
  it('expires a previously healthy assessment without a refetch', () => {
    render(<AppHealthPanel slug="alpha" onNavigate={navigate} />);
    act(() => vi.advanceTimersByTime(125_000));
    expect(screen.getByRole('heading', { name: 'Health unconfirmed' })).toBeInTheDocument();
    expect(screen.queryByText('One replica is ready.')).not.toBeInTheDocument();
    expect(screen.getByText(/assessment has expired/)).toBeInTheDocument();
  });
  it('lets API unreachability take precedence over cached success', () => {
    query.error = new ApiError({
      type: 'about:blank',
      title: 'Unavailable',
      status: 503,
      code: 'http_503',
    });
    render(<AppHealthPanel slug="alpha" onNavigate={navigate} />);
    expect(screen.getByText(/Could not reach the API/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Healthy' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(query.refetch).toHaveBeenCalled();
  });
  it('distinguishes loading and an empty response', () => {
    query.data = undefined;
    query.isPending = true;
    const view = render(<AppHealthPanel slug="alpha" onNavigate={navigate} />);
    expect(screen.getByText('Collecting health evidence…')).toBeInTheDocument();
    query.isPending = false;
    view.rerender(<AppHealthPanel slug="alpha" onNavigate={navigate} />);
    expect(screen.getByText('No assessment was returned.')).toBeInTheDocument();
  });
  it('shows expected idle separately from health confidence', () => {
    query.data = {
      ...healthy(),
      phase: 'idle',
      status: 'unknown',
      summary: 'Telemetry is unavailable.',
    };
    render(<AppHealthPanel slug="alpha" onNavigate={navigate} />);
    expect(screen.getByRole('heading', { name: /Health unconfirmed.*idle/ })).toBeInTheDocument();
    expect(screen.getByText('Telemetry is unavailable.')).toBeInTheDocument();
  });
  it('opens the failed deployment while retaining serving evidence', () => {
    query.data = {
      ...healthy(),
      status: 'degraded',
      summary: 'Latest release failed.',
      checks: [
        {
          code: 'latest_deployment',
          status: 'warning',
          detail: 'Older release still serves.',
          action: 'deployments',
          deployment_id: 'failed',
        },
      ],
    };
    render(<AppHealthPanel slug="alpha" onNavigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect deployments' }));
    expect(navigate).toHaveBeenCalledWith('Deployments', 'failed');
    expect(screen.getByText('Older release still serves.')).toBeInTheDocument();
  });
});
