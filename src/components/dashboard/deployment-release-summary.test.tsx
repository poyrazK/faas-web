import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deployment, DeploymentSummary } from '@/lib/api/queries';

const useDeploymentSummary = vi.fn();
const flow = vi.hoisted(() => ({
  start: vi.fn(),
  operation: null as null | { id: string },
  isPending: false,
  slug: '',
}));

vi.mock('@/lib/api/queries', () => ({
  useDeploymentSummary: (slug: string, deploymentId: string) =>
    useDeploymentSummary(slug, deploymentId) as unknown,
}));
vi.mock('./rollback-status', () => ({
  useRollbackFlow: (slug: string) => {
    flow.slug = slug;
    return flow;
  },
  RollbackStatus: ({ operation }: { operation: { id: string } }) => (
    <p>watching rollback {operation.id}</p>
  ),
}));

const { DeploymentReleaseSummary } = await import('./deployment-release-summary');

function deployment(id: string, createdAt: string, status = 'superseded'): Deployment {
  return {
    id,
    app_id: 'app-api',
    image_digest: `sha256:${id}`,
    kind: 'github',
    status,
    created_at: createdAt,
  };
}

const selected = deployment('selected1111', '2026-09-08T10:00:00Z', 'live');
const previous = deployment('previous1111', '2026-09-07T10:00:00Z');
const summary: DeploymentSummary = {
  deployment: selected,
  previous,
  changes: [],
  rollback_target_id: 'target2222',
};

beforeEach(() => {
  useDeploymentSummary.mockReset().mockReturnValue({
    data: summary,
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
  flow.start.mockReset().mockResolvedValue(undefined);
  flow.operation = null;
});

describe('DeploymentReleaseSummary', () => {
  it('separates the selected comparison from the current rollback target', async () => {
    render(<DeploymentReleaseSummary appSlug="api" deploymentId="selected1111" />);

    expect(screen.getByText('Selected release')).toBeInTheDocument();
    expect(screen.getByText('Previous to selected')).toBeInTheDocument();
    expect(screen.queryByText(/^Current$/)).not.toBeInTheDocument();

    const rollbackTarget = screen.getByText('Eligible rollback target').parentElement;
    expect(rollbackTarget).toHaveTextContent('target2222');
    expect(rollbackTarget).toHaveTextContent(/may differ from the selected release/i);

    await userEvent.click(screen.getByRole('button', { name: /roll back to target22/i }));

    // The shared flow owns the confirmation, the cross-release check and the
    // status polling, so this button behaves like the drawer's own.
    expect(flow.slug).toBe('api');
    expect(flow.start).toHaveBeenCalledWith('target2222', 'target22');
  });

  it('names the target by revision when the API gives one', async () => {
    useDeploymentSummary.mockReturnValue({
      data: { ...summary, rollback_target_revision: 41 },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DeploymentReleaseSummary appSlug="api" deploymentId="selected1111" />);
    await userEvent.click(screen.getByRole('button', { name: 'Roll back to v41' }));
    expect(flow.start).toHaveBeenCalledWith('target2222', 'v41');
  });

  it('leaves a superseded release to the drawer’s own rollback, so one drawer has one button', () => {
    useDeploymentSummary.mockReturnValue({
      data: { ...summary, deployment: deployment('selected1111', '2026-09-08T10:00:00Z') },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DeploymentReleaseSummary appSlug="api" deploymentId="selected1111" />);
    expect(screen.getByText('Eligible rollback target').parentElement).toHaveTextContent(
      'target2222'
    );
    expect(screen.queryByRole('button', { name: /roll back/i })).not.toBeInTheDocument();
  });

  it('watches the rollback operation the API accepted until it ends', () => {
    flow.operation = { id: 'op-77' };
    render(<DeploymentReleaseSummary appSlug="api" deploymentId="selected1111" />);
    expect(screen.getByText('watching rollback op-77')).toBeInTheDocument();
  });
});
