import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';
import type { RollbackOperation } from '@/lib/api/deployment-detail';

const rollback = vi.fn();
const useRollbackOperation = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/deployment-detail', () => ({
  useRollbackToRelease: () => ({ mutateAsync: rollback, isPending: false }),
  useRollbackOperation: (slug: string, id: string, initial?: RollbackOperation) =>
    useRollbackOperation(slug, id, initial) as unknown,
  isRollbackSettled: (status: string) => status === 'complete' || status === 'failed',
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { RollbackStatus, RollbackToRelease } = await import('./rollback-status');

const operation = (over: Partial<RollbackOperation> = {}): RollbackOperation => ({
  id: 'op-1',
  app_id: 'a1',
  scope: 'default',
  target_deployment_id: '0a1b2c3d-0000-4000-8000-000000000041',
  current_deployment_id: '0a1b2c3d-0000-4000-8000-000000000042',
  status: 'preparing',
  service: false,
  trigger: 'manual',
  created_at: '2026-10-31T10:00:00Z',
  updated_at: '2026-10-31T10:00:00Z',
  ...over,
});
const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });

function deployment(over: Partial<Deployment> = {}): Deployment {
  return {
    id: '0a1b2c3d-0000-4000-8000-000000000041',
    app_id: 'a1',
    image_digest: 'sha256:abc',
    kind: 'github',
    status: 'superseded',
    revision: 41,
    created_at: '2026-10-30T10:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  rollback.mockReset();
  useRollbackOperation.mockReset();
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('RollbackStatus', () => {
  it('says the rollback is still preparing and keeps watching', () => {
    useRollbackOperation.mockReturnValue(ready(operation()));
    render(<RollbackStatus slug="alpha" operation={operation()} />);
    const status = screen.getByRole('status', { name: 'Rollback progress' });
    expect(status).toHaveTextContent(/preparing/i);
    expect(status).toHaveTextContent(/readiness/i);
    expect(useRollbackOperation).toHaveBeenCalledWith('alpha', 'op-1', operation());
  });

  it('reports how long a completed rollback took', () => {
    useRollbackOperation.mockReturnValue(
      ready(
        operation({ status: 'complete', recovery_ms: 8400, completed_at: '2026-10-31T10:00:08Z' })
      )
    );
    render(<RollbackStatus slug="alpha" operation={operation()} />);
    expect(screen.getByRole('status', { name: 'Rollback progress' })).toHaveTextContent(
      /serving again after 8\.4 s/i
    );
  });

  it('shows why a rollback failed with its code', () => {
    useRollbackOperation.mockReturnValue(
      ready(
        operation({
          status: 'failed',
          code: 'rollback_timeout',
          error: 'the rollback target did not serve within 10m0s',
        })
      )
    );
    render(<RollbackStatus slug="alpha" operation={operation()} />);
    const status = screen.getByRole('status', { name: 'Rollback progress' });
    expect(status).toHaveTextContent('did not serve within 10m0s');
    expect(status).toHaveTextContent('rollback_timeout');
  });

  it('lists the binding blockers of a blocked checked rollback', () => {
    useRollbackOperation.mockReturnValue(
      ready(
        operation({
          status: 'blocked',
          blockers: [{ code: 'verification_expired', message: 'Verify the target again.' }],
        })
      )
    );
    render(<RollbackStatus slug="alpha" operation={operation()} />);
    expect(screen.getByText('Verify the target again.')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Rollback progress' })).toHaveTextContent(/retries/i);
  });
});

describe('RollbackToRelease', () => {
  it('is offered only for a superseded release', () => {
    const { rerender } = render(<RollbackToRelease slug="alpha" deployment={deployment()} />);
    expect(screen.getByRole('button', { name: 'Roll back to v41' })).toBeInTheDocument();
    rerender(<RollbackToRelease slug="alpha" deployment={deployment({ status: 'live' })} />);
    expect(screen.queryByRole('button', { name: /roll back/i })).not.toBeInTheDocument();
  });

  it('confirms what moves, names the target, and then watches the operation', async () => {
    rollback.mockResolvedValue({ ...deployment(), rollback_operation: operation() });
    useRollbackOperation.mockReturnValue(ready(operation()));
    render(<RollbackToRelease slug="alpha" deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Roll back to v41' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Roll back to v41?',
        destructive: true,
        description: expect.stringMatching(/v41 takes this app's traffic back/),
      })
    );
    expect(rollback).toHaveBeenCalledWith({
      slug: 'alpha',
      targetDeploymentId: '0a1b2c3d-0000-4000-8000-000000000041',
    });
    expect(await screen.findByRole('status', { name: 'Rollback progress' })).toBeInTheDocument();
  });

  it('keeps showing the progress after the restored release turns live', async () => {
    rollback.mockResolvedValue({ ...deployment(), rollback_operation: operation() });
    useRollbackOperation.mockReturnValue(ready(operation({ status: 'complete' })));
    const { rerender } = render(<RollbackToRelease slug="alpha" deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Roll back to v41' }));
    await screen.findByRole('status', { name: 'Rollback progress' });
    rerender(
      <RollbackToRelease
        slug="alpha"
        deployment={deployment({ status: 'live', traffic_percent: 100 })}
      />
    );
    expect(screen.getByRole('status', { name: 'Rollback progress' })).toHaveTextContent(
      /complete/i
    );
    expect(screen.queryByRole('button', { name: /roll back/i })).not.toBeInTheDocument();
  });

  it('lists the release commands it crosses and acknowledges them only on a second confirmation', async () => {
    rollback
      .mockRejectedValueOnce(
        new ApiError({
          status: 409,
          code: 'rollback_crosses_release',
          title: 'Rollback crosses release',
          detail: 'release commands ran after the target last served',
          crossed_releases: [
            {
              deployment_id: '0a1b2c3d-0000-4000-8000-000000000042',
              revision: 42,
              status: 'succeeded',
              started_at: '2026-10-31T09:00:00Z',
            },
          ],
        })
      )
      .mockResolvedValueOnce({ ...deployment(), rollback_operation: operation() });
    useRollbackOperation.mockReturnValue(ready(operation()));
    render(<RollbackToRelease slug="alpha" deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Roll back to v41' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/v42 \(succeeded\).*does not undo/s),
        destructive: true,
      })
    );
    expect(rollback).toHaveBeenLastCalledWith({
      slug: 'alpha',
      targetDeploymentId: '0a1b2c3d-0000-4000-8000-000000000041',
      acknowledgeReleases: true,
    });
  });

  it('does not acknowledge crossed releases when the second confirmation is dismissed', async () => {
    rollback.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'rollback_crosses_release',
        title: 'x',
        crossed_releases: [],
      })
    );
    confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<RollbackToRelease slug="alpha" deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Roll back to v41' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(rollback).toHaveBeenCalledOnce();
  });

  it('explains a target whose snapshot is gone', async () => {
    rollback.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'rollback_target_snapshot_expired',
        title: 'x',
        detail: 'snapshot was garbage-collected',
      })
    );
    render(<RollbackToRelease slug="alpha" deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Roll back to v41' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', description: expect.stringMatching(/redeploy/i) })
      )
    );
  });
});
