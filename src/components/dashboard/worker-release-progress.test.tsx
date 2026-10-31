import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { WorkerReleaseProgress } from './worker-release-progress';

const state = vi.hoisted(() => ({ status: 'pending', appId: 'app-1', error: false }));
vi.mock('@/lib/api/queries', () => ({
  useDeployment: () => ({
    data: { id: 'dep-1', app_id: state.appId, status: state.status },
    isError: state.error,
  }),
}));

it('separates accepted worker release from execution health', () => {
  const live = vi.fn();
  const props = { slug: 'batch-worker', appId: 'app-1', deploymentId: 'dep-1', onLive: live };
  const view = render(<WorkerReleaseProgress {...props} />);
  expect(screen.getByText(/Release dep-1 accepted/i)).toBeVisible();
  expect(screen.getByText(/execution unverified/i)).toBeVisible();
  expect(live).not.toHaveBeenCalled();
  state.status = 'live';
  view.rerender(<WorkerReleaseProgress {...props} />);
  expect(screen.getByText(/Release live/i)).toBeVisible();
  expect(screen.getByText(/consumer liveness separately/i)).toBeVisible();
  expect(live).toHaveBeenCalledTimes(1);
});

it('does not accept a release belonging to another app', () => {
  state.status = 'live';
  state.appId = 'other-app';
  const live = vi.fn();
  render(
    <WorkerReleaseProgress slug="batch-worker" appId="app-1" deploymentId="dep-1" onLive={live} />
  );
  expect(screen.getByRole('alert')).toHaveTextContent(/different app/i);
  expect(live).not.toHaveBeenCalled();
});
