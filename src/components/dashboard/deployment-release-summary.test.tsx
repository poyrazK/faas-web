import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deployment, DeploymentSummary } from '@/lib/api/queries';

const useDeploymentSummary = vi.fn();
const rollback = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useDeploymentSummary: (slug: string, deploymentId: string) =>
    useDeploymentSummary(slug, deploymentId) as unknown,
  useRollback: () => ({ mutateAsync: rollback, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { DeploymentReleaseSummary } = await import('./deployment-release-summary');

function deployment(id: string, createdAt: string): Deployment {
  return {
    id,
    app_id: 'app-api',
    image_digest: `sha256:${id}`,
    kind: 'github',
    status: 'superseded',
    created_at: createdAt,
    rollback_on_5xx: false,
    first_5xx_count: 0,
  };
}

const selected = deployment('selected1111', '2026-09-08T10:00:00Z');
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
  rollback.mockReset().mockResolvedValue(deployment('queued3333', '2026-09-09T10:00:00Z'));
  confirm.mockReset().mockResolvedValue(true);
  toast.mockReset();
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

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          destructive: true,
          description: expect.stringContaining('target2222'),
        })
      )
    );
    await waitFor(() =>
      expect(rollback).toHaveBeenCalledWith({
        slug: 'api',
        targetDeploymentId: 'target2222',
      })
    );
  });
});
