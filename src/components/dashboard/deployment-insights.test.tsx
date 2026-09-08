import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useDeploymentStages = vi.fn();
const useDeploymentAudit = vi.fn();
const useDeploymentPreviewUrl = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useDeploymentStages: (id: string) => useDeploymentStages(id) as unknown,
  useDeploymentAudit: (id: string) => useDeploymentAudit(id) as unknown,
  useDeploymentPreviewUrl: (id: string) => useDeploymentPreviewUrl(id) as unknown,
}));

const { DeploymentAudit, DeploymentPreviewUrl, DeploymentStages } =
  await import('./deployment-insights');

const ready = (data: unknown) => ({ data, isPending: false, error: null });
const failed = (error: unknown) => ({ data: undefined, isPending: false, error });

beforeEach(() => {
  useDeploymentStages.mockReset();
  useDeploymentAudit.mockReset();
  useDeploymentPreviewUrl.mockReset();
});

describe('DeploymentStages', () => {
  it('lists closed stages with their server-measured durations and the one in progress', () => {
    useDeploymentStages.mockReturnValue(
      ready({
        current: 'image_build',
        current_started_at: '2026-09-06T10:00:30Z',
        history: [
          { name: 'source_download', duration_ms: 1800, status: 'completed' },
          { name: 'dependency_restore', duration_ms: 9400, status: 'completed' },
        ],
      })
    );
    render(<DeploymentStages deploymentId="d1" />);
    expect(screen.getByText('Source download')).toBeInTheDocument();
    expect(screen.getByText('9.4s')).toBeInTheDocument();
    expect(screen.getByText('Image build')).toBeInTheDocument();
    expect(screen.getByText('in progress')).toBeInTheDocument();
  });

  it('shows why a failed stage failed', () => {
    useDeploymentStages.mockReturnValue(
      ready({
        history: [
          { name: 'image_build', duration_ms: 41000, status: 'failed', reason: 'exit status 1' },
        ],
      })
    );
    render(<DeploymentStages deploymentId="d1" />);
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('exit status 1')).toBeInTheDocument();
  });

  it('says when no summary was recorded rather than rendering a 404 as a fault', () => {
    useDeploymentStages.mockReturnValue(
      failed(new ApiError({ status: 404, code: 'not_found', title: 'Not found' }))
    );
    render(<DeploymentStages deploymentId="d1" />);
    expect(screen.getByText(/no stage summary was recorded/i)).toBeInTheDocument();
  });
});

describe('DeploymentPreviewUrl', () => {
  it('links the live preview host', () => {
    useDeploymentPreviewUrl.mockReturnValue(
      ready({
        deployment_id: 'd1',
        app_id: 'a1',
        host: 'deploy-4.api.gregale.dev',
        url: 'https://deploy-4.api.gregale.dev',
        alive: true,
      })
    );
    render(<DeploymentPreviewUrl deploymentId="d1" />);
    const link = screen.getByRole('link', { name: /deploy-4\.api\.gregale\.dev/ });
    expect(link).toHaveAttribute('href', 'https://deploy-4.api.gregale.dev');
  });

  it('reads a 200 with alive=false as a closed preview, not an error', () => {
    useDeploymentPreviewUrl.mockReturnValue(
      ready({ deployment_id: 'd1', app_id: 'a1', host: '', url: '', alive: false })
    );
    render(<DeploymentPreviewUrl deploymentId="d1" />);
    expect(screen.getByText('preview closed')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('DeploymentAudit', () => {
  it('renders each row with its actor and opens the payload on demand', () => {
    useDeploymentAudit.mockReturnValue(
      ready({
        limit: 50,
        items: [
          {
            at: '2026-09-06T10:05:00Z',
            kind: 'deploy.traffic_changed',
            actor: 'system',
            data: { from: 0, to: 100 },
          },
          { at: '2026-09-06T10:00:00Z', kind: 'deploy.created', actor: 'cli' },
        ],
      })
    );
    render(<DeploymentAudit deploymentId="d1" />);
    expect(screen.getByText('Traffic changed')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('cli')).toBeInTheDocument();
    expect(screen.getByText(/"to": 100/)).toBeInTheDocument();
  });

  it('says when the list was cut at the server limit', () => {
    useDeploymentAudit.mockReturnValue(
      ready({
        limit: 2,
        items: [
          { at: '2026-09-06T10:05:00Z', kind: 'deploy.created', actor: 'cli' },
          { at: '2026-09-06T10:00:00Z', kind: 'deploy.created', actor: 'cli' },
        ],
      })
    );
    render(<DeploymentAudit deploymentId="d1" />);
    expect(screen.getByText(/showing the latest 2 rows/i)).toBeInTheDocument();
  });
});
