import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';

const recover = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useRecoverRollout: () => ({ mutateAsync: recover, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { RolloutRecovery, isRolloutInFlight } = await import('./rollout-recovery');

function deployment(over: Partial<Deployment> = {}): Deployment {
  return {
    id: 'd1',
    app_id: 'a1',
    image_digest: 'sha256:x',
    kind: 'github',
    status: 'live',
    created_at: '2026-09-08T09:00:00Z',
    rollback_on_5xx: false,
    first_5xx_count: 0,
    rollout_state: 'rolling_out',
    canary_step: 1,
    canary_total_steps: 3,
    ...over,
  };
}

beforeEach(() => {
  recover.mockReset().mockResolvedValue({ deployment: deployment(), audit_id: 'aud12345678901' });
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('isRolloutInFlight', () => {
  it('is true only while the rollout has not finished', () => {
    expect(isRolloutInFlight(deployment({ rollout_state: 'rolling_out' }))).toBe(true);
    expect(isRolloutInFlight(deployment({ rollout_state: 'pending' }))).toBe(true);
    expect(isRolloutInFlight(deployment({ rollout_state: 'complete' }))).toBe(false);
    expect(isRolloutInFlight(deployment({ rollout_state: 'aborted' }))).toBe(false);
  });
});

describe('RolloutRecovery', () => {
  it('renders nothing once the rollout is over', () => {
    const { container } = render(
      <RolloutRecovery slug="api" deployment={deployment({ rollout_state: 'complete' })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('repeats the API’s own words when advancing a healthy rollout is refused', async () => {
    recover.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'rollout_not_stuck',
        title: 'Not stuck',
        detail: 'the rollout is still progressing; use promote instead to ship it now.',
      })
    );
    render(<RolloutRecovery slug="api" deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: /advance/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'info',
        description: expect.stringContaining('use promote instead'),
      })
    );
  });

  it('confirms a promote and reports the audit row', async () => {
    render(<RolloutRecovery slug="api" deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: /promote to 100/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() => expect(recover).toHaveBeenCalledWith({ action: 'promote' }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('aud12345678') })
    );
  });

  it('sends the typed reason with an abort', async () => {
    render(<RolloutRecovery slug="api" deployment={deployment()} />);
    await userEvent.type(screen.getByLabelText('Abort reason'), 'errors on the canary');
    await userEvent.click(screen.getByRole('button', { name: /^abort$/i }));
    await waitFor(() =>
      expect(recover).toHaveBeenCalledWith({ action: 'abort', reason: 'errors on the canary' })
    );
  });
});
