import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { ApprovalPolicy, ApprovalStatus } from '@/lib/api/release-approvals';

const m = vi.hoisted(() => ({
  decide: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  status: null as ApprovalStatus | null,
  policy: null as ApprovalPolicy | null,
  waiting: [] as ApprovalStatus[],
}));

vi.mock('@/lib/api/release-approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/release-approvals')>()),
  useReleaseApproval: () => ({ data: m.status, error: null, isPending: false, refetch: vi.fn() }),
  useApprovalPolicy: () => ({ data: m.policy, error: null, isPending: false, refetch: vi.fn() }),
  useWaitingApprovals: () => ({ data: m.waiting, error: null, isPending: false, refetch: vi.fn() }),
  useDecideRelease: () => ({ mutateAsync: m.decide, isPending: false }),
  useSetApprovalPolicy: () => ({ mutateAsync: m.save, isPending: false }),
  useRemoveApprovalPolicy: () => ({ mutateAsync: m.remove, isPending: false }),
}));
vi.mock('@/lib/api/notification-channels', () => ({
  useNotificationChannels: () => ({
    data: [{ id: 'c1', name: 'releases', kind: 'slack', target: 'T', created_at: '' }],
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityStage: () => 'Preview' }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => m.confirm }));

const { ReleaseApproval, ReleaseApprovals } = await import('./release-approvals');

const waiting = (over: Partial<ApprovalStatus> = {}): ApprovalStatus => ({
  deployment_id: 'd'.repeat(32),
  app: 'shop',
  state: 'waiting',
  required_approvals: 2,
  approvals: 1,
  after_stage: 1,
  deployed_by: 'mira@acme.dev',
  waiting_since: '2026-11-03T10:00:00Z',
  expires_at: '2026-11-04T10:00:00Z',
  decisions: [
    {
      approver: 'poyraz@acme.dev',
      role: 'admin',
      decision: 'approve',
      comment: 'canary looks clean',
      counted: true,
      decided_at: '2026-11-03T10:05:00Z',
    },
  ],
  ...over,
});
const problem = (status: number, code: string) => new ApiError({ status, code, title: code });

beforeEach(() => {
  m.decide.mockReset().mockResolvedValue(waiting({ state: 'approved', approvals: 2 }));
  m.save.mockReset().mockResolvedValue({});
  m.remove.mockReset().mockResolvedValue(undefined);
  m.toast.mockReset();
  m.confirm.mockReset().mockResolvedValue(true);
  m.status = waiting();
  m.policy = null;
  m.waiting = [];
});

describe('ReleaseApproval', () => {
  it('shows where the release waits and who decided', () => {
    render(<ReleaseApproval deploymentId={'d'.repeat(32)} release="v44" />);
    const section = screen.getByRole('region', { name: 'Release approval' });
    expect(section).toHaveTextContent('Waiting for approval');
    expect(section).toHaveTextContent('1 of 2 approvals');
    expect(section).toHaveTextContent('deployed by mira@acme.dev');
    expect(
      within(screen.getByRole('list', { name: 'Decisions' })).getByText('poyraz@acme.dev')
    ).toBeInTheDocument();
  });

  it('approves only after a confirmation saying the release takes more traffic', async () => {
    render(<ReleaseApproval deploymentId={'d'.repeat(32)} release="v44" />);
    m.confirm.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(m.decide).not.toHaveBeenCalled();
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Approve shop v44?',
        description: expect.stringMatching(/1 still missing.*takes more production traffic/s),
      })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(m.decide).toHaveBeenCalledWith({
        id: 'd'.repeat(32),
        decision: 'approve',
        comment: undefined,
      })
    );
  });

  it('asks for a reason, then rejects after a destructive confirmation', async () => {
    render(<ReleaseApproval deploymentId={'d'.repeat(32)} release="v44" />);
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(m.confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reject release' }));
    expect(screen.getByText(/A rejection needs a reason/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Reason for rejecting'), 'latency is up');
    await userEvent.click(screen.getByRole('button', { name: 'Reject release' }));
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/rollout is aborted at once.*final/s),
      })
    );
    await waitFor(() =>
      expect(m.decide).toHaveBeenCalledWith({
        id: 'd'.repeat(32),
        decision: 'reject',
        comment: 'latency is up',
      })
    );
  });

  it('opens on the reason when the notification’s Reject button led here', () => {
    render(<ReleaseApproval deploymentId={'d'.repeat(32)} release="v44" intent="reject" />);
    expect(screen.getByLabelText('Reason for rejecting')).toBeInTheDocument();
    expect(m.decide).not.toHaveBeenCalled();
  });

  it('explains the deployer’s own approval and a decision that came too late', async () => {
    m.decide.mockRejectedValueOnce(problem(403, 'release_approval_self'));
    render(<ReleaseApproval deploymentId={'d'.repeat(32)} release="v44" />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(m.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'You deployed this release' })
      )
    );
    m.decide.mockRejectedValueOnce(problem(409, 'release_approval_decided'));
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(m.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'Decision not accepted' })
      )
    );
  });

  it('offers no decision once the release is decided', () => {
    m.status = waiting({ state: 'rejected' });
    render(<ReleaseApproval deploymentId={'d'.repeat(32)} release="v44" />);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});

