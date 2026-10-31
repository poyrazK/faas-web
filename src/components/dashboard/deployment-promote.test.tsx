import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';

const promote = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
const capability = vi.fn();

vi.mock('@/lib/api/deployment-detail', () => ({
  usePromoteDeployment: () => ({ mutateAsync: promote, isPending: false }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => capability(key) as unknown,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { PromoteDeployment } = await import('./deployment-promote');

function deployment(over: Partial<Deployment> = {}): Deployment {
  return {
    id: 'd2c4e6f8-0000-4000-8000-000000000001',
    app_id: 'a1',
    image_digest: 'sha256:abc',
    kind: 'github',
    status: 'live',
    revision: 44,
    traffic_percent: 0,
    created_at: '2026-10-31T10:00:00Z',
    ...over,
  };
}

const available = { accountId: 'acc', state: 'available', refresh: vi.fn() };

beforeEach(() => {
  promote
    .mockReset()
    .mockResolvedValue({ from_percent: 0, to_percent: 100, already_promoted: false });
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  capability.mockReset().mockReturnValue(available);
});

describe('PromoteDeployment', () => {
  it('is offered only for a live release that does not already serve everything', () => {
    const { rerender } = render(<PromoteDeployment deployment={deployment()} />);
    expect(screen.getByRole('button', { name: /promote v44/i })).toBeInTheDocument();
    const cases: Partial<Deployment>[] = [
      { status: 'superseded' },
      { traffic_percent: 100 },
      { rollout_state: 'rolling_out' },
      {
        scheduled_release: {
          id: 's',
          app: 'a',
          deployment_id: 'd',
          release_at: '2026-11-01T00:00:00Z',
          state: 'scheduled' as const,
          notify_channels: [],
          scheduled_by: 'x',
          created_at: '',
          updated_at: '',
        },
      },
    ];
    for (const over of cases) {
      rerender(<PromoteDeployment deployment={deployment(over)} />);
      expect(screen.queryByRole('button', { name: /promote/i })).not.toBeInTheDocument();
    }
  });

  it('names what moves before promoting, then reports the traffic receipt', async () => {
    render(<PromoteDeployment deployment={deployment({ traffic_percent: 10 })} />);
    await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Move all traffic to v44?',
        description: expect.stringMatching(/from 10% to 100%.*every other live release.*0%/s),
      })
    );
    expect(promote).toHaveBeenCalledWith({
      id: 'd2c4e6f8-0000-4000-8000-000000000001',
      requireApplicationAck: false,
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'v44 now serves all traffic' })
      )
    );
  });

  it('does nothing when the confirmation is dismissed', async () => {
    confirm.mockResolvedValue(false);
    render(<PromoteDeployment deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
    expect(promote).not.toHaveBeenCalled();
  });

  it('uses the strict route when application acknowledgements are required, and says what that means', async () => {
    render(<PromoteDeployment deployment={deployment()} />);
    expect(screen.getByText(/self-attestations/i)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('checkbox', { name: /require application acknowledgements/i })
    );
    await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/acknowledg/i) })
    );
    expect(promote).toHaveBeenCalledWith(expect.objectContaining({ requireApplicationAck: true }));
  });

  it('lists binding blockers when the check fails and traffic is unchanged', async () => {
    promote.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'bindings_check_failed',
        title: 'Bindings check failed',
        detail: 'Resolve the binding check blockers and verify this deployment before promoting.',
        bindings_check: {
          app: 'alpha',
          scope: 'default',
          deployment_id: 'd',
          checked_at: '',
          inventory_generated_at: '',
          max_verification_age: '10m',
          allow_unsupported: false,
          passed: false,
          coverage: 'partial',
          bindings: [],
          runtime: [],
          issues: [],
          blockers: [
            {
              code: 'application_ack_missing',
              binding: 'orders-db',
              message: 'No application acknowledgement for the current secret version.',
            },
          ],
          warnings: [],
        },
      })
    );
    render(<PromoteDeployment deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/traffic is unchanged/i);
    expect(alert).toHaveTextContent('orders-db');
    expect(alert).toHaveTextContent('No application acknowledgement');
  });

  it.each([
    [
      'an older server’s plain 404',
      new ApiError({ status: 404, code: 'http_404', title: 'Not Found' }),
      /does not support strict promotion/i,
    ],
    [
      'a current server’s missing release',
      new ApiError({
        status: 404,
        code: 'not_found',
        title: 'Deployment not found',
        detail: 'No such deployment.',
      }),
      /no longer exists/i,
    ],
  ])(
    'reads %s on the strict route and never retries the ordinary route',
    async (_, err, pattern) => {
      promote.mockRejectedValue(err);
      render(<PromoteDeployment deployment={deployment()} />);
      await userEvent.click(
        screen.getByRole('checkbox', { name: /require application acknowledgements/i })
      );
      await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'error', description: expect.stringMatching(pattern) })
        )
      );
      expect(toast).not.toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringMatching(
            pattern.source.includes('strict') ? /no longer exists/i : /strict promotion/i
          ),
        })
      );
      expect(promote).toHaveBeenCalledOnce();
    }
  );

  it.each([
    ['plan_traffic_split_not_allowed', /plan/i],
    ['traffic_change_during_canary', /canary/i],
  ])('explains %s', async (code, pattern) => {
    promote.mockRejectedValue(new ApiError({ status: 409, code, title: code, detail: 'x' }));
    render(<PromoteDeployment deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(pattern) })
      )
    );
  });

  it('shows the capability notice instead of the action when progressive rollouts are off', () => {
    capability.mockReturnValue({
      accountId: 'acc',
      state: 'plan-not-entitled',
      capability: { maturity: 'beta', docs_url: '/docs/deploys' },
      refresh: vi.fn(),
    });
    render(<PromoteDeployment deployment={deployment()} />);
    expect(capability).toHaveBeenCalledWith('progressive-rollouts');
    expect(screen.queryByRole('button', { name: /promote/i })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/not included in your plan/i);
  });
});
