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
vi.mock('@/lib/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/queries')>()),
  useAppDeployments: () => ({
    data: { pages: [{ items: [{ id: 'd'.repeat(32), revision: 44 }] }] },
  }),
}));
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
  it('requires approvals from a sheet, after a confirmation that names the stage, approvers and timeout', async () => {
    render(<ReleaseApprovals slug="shop" />);
    expect(screen.getByText('New versions don’t wait for anyone’s approval.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Approval policy' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Require approval' }));
    const sheet = screen.getByRole('dialog', { name: 'Require approval for shop' });
    const form = within(sheet).getByRole('form', { name: 'Approval policy' });
    // Where the rollout pauses and the timeout sit under Advanced.
    expect(within(form).getByLabelText('Wait at canary stage')).not.toBeVisible();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Require approvals' }));
    expect(within(form).getByText(/Name at least one channel/)).toBeInTheDocument();
    await userEvent.click(within(form).getByLabelText(/releases/));
    await userEvent.clear(within(form).getByLabelText('People who must approve'));
    await userEvent.type(within(form).getByLabelText('People who must approve'), '2');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Require approvals' }));
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

  it('opens Advanced when one of its fields is refused', async () => {
    render(<ReleaseApprovals slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Require approval' }));
    const sheet = screen.getByRole('dialog');
    await userEvent.click(within(sheet).getByLabelText(/releases/));
    const stage = within(sheet).getByLabelText('Wait at canary stage');
    await userEvent.click(within(sheet).getByText('Advanced'));
    await userEvent.clear(stage);
    await userEvent.type(stage, '11');
    await userEvent.click(within(sheet).getByText('Advanced'));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Require approvals' }));
    expect(stage).toBeVisible();
    expect(within(sheet).getByText('A stage from 1 to 10.')).toBeInTheDocument();
    expect(m.confirm).not.toHaveBeenCalled();
  });

  it('explains a plan without canaries', async () => {
    m.save.mockRejectedValueOnce(problem(403, 'plan_traffic_split_not_allowed'));
    render(<ReleaseApprovals slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Require approval' }));
    const sheet = screen.getByRole('dialog');
    await userEvent.click(within(sheet).getByLabelText(/releases/));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Require approvals' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(/Pro or Scale/);
  });

  it('says what the policy does, lists waiting versions by name, and removes it from the sheet', async () => {
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
    const card = screen.getByRole('region', { name: 'Approvals' });
    expect(card).toHaveTextContent(
      'New versions pause partway through their rollout until an owner, admin or developer approves them.'
    );
    expect(card).toHaveTextContent('Waiting');
    // The stage, timeout and channels are one click away.
    expect(screen.getByText('Canary stage 2')).not.toBeVisible();
    await userEvent.click(screen.getByText('Show details'));
    expect(screen.getByText('Canary stage 2')).toBeVisible();
    expect(screen.getByText('4 h, then the version is rolled back')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review v44' })).toHaveAttribute(
      'href',
      `/dashboard/releases/${'d'.repeat(32)}/approval`
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change approval' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop requiring approval' }));
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/continue on the canary’s next step/),
      })
    );
    await waitFor(() => expect(m.remove).toHaveBeenCalled());
  });
});