describe('ReleaseApprovals (policy)', () => {
  it('requires approvals after a confirmation that names the stage, approvers and timeout', async () => {
    render(<ReleaseApprovals slug="shop" />);
    expect(screen.getByText('shop does not require approvals.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Require approvals' }));
    const form = screen.getByRole('form', { name: 'Approval policy' });
    await userEvent.click(within(form).getByRole('button', { name: 'Require approvals' }));
    expect(within(form).getByText(/Name at least one channel/)).toBeInTheDocument();
    await userEvent.click(within(form).getByLabelText(/releases/));
    await userEvent.clear(within(form).getByLabelText('People who must approve'));
    await userEvent.type(within(form).getByLabelText('People who must approve'), '2');
    await userEvent.click(within(form).getByRole('button', { name: 'Require approvals' }));
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Require release approvals for shop?',
        description: expect.stringMatching(
          /stage 1 until 2 owners and admins other than the deployer.*1 d/s
        ),
      })
    );
    await waitFor(() =>
      expect(m.save).toHaveBeenCalledWith({
        required_approvals: 2,
        after_stage: 1,
        timeout_minutes: 1440,
        approvers: 'admin',
        allow_self_approval: false,
        notify_channels: ['releases'],
      })
    );
  });

  it('explains a plan without canaries', async () => {
    m.save.mockRejectedValueOnce(problem(403, 'plan_traffic_split_not_allowed'));
    render(<ReleaseApprovals slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Require approvals' }));
    const form = screen.getByRole('form', { name: 'Approval policy' });
    await userEvent.click(within(form).getByLabelText(/releases/));
    await userEvent.click(within(form).getByRole('button', { name: 'Require approvals' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/Pro or Scale/);
  });

  it('removes a policy after saying waiting releases continue', async () => {
    m.policy = {
      app: 'shop',
      required_approvals: 1,
      after_stage: 2,
      timeout_minutes: 240,
      approvers: 'developer',
      allow_self_approval: false,
      notify_channels: ['releases'],
      updated_by: 'me',
      created_at: '',
      updated_at: '2026-11-01T00:00:00Z',
    };
    m.waiting = [waiting()];
    render(<ReleaseApprovals slug="shop" />);
    expect(screen.getByText(/1 from owners, admins and developers/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review and decide' })).toHaveAttribute(
      'href',
      `/dashboard/releases/${'d'.repeat(32)}/approval`
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/continue on the canary’s next step/),
      })
    );
    await waitFor(() => expect(m.remove).toHaveBeenCalled());
  });
});
