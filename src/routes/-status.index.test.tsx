import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicStatusOverview } from '@/lib/api/status';

const status = vi.hoisted(() => ({
  query: {} as { data?: unknown; isError: boolean; refetch: () => void },
}));
vi.mock('@/lib/api/status', async (original) => ({
  ...(await original<typeof import('@/lib/api/status')>()),
  usePublicStatus: () => status.query,
}));

const { Route } = await import('./status.index');
const StatusRoute = Route.options.component!;

const snapshot = {
  overall_status: 'operational',
  data_status: 'fresh',
  updated_at: new Date().toISOString(),
  region_scope: 'single-region',
  components: [],
  indicators: [],
  active_events: [],
  upcoming_maintenance: [],
  resolved_incidents: [],
} as unknown as PublicStatusOverview;

afterEach(() => window.localStorage.clear());

describe('/status during an API outage', () => {
  it('keeps each live snapshot, then shows it labelled when the next read fails', () => {
    status.query = { data: snapshot, isError: false, refetch: vi.fn() };
    const { unmount } = render(<StatusRoute />);
    expect(screen.getByRole('region', { name: 'Current platform status' })).toBeInTheDocument();
    unmount();

    status.query = { data: undefined, isError: true, refetch: vi.fn() };
    render(<StatusRoute />);
    expect(screen.getByRole('alert')).toHaveTextContent('The status service is unreachable.');
    expect(screen.getByRole('region', { name: 'Last known platform status' })).toBeInTheDocument();
  });

  it('says the service is unreachable and offers a retry when nothing was kept', () => {
    const refetch = vi.fn();
    status.query = { data: undefined, isError: true, refetch };
    render(<StatusRoute />);
    expect(
      screen.getByRole('heading', { name: 'The status service is unreachable' })
    ).toBeInTheDocument();
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(refetch).toHaveBeenCalledOnce();
  });
});
