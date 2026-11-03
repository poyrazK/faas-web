import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { EnvironmentReadiness, promotionFailure } from './environment-readiness';
import {
  usePromotionPreview,
  usePromotionHistory,
  usePromotionReceipt,
  useApprovalReceipt,
} from '@/lib/api/environment-readiness';
vi.mock('@/lib/api/environment-readiness', () => ({
  usePromotionPreview: vi.fn(),
  usePromotionHistory: vi.fn(),
  usePromotionReceipt: vi.fn(),
  useApprovalReceipt: vi.fn(),
}));
const promote = vi.fn();
const rollback = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();
vi.mock('@/lib/api/environments', () => ({
  StalePromotionPreview: class StalePromotionPreview extends Error {},
  usePromoteEnvironment: () => ({ mutateAsync: promote, isPending: false }),
  useRollbackPromotion: () => ({ mutateAsync: rollback, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
afterEach(() => vi.resetAllMocks());
const identity = { accountId: 'a', projectId: 'p', project: 'shop', target: 'production' };
const ready = { isPending: false, isFetching: false, error: null, refetch: vi.fn() };
const hash = 'a'.repeat(64);
const preview = {
  project_slug: 'shop',
  from_environment: 'staging',
  to_environment: 'production',
  can_promote: true,
  approval_required: true,
  qualification_required: true,
  release_graph_mode: true,
  promotion_hash: hash,
  blocking_reasons: [],
  config: { fromVersion: 3, toVersion: 4, sourceHash: hash, targetHash: hash },
  changes: [
    {
      workload_slug: 'api',
      workload_name: 'api',
      kind: 'update',
      source_revision: 'exact-source',
      target_revision: 'exact-target',
    },
  ],
  qualification: {
    id: 'q',
    status: 'passed',
    release_set_id: 'release',
    environment: 'staging',
    configuration_version: 3,
    configuration_hash: hash,
    secret_revision_hashes: { api: hash },
    created_at: '2026-10-10T00:00:00Z',
    expires_at: '2026-10-11T00:00:00Z',
    checks: [],
  },
};
function setup() {
  vi.mocked(usePromotionPreview).mockReturnValue({ ...ready, data: preview } as never);
  vi.mocked(usePromotionHistory).mockReturnValue({
    ...ready,
    data: {
      items: [
        {
          promotion_id: 'op',
          project_slug: 'shop',
          from_environment: 'staging',
          to_environment: 'production',
          status: 'failed',
          promotion_hash: hash,
          created_at: '2026-10-12T00:00:00Z',
          updated_at: '2026-10-12T00:00:00Z',
        },
      ],
      nextBefore: 'opaque',
    },
  } as never);
  vi.mocked(usePromotionReceipt).mockReturnValue({ ...ready, data: undefined } as never);
  vi.mocked(useApprovalReceipt).mockReturnValue({ ...ready, data: undefined } as never);
}
it('shows preview identities without treating can_promote as console authorization', () => {
  setup();
  render(<EnvironmentReadiness identity={identity} source="staging" onSearch={vi.fn()} />);
  expect(screen.getByText('exact-source')).toBeVisible();
  expect(screen.getByText(/q · passed/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Promote staging to production' })).toBeEnabled();
  expect(screen.getByText(/approves this exact preview as you/)).toBeVisible();
});
it('promotes the reviewed preview after saying what changes, approving a protected target', async () => {
  setup();
  confirm.mockResolvedValue(true);
  promote.mockResolvedValue({ promotion_id: 'new-op', status: 'running' });
  const onSearch = vi.fn();
  render(<EnvironmentReadiness identity={identity} source="staging" onSearch={onSearch} />);
  await userEvent.click(screen.getByRole('button', { name: 'Promote staging to production' }));
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      confirmLabel: 'Approve and promote',
      description: expect.stringMatching(/1 of 1 workload change.*protected.*rolls back by itself/),
    })
  );
  await waitFor(() =>
    expect(promote).toHaveBeenCalledWith({
      source: 'staging',
      promotionHash: hash,
      key: expect.any(String),
    })
  );
  expect(onSearch).toHaveBeenCalledWith({ promotion: 'new-op' });
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Promotion accepted' }));
});
it('sends nothing when the promotion is not confirmed, and retries with the same key', async () => {
  setup();
  confirm.mockResolvedValueOnce(false).mockResolvedValue(true);
  promote.mockRejectedValueOnce(new Error('network')).mockResolvedValue({
    promotion_id: 'op',
    status: 'succeeded',
  });
  render(<EnvironmentReadiness identity={identity} source="staging" onSearch={vi.fn()} />);
  const button = screen.getByRole('button', { name: 'Promote staging to production' });
  await userEvent.click(button);
  expect(promote).not.toHaveBeenCalled();
  await userEvent.click(button);
  await userEvent.click(button);
  await waitFor(() => expect(promote).toHaveBeenCalledTimes(2));
  expect(promote.mock.calls[0][0].key).toBe(promote.mock.calls[1][0].key);
});
it('refreshes a stale preview by its code instead of retrying blind', async () => {
  setup();
  const refetch = vi.fn();
  vi.mocked(usePromotionPreview).mockReturnValue({ ...ready, refetch, data: preview } as never);
  confirm.mockResolvedValue(true);
  promote.mockRejectedValue(
    new ApiError({ status: 409, code: 'project_environment_approval_invalid', title: 'Stale' })
  );
  render(<EnvironmentReadiness identity={identity} source="staging" onSearch={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Promote staging to production' }));
  await waitFor(() => expect(refetch).toHaveBeenCalled());
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'The preview is out of date' })
  );
});
it.each([
  ['release_approval_self', /someone else/i],
  ['release_frozen', /freeze/i],
  ['project_promotion_queue_full', /queued/i],
  ['validation_failed', /blocked/i],
])('explains a promotion refused with %s', (code, title) => {
  expect(promotionFailure(new ApiError({ status: 409, code, title: 'x' })).title).toMatch(title);
});
it('keeps blockers and missing qualification explicit', () => {
  setup();
  vi.mocked(usePromotionPreview).mockReturnValue({
    ...ready,
    data: {
      ...preview,
      can_promote: false,
      qualification: undefined,
      blocking_reasons: ['Qualification missing'],
    },
  } as never);
  render(<EnvironmentReadiness identity={identity} source="staging" onSearch={vi.fn()} />);
  expect(screen.getByText('Qualification missing')).toBeVisible();
  expect(screen.getByText(/No qualification receipt returned/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Promote staging to production' })).toBeDisabled();
});
it('shows partial application and failed verification/rollback independently', () => {
  setup();
  vi.mocked(usePromotionReceipt).mockReturnValue({
    ...ready,
    data: {
      promotion_id: 'op',
      project_slug: 'shop',
      from_environment: 'staging',
      to_environment: 'production',
      promotion_hash: hash,
      status: 'failed',
      verification_status: 'failed',
      rollback_status: 'rollback_failed',
      created_at: '2026-10-12T00:00:00Z',
      updated_at: '2026-10-12T00:00:00Z',
      workloads: [
        {
          workload_slug: 'api',
          status: 'promoted',
          verification_status: 'failed',
          rollback_status: 'failed',
        },
      ],
    },
  } as never);
  render(
    <EnvironmentReadiness identity={identity} source="staging" operation="op" onSearch={vi.fn()} />
  );
  expect(screen.getByText(/Recorded application: promoted/)).toBeVisible();
  expect(screen.getAllByText(/Verification: failed/)).toHaveLength(2);
  expect(screen.getByText(/Rollback: rollback_failed/)).toBeVisible();
  expect(screen.getByText(/Rollback: failed/)).toBeVisible();
  expect(screen.getByText(/disconnect is not permission to restart/)).toBeVisible();
});
it('rolls back a finished promotion only after a destructive confirmation', async () => {
  setup();
  confirm.mockResolvedValue(true);
  rollback.mockResolvedValue({});
  vi.mocked(usePromotionReceipt).mockReturnValue({
    ...ready,
    data: {
      promotion_id: 'op',
      project_slug: 'shop',
      from_environment: 'staging',
      to_environment: 'production',
      promotion_hash: hash,
      status: 'succeeded',
      created_at: '2026-10-12T00:00:00Z',
      updated_at: '2026-10-12T00:00:00Z',
      workloads: [],
    },
  } as never);
  render(
    <EnvironmentReadiness identity={identity} source="staging" operation="op" onSearch={vi.fn()} />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Roll back this promotion' }));
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      destructive: true,
      description: expect.stringMatching(/returns to the deployment it served before/),
    })
  );
  await waitFor(() => expect(rollback).toHaveBeenCalledWith({ promotion: 'op' }));
});
it('offers no rollback while a promotion is still running', () => {
  setup();
  vi.mocked(usePromotionReceipt).mockReturnValue({
    ...ready,
    data: {
      promotion_id: 'op',
      project_slug: 'shop',
      from_environment: 'staging',
      to_environment: 'production',
      promotion_hash: hash,
      status: 'running',
      created_at: '2026-10-12T00:00:00Z',
      updated_at: '2026-10-12T00:00:00Z',
      workloads: [],
    },
  } as never);
  render(
    <EnvironmentReadiness identity={identity} source="staging" operation="op" onSearch={vi.fn()} />
  );
  expect(screen.queryByRole('button', { name: 'Roll back this promotion' })).toBeNull();
});
it.each(['error', 'refreshing', 'foreign'] as const)('hides stale preview during %s', (phase) => {
  setup();
  vi.mocked(usePromotionPreview).mockReturnValue({
    ...ready,
    error: phase === 'error' ? new Error('denied') : null,
    isFetching: phase === 'refreshing',
    data: phase === 'foreign' ? { ...preview, to_environment: 'other' } : preview,
  } as never);
  render(<EnvironmentReadiness identity={identity} source="staging" onSearch={vi.fn()} />);
  expect(screen.queryByText('exact-source')).not.toBeInTheDocument();
});
it('uses URL navigation for history/filter changes, resetting dependent cursors', () => {
  setup();
  const change = vi.fn();
  render(<EnvironmentReadiness identity={identity} source="staging" onSearch={change} />);
  fireEvent.click(screen.getByRole('button', { name: 'Older operations' }));
  expect(change).toHaveBeenCalledWith({ promotionBefore: 'opaque', promotion: undefined });
  fireEvent.change(screen.getByLabelText('Recorded status'), { target: { value: 'failed' } });
  expect(change).toHaveBeenCalledWith({
    promotionStatus: 'failed',
    promotionBefore: undefined,
    promotion: undefined,
  });
});
it('inspects a known expired approval without exposing a token input', () => {
  setup();
  vi.mocked(useApprovalReceipt).mockReturnValue({
    ...ready,
    data: {
      approval_id: 'approval',
      environment: 'production',
      token_kind: 'promotion',
      status: 'expired',
      expires_at: '2026-10-11T00:00:00Z',
    },
  } as never);
  render(
    <EnvironmentReadiness
      identity={identity}
      source="staging"
      approval="approval"
      onSearch={vi.fn()}
    />
  );
  expect(screen.getByText(/Approval state: expired/)).toBeVisible();
  expect(screen.queryByLabelText(/approval token/i)).not.toBeInTheDocument();
});
