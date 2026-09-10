import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deployment } from '@/lib/api/queries';

const useApp = vi.fn();
const useDeployment = vi.fn();
const useLogStream = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useApp: (slug: string, options: unknown) => useApp(slug, options) as unknown,
  useDeployment: (id: string, options: unknown) => useDeployment(id, options) as unknown,
}));
vi.mock('@/lib/api/logs', () => ({
  useLogStream: (source: unknown, connected: boolean) => useLogStream(source, connected) as unknown,
}));
vi.mock('./deployment-actions', () => ({
  AdvanceCanaryButton: () => null,
  ReorderDeploymentControl: () => null,
}));
vi.mock('./deployment-insights', () => ({
  DeploymentAudit: () => null,
  DeploymentPreviewUrl: () => null,
  DeploymentStages: () => null,
}));
vi.mock('./rollout-recovery', () => ({ RolloutRecovery: () => null }));

const { DeploymentDetailPanel } = await import('./deployment-detail');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: 'dep-b',
    app_id: 'app-b',
    image_digest: 'sha256:bbbb',
    kind: 'github',
    status: 'live',
    created_at: '2026-09-09T10:00:00Z',
    rollback_on_5xx: false,
    first_5xx_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useApp.mockReset().mockReturnValue(ready({ id: 'app-a', slug: 'alpha' }));
  useDeployment.mockReset().mockReturnValue(ready(deployment()));
  useLogStream.mockReset().mockReturnValue({ lines: [], status: 'closed', reason: null });
});

describe('DeploymentDetailPanel app scope', () => {
  it('hides details and never connects logs for a deployment owned by another app', () => {
    render(<DeploymentDetailPanel deploymentId="dep-b" appSlug="alpha" onClose={vi.fn()} />);

    expect(screen.getByText(/not available for the selected app/i)).toBeInTheDocument();
    expect(screen.queryByText('Deployment ID')).not.toBeInTheDocument();
    expect(screen.queryByText('github · dep-b')).not.toBeInTheDocument();
    expect(useLogStream).toHaveBeenCalledWith(
      { kind: 'build', deploymentId: 'dep-b', limit: 200 },
      false
    );
  });

  it('renders details and connects logs when the app ids match', () => {
    useDeployment.mockReturnValue(ready(deployment({ id: 'dep-a', app_id: 'app-a' })));

    render(<DeploymentDetailPanel deploymentId="dep-a" appSlug="alpha" onClose={vi.fn()} />);

    expect(screen.getByText('Deployment ID')).toBeInTheDocument();
    expect(screen.getByText('dep-a')).toBeInTheDocument();
    expect(useLogStream).toHaveBeenCalledWith(
      { kind: 'build', deploymentId: 'dep-a', limit: 200 },
      true
    );
  });

  it('preserves account-wide details when no app slug is supplied', () => {
    render(<DeploymentDetailPanel deploymentId="dep-b" onClose={vi.fn()} />);

    expect(screen.getByText('Deployment ID')).toBeInTheDocument();
    expect(screen.getByText('dep-b')).toBeInTheDocument();
  });
});
