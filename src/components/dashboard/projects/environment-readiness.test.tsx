import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EnvironmentReadiness } from './environment-readiness';
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
  expect(screen.getByRole('button', { name: 'Promote' })).toBeDisabled();
  expect(screen.getByText(/separate isolated staging qualification/)).toBeVisible();
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
