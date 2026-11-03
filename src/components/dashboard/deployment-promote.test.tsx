import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';

const promote = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
const capability = vi.fn();
const serving = vi.fn();
const refetchServing = vi.fn();

vi.mock('@/lib/api/deployment-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/deployment-detail')>()),
  usePromoteDeployment: () => ({ mutateAsync: promote, isPending: false }),
  useServingRows: (...args: unknown[]) => serving(...args) as unknown,
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

const SERVING_ID = 'b1b2b3b4-0000-4000-8000-000000000043';
const servingRow = (over: Partial<Deployment> = {}) =>
  deployment({ id: SERVING_ID, revision: 43, traffic_percent: 100, ...over });
const servingRead = (rows: Deployment[], over: Record<string, unknown> = {}) => ({
  data: { rows, complete: true },
  error: null,
  isPending: false,
  isFetching: false,
  refetch: refetchServing,
  ...over,
});

beforeEach(() => {
  promote
    .mockReset()
    .mockResolvedValue({ from_percent: 0, to_percent: 100, already_promoted: false });
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  capability.mockReset().mockReturnValue(available);
  refetchServing.mockReset().mockResolvedValue({});
  serving.mockReset().mockReturnValue(servingRead([servingRow()]));
});

describe('PromoteDeployment', () => {
  it('is offered only for a live release that does not already serve everything', () => {
    const { rerender } = render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
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
      rerender(<PromoteDeployment slug="alpha" deployment={deployment(over)} />);
      expect(screen.queryByRole('button', { name: /promote/i })).not.toBeInTheDocument();
    }
  });

  it('names what moves before promoting, then reports the traffic receipt', async () => {
    render(<PromoteDeployment slug="alpha" deployment={deployment({ traffic_percent: 10 })} />);
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
    render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
    await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
    expect(promote).not.toHaveBeenCalled();
  });

  it('uses the strict route when application acknowledgements are required, and says what that means', async () => {
    render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
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
    render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
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
      render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
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
    render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
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
    render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
    expect(capability).toHaveBeenCalledWith('progressive-rollouts');
    expect(screen.queryByRole('button', { name: /promote/i })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/not included in your plan/i);
    // Nothing is read for a promotion the account cannot make.
    expect(serving).toHaveBeenCalledWith('alpha', 'default', { enabled: false });
  });

  describe('serving pin', () => {
    it('reads what serves in the release’s own scope', () => {
      render(<PromoteDeployment slug="alpha" deployment={deployment({ scope: 'canary' })} />);
      expect(serving).toHaveBeenCalledWith('alpha', 'canary', { enabled: true });
    });

    it('names the release serving all traffic and pins the promotion to it', async () => {
      render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
      expect(screen.getByText(/serves all traffic now/i)).toHaveTextContent('v43');
      await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/pinned to v43/i) })
      );
      expect(promote).toHaveBeenCalledWith({
        id: 'd2c4e6f8-0000-4000-8000-000000000001',
        requireApplicationAck: false,
        expectedServingDeploymentId: SERVING_ID,
      });
    });

    it('pins on the strict route too', async () => {
      render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
      await userEvent.click(
        screen.getByRole('checkbox', { name: /require application acknowledgements/i })
      );
      await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
      expect(promote).toHaveBeenCalledWith(
        expect.objectContaining({
          requireApplicationAck: true,
          expectedServingDeploymentId: SERVING_ID,
        })
      );
    });

    it('says a split cannot be pinned, and promotes without a pin', async () => {
      serving.mockReturnValue(
        servingRead([
          servingRow({ traffic_percent: 60 }),
          deployment({ id: 'c3', revision: 42, traffic_percent: 40 }),
        ])
      );
      render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
      const note = screen.getByText(/traffic is split/i);
      expect(note).toHaveTextContent('v43 60%');
      expect(note).toHaveTextContent('v42 40%');
      expect(note).toHaveTextContent(/not pinned/i);
      await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
      expect(promote).toHaveBeenCalledWith({
        id: 'd2c4e6f8-0000-4000-8000-000000000001',
        requireApplicationAck: false,
      });
    });

    it.each([
      [{ rows: [], complete: true }, /no other release serves/i],
      [{ rows: [], complete: false }, /could not account for/i],
    ])('explains why nothing is pinned (%#)', (data, pattern) => {
      serving.mockReturnValue(servingRead([], { data }));
      render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
      expect(screen.getByText(pattern)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /promote v44/i })).toBeEnabled();
    });

    it('waits for the serving read before offering the promotion', () => {
      serving.mockReturnValue(servingRead([], { data: undefined, isPending: true }));
      render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
      expect(screen.getByRole('status')).toHaveTextContent(/reading which release serves/i);
      expect(screen.getByRole('button', { name: /promote v44/i })).toBeDisabled();
    });

    it('will not promote unpinned when the serving read fails', async () => {
      serving.mockReturnValue(
        servingRead([], {
          data: undefined,
          error: new ApiError({ status: 500, code: 'internal', title: 'Internal error' }),
        })
      );
      render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
      expect(screen.getByRole('button', { name: /promote v44/i })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(refetchServing).toHaveBeenCalled();
    });

    it('says another release took over when the pin is stale, and offers a refresh', async () => {
      promote.mockRejectedValue(
        new ApiError({
          status: 409,
          code: 'traffic_serving_changed',
          title: 'Production revision changed',
          detail: 'the expected revision is no longer the sole 100% serving deployment',
        })
      );
      render(<PromoteDeployment slug="alpha" deployment={deployment()} />);
      await userEvent.click(screen.getByRole('button', { name: /promote v44/i }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/another release took over/i);
      expect(alert).toHaveTextContent(/v43 no longer serves all/i);
      expect(alert).toHaveTextContent(/nothing moved/i);
      expect(toast).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
      expect(refetchServing).toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
  });
});
