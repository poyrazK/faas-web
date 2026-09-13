import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deployment } from '@/lib/api/queries';

const useApp = vi.fn();
const useDeployment = vi.fn();
const useLogStream = vi.fn();
const useBuild = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useApp: (slug: string, options: unknown) => useApp(slug, options) as unknown,
  useDeployment: (id: string, options: unknown) => useDeployment(id, options) as unknown,
  useApps: () => ({ data: [] }),
  useBuild: () => useBuild(),
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
vi.mock('./deployment-release-summary', () => ({ DeploymentReleaseSummary: () => null }));
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
  useBuild.mockReset().mockReturnValue(ready(undefined));
});

describe('DeploymentDetailPanel app scope', () => {
  it('leads with the reported cause and exposes output and retry section shortcuts', async () => {
    useDeployment.mockReturnValue(
      ready(
        deployment({
          status: 'failed',
          error_why: 'Start command missing',
          error_fix: 'Set a valid command',
          error_relevant_logs: [{ message: 'exec: not found' }],
        })
      )
    );
    const change = vi.fn();
    render(
      <DeploymentDetailPanel
        deploymentId="dep-b"
        section="overview"
        onSectionChange={change}
        onClose={vi.fn()}
      />
    );
    const explanation = screen.getByRole('region', { name: 'Failure explanation' });
    expect(explanation).toHaveTextContent('Start command missing');
    expect(explanation).toHaveTextContent('Set a valid command');
    expect(explanation).toHaveTextContent('exec: not found');
    expect(
      explanation.compareDocumentPosition(screen.getByText('Deployment ID')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'View build output' }));
    expect(change).toHaveBeenLastCalledWith('output');
    await userEvent.click(screen.getByRole('button', { name: 'Retry options' }));
    expect(change).toHaveBeenLastCalledWith('lifecycle');
  });

  it('shows build-only failure evidence even when its deployment read fails', () => {
    useBuild.mockReturnValue(
      ready({
        id: 'build-b',
        deployment_id: 'dep-b',
        status: 'failed',
        kind: 'github',
        source_bytes: 12,
        enqueued_at: '2026-09-12T00:00:00Z',
        failure_class: 'oom',
      })
    );
    useDeployment.mockReturnValue({
      ...ready(deployment({ status: 'failed', error_why: 'Stale cause' })),
      error: new Error('Offline'),
    });
    render(<DeploymentDetailPanel buildId="build-b" onClose={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Failure explanation' })).toHaveTextContent(
      'The build ran out of memory.'
    );
    expect(screen.queryByText('Stale cause')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry options' })).not.toBeInTheDocument();
  });

  it('does not leak cross-app failure explanations', () => {
    useDeployment.mockReturnValue(
      ready(deployment({ status: 'failed', error_why: 'Other app secret evidence' }))
    );
    render(<DeploymentDetailPanel deploymentId="dep-b" appSlug="alpha" onClose={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Failure explanation' })).not.toBeInTheDocument();
    expect(screen.queryByText('Other app secret evidence')).not.toBeInTheDocument();
  });

  it('withholds build evidence when app ownership cannot be verified', () => {
    useBuild.mockReturnValue(
      ready({
        id: 'build-b',
        deployment_id: 'dep-b',
        status: 'failed',
        failure_class: 'oom',
        source_bytes: 12,
        kind: 'github',
        enqueued_at: '2026-09-12T00:00:00Z',
      })
    );
    useDeployment.mockReturnValue({ ...ready(undefined), error: new Error('Offline') });
    render(<DeploymentDetailPanel buildId="build-b" appSlug="alpha" onClose={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Failure explanation' })).not.toBeInTheDocument();
  });

  it.each(['live', 'building', 'cancelled'])(
    'does not diagnose a %s deployment from stale error fields',
    (status) => {
      useDeployment.mockReturnValue(ready(deployment({ status, error_why: 'Old cause' })));
      render(<DeploymentDetailPanel deploymentId="dep-b" onClose={vi.fn()} />);
      expect(screen.queryByRole('region', { name: 'Failure explanation' })).not.toBeInTheDocument();
    }
  );
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
