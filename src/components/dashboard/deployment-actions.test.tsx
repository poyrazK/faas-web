import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';

const advance = vi.fn();
const reorder = vi.fn();
const clear = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useAdvanceCanary: () => ({ mutateAsync: advance, isPending: false }),
  useReorderDeployment: () => ({ mutateAsync: reorder, isPending: false }),
  useClearObsoleteDeployments: () => ({ mutateAsync: clear, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { AdvanceCanaryButton, ClearObsoleteDeploymentsButton, ReorderDeploymentControl } =
  await import('./deployment-actions');

function deployment(over: Partial<Deployment> = {}): Deployment {
  return {
    id: 'd1',
    app_id: 'a1',
    image_digest: 'sha256:abc',
    kind: 'github',
    status: 'live',
    created_at: '2026-09-06T10:00:00Z',
    rollback_on_5xx: false,
    first_5xx_count: 0,
    ...over,
  };
}

const canary = (over: Partial<Deployment> = {}) =>
  deployment({
    canary_preset: 'balanced',
    canary_step: 1,
    canary_total_steps: 3,
    rollout_state: 'rolling_out',
    traffic_percent: 10,
    ...over,
  });

beforeEach(() => {
  advance.mockReset().mockResolvedValue({
    deployment: canary({ canary_step: 2, traffic_percent: 50 }),
    audit_id: 'x',
  });
  reorder.mockReset().mockResolvedValue({ id: 'd1', priority: 0 });
  clear.mockReset().mockResolvedValue({ app_slug: 'api', count: 3, older_than: '168h' });
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('AdvanceCanaryButton', () => {
  it('is offered only while a canary is rolling out with steps left', () => {
    const { rerender } = render(<AdvanceCanaryButton deployment={deployment()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<AdvanceCanaryButton deployment={canary({ canary_step: 3 })} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<AdvanceCanaryButton deployment={canary()} />);
    expect(screen.getByRole('button', { name: /advance canary \(1\/3\)/i })).toBeInTheDocument();
  });

  it('sends the step it observed so a stale click is refused, not double-applied', async () => {
    render(<AdvanceCanaryButton deployment={canary()} />);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(advance).toHaveBeenCalledWith({ id: 'd1', expected_step: 1 }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', description: expect.stringContaining('50%') })
    );
  });

  it('explains a 409 canary_step_conflict as the rollout having moved on', async () => {
    advance.mockRejectedValue(
      new ApiError({ status: 409, code: 'canary_step_conflict', title: 'Conflict' })
    );
    render(<AdvanceCanaryButton deployment={canary()} />);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'info', title: 'The rollout moved on' })
    );
  });
});

describe('ReorderDeploymentControl', () => {
  it('is offered only for a deployment still in the queue', () => {
    const { rerender } = render(<ReorderDeploymentControl deployment={deployment()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<ReorderDeploymentControl deployment={deployment({ status: 'pending' })} />);
    expect(screen.getByRole('button', { name: /reorder/i })).toBeInTheDocument();
  });

  it('applies the chosen priority', async () => {
    render(<ReorderDeploymentControl deployment={deployment({ status: 'pending' })} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), '0');
    await userEvent.click(screen.getByRole('button', { name: /reorder/i }));
    await waitFor(() => expect(reorder).toHaveBeenCalledWith({ id: 'd1', priority: 0 }));
  });

  it('reads 402 plan_reorder_disabled as a plan gate, not a failure', async () => {
    reorder.mockRejectedValue(
      new ApiError({ status: 402, code: 'plan_reorder_disabled', title: 'Plan' })
    );
    render(<ReorderDeploymentControl deployment={deployment({ status: 'pending' })} />);
    await userEvent.click(screen.getByRole('button', { name: /reorder/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'info', title: 'Not on your plan' })
    );
  });
});

describe('ClearObsoleteDeploymentsButton', () => {
  it('confirms, then reports how many rows the API removed', async () => {
    render(<ClearObsoleteDeploymentsButton slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /clear obsolete/i }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }))
    );
    await waitFor(() => expect(clear).toHaveBeenCalledWith({ slug: 'api', older_than: '168h' }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Cleared 3 deployments' })
    );
  });

  it('does nothing when the confirm is declined', async () => {
    confirm.mockResolvedValue(false);
    render(<ClearObsoleteDeploymentsButton slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /clear obsolete/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(clear).not.toHaveBeenCalled();
  });
});
