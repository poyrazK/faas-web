import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deployment } from '@/lib/api/queries';

const useApp = vi.fn();
const useObservation = vi.fn();
const capability = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useApp: (slug: string) => useApp(slug) as unknown,
}));
vi.mock('@/lib/api/deployment-detail', () => ({
  useWorkerRolloutObservation: (...args: unknown[]) => useObservation(...args) as unknown,
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => capability(key) as unknown,
}));

const { RolloutObservation } = await import('./rollout-observation');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const deployment: Deployment = {
  id: 'dep-1',
  app_id: 'a1',
  image_digest: 'sha256:1',
  kind: 'image',
  status: 'live',
  scope: 'staging',
  created_at: '2026-10-31T10:00:00Z',
};

beforeEach(() => {
  useApp
    .mockReset()
    .mockReturnValue(ready({ slug: 'jobs', manifest: { execution_mode: 'worker' } }));
  useObservation.mockReset().mockReturnValue(
    ready({
      app_id: 'a1',
      deployment_id: 'dep-1',
      scope: 'staging',
      checked_at: '2026-10-31T10:05:00Z',
      basis: 'resident_generation_snapshot',
      running: 2,
      starting: 1,
      draining: 3,
      other_residents: 0,
      retired_residents: 4,
      generation_converged: false,
      queue_processing_confirmed: false,
    })
  );
  capability
    .mockReset()
    .mockReturnValue({ accountId: 'acc', state: 'available', refresh: vi.fn() });
});

describe('RolloutObservation', () => {
  it('counts where the worker generation stands, as numbers and without inventing progress', () => {
    render(<RolloutObservation slug="jobs" deployment={deployment} />);
    const region = screen.getByRole('region', { name: 'Worker rollout' });
    expect(useObservation).toHaveBeenCalledWith('jobs', 'dep-1', 'staging', true);
    for (const [label, value] of [
      ['Running', '2'],
      ['Starting', '1'],
      ['Draining', '3'],
      ['Retired', '4'],
    ])
      expect(screen.getByRole('definition', { name: label })).toHaveTextContent(value);
    expect(region).toHaveTextContent(/still converging/i);
    expect(region).toHaveTextContent(/does not confirm queue processing/i);
    expect(region.querySelector('svg path')).toBeNull();
  });

  it('says when every resident runs the selected generation', () => {
    useObservation.mockReturnValue(
      ready({
        running: 3,
        starting: 0,
        draining: 0,
        other_residents: 0,
        retired_residents: 0,
        generation_converged: true,
        queue_processing_confirmed: false,
        checked_at: '2026-10-31T10:05:00Z',
      })
    );
    render(<RolloutObservation slug="jobs" deployment={deployment} />);
    expect(screen.getByRole('region', { name: 'Worker rollout' })).toHaveTextContent(/converged/i);
  });

  it('does not call a release with no residents converging', () => {
    useObservation.mockReturnValue(
      ready({
        running: 0,
        starting: 0,
        draining: 0,
        other_residents: 2,
        retired_residents: 3,
        generation_converged: false,
        queue_processing_confirmed: false,
        checked_at: '2026-10-31T10:05:00Z',
      })
    );
    render(<RolloutObservation slug="jobs" deployment={deployment} />);
    const region = screen.getByRole('region', { name: 'Worker rollout' });
    expect(region).toHaveTextContent(/no resident runs this release/i);
    expect(region).not.toHaveTextContent(/converging/i);
  });

  it('renders nothing for a request app and does not read the observation', () => {
    useApp.mockReturnValue(ready({ slug: 'api', manifest: { execution_mode: 'request' } }));
    const { container } = render(<RolloutObservation slug="api" deployment={deployment} />);
    expect(container).toBeEmptyDOMElement();
    expect(useObservation).toHaveBeenCalledWith('api', 'dep-1', 'staging', false);
  });

  it('shows the capability notice and reads nothing when progressive rollouts are off', () => {
    capability.mockReturnValue({
      accountId: 'acc',
      state: 'runtime-unavailable',
      capability: { maturity: 'beta', docs_url: '/docs/deploys' },
      refresh: vi.fn(),
    });
    render(<RolloutObservation slug="jobs" deployment={deployment} />);
    expect(capability).toHaveBeenCalledWith('progressive-rollouts');
    expect(screen.getByRole('status')).toHaveTextContent(/unavailable on this installation/i);
    expect(useObservation).toHaveBeenCalledWith('jobs', 'dep-1', 'staging', false);
  });
});
