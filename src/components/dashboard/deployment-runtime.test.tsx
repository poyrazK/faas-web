import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeRelease } from '@/lib/api/deployment-detail';

const useDeploymentRuntime = vi.fn();
const useRuntimeUpgradePreview = vi.fn();
vi.mock('@/lib/api/deployment-detail', () => ({
  useDeploymentRuntime: (id: string) => useDeploymentRuntime(id) as unknown,
  useRuntimeUpgradePreview: (id: string, target: string) =>
    useRuntimeUpgradePreview(id, target) as unknown,
}));
const { DeploymentRuntime } = await import('./deployment-runtime');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const idle = { data: undefined, isPending: true, isFetching: false, error: null, refetch: vi.fn() };

const release = (id: string, published: string): RuntimeRelease => ({
  id: id.repeat(64),
  runtime: 'node22',
  architecture: 'amd64',
  source_digest: `sha256:${id}src`,
  guest_init_digest: `sha256:${id}init`,
  base_digest: `sha256:${id}base`,
  layout_version: '3',
  published_at: published,
  qualification: 'not_evaluated',
});

beforeEach(() => {
  useDeploymentRuntime.mockReset();
  useRuntimeUpgradePreview.mockReset().mockReturnValue(idle);
});

describe('DeploymentRuntime', () => {
  it('shows the pinned base and previews a candidate without offering to apply it', async () => {
    const current = release('a', '2026-10-01T00:00:00Z');
    const candidate = release('b', '2026-10-20T00:00:00Z');
    useDeploymentRuntime.mockReturnValue(
      ready({
        deployment_id: 'dep-1',
        status: 'pinned',
        reason: 'The artifact is bound to immutable runtime base bytes.',
        current,
        releases: [current, candidate],
      })
    );
    useRuntimeUpgradePreview.mockImplementation((_id: string, target: string) =>
      target
        ? ready({
            deployment_id: 'dep-1',
            current,
            target: candidate,
            disposition: 'review_required',
            changes: ['guest_init', 'base_bytes'],
            blockers: ['Runtime update execution is not available in this preview.'],
            required_steps: ['Rebuild the same source against the target base.'],
            rebuild_required: true,
            cold_start_required: true,
            execution_available: false,
          })
        : idle
    );
    render(<DeploymentRuntime deploymentId="dep-1" />);
    const region = screen.getByRole('region', { name: 'Runtime base' });
    expect(region).toHaveTextContent('node22');
    expect(region).toHaveTextContent('sha256:abase');
    expect(region).toHaveTextContent(/bound to immutable runtime base bytes/);

    const picker = screen.getByRole('combobox', { name: /compare with/i });
    // The current release is not a candidate against itself.
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await userEvent.selectOptions(picker, candidate.id);
    expect(useRuntimeUpgradePreview).toHaveBeenLastCalledWith('dep-1', candidate.id);
    expect(region).toHaveTextContent(/review required/i);
    expect(region).toHaveTextContent(/guest init/i);
    expect(region).toHaveTextContent(/execution is not available/);
    expect(region).toHaveTextContent(/Rebuild the same source/);
    expect(region).toHaveTextContent(/rebuild and a cold start/i);
    expect(screen.queryByRole('button', { name: /apply|upgrade|update/i })).not.toBeInTheDocument();
  });

  it('explains an unsupported workload and offers no preview', () => {
    useDeploymentRuntime.mockReturnValue(
      ready({
        deployment_id: 'dep-1',
        status: 'unsupported',
        reason: 'Customer images and Dockerfiles retain their own runtime selection.',
        current: null,
        releases: [],
      })
    );
    render(<DeploymentRuntime deploymentId="dep-1" />);
    expect(screen.getByText(/retain their own runtime selection/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows a 503 as unavailable evidence', () => {
    useDeploymentRuntime.mockReturnValue({
      data: undefined,
      isPending: false,
      error: Object.assign(new Error('runtime release evidence unavailable'), {}),
      refetch: vi.fn(),
    });
    render(<DeploymentRuntime deploymentId="dep-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('runtime release evidence unavailable');
  });
});
