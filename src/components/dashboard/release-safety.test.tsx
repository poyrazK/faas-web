import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalPolicy, ApprovalStatus } from '@/lib/api/release-approvals';
import type { FreezeOwner, ReleaseFreeze } from '@/lib/api/release-freezes';
import type { ScheduledRelease } from '@/lib/api/scheduled-releases';

type Read<T> = { data: T | undefined; error: unknown; isPending: boolean; refetch: () => void };
const read = <T,>(data: T): Read<T> => ({
  data,
  error: null,
  isPending: false,
  refetch: vi.fn(),
});

const m = vi.hoisted(() => ({
  access: {} as Record<string, string>,
  workspace: { org: null as string | null, label: 'Personal', ready: true },
  freezesFor: vi.fn(),
  schedulesFor: vi.fn(),
  approvalsFor: vi.fn(),
  gatesFor: vi.fn(),
  enabled: {} as Record<string, boolean | undefined>,
  lift: vi.fn(),
  status: null as unknown as Read<unknown>,
  policy: null as unknown as Read<unknown>,
  waiting: null as unknown as Read<unknown>,
  schedules: null as unknown as Read<unknown>,
}));

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({ access: m.access[id] ?? 'on', refresh: vi.fn() }),
  useCapabilityStage: () => 'Preview',
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => m.workspace }));
vi.mock('@/lib/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/queries')>()),
  useAppDeployments: () => ({
    data: { pages: [{ items: [{ id: 'dep-44-aaaaaaaa', revision: 44 }] }] },
  }),
}));
vi.mock('@/lib/api/release-freezes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/release-freezes')>()),
  useFreezeStatus: (_slug: string, enabled: boolean) => {
    m.enabled.freezes = enabled;
    return m.status;
  },
}));
vi.mock('@/lib/api/release-approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/release-approvals')>()),
  useApprovalPolicy: (_slug: string, enabled: boolean) => {
    m.enabled.policy = enabled;
    return m.policy;
  },
  useWaitingApprovals: (_slug: string, enabled: boolean) => {
    m.enabled.waiting = enabled;
    return m.waiting;
  },
}));
vi.mock('@/lib/api/scheduled-releases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/scheduled-releases')>()),
  useScheduledReleases: (_app: string, enabled: boolean) => {
    m.enabled.schedules = enabled;
    return m.schedules;
  },
}));
// The cards' own reads are covered beside them; here only what mounts matters.
vi.mock('./release-freezes', () => ({
  ReleaseFreezes: ({ owner }: { owner: FreezeOwner }) => {
    m.freezesFor(owner);
    return <p>freezes for {JSON.stringify(owner)}</p>;
  },
  useLiftFreeze: () => ({ busy: null, lift: m.lift }),
}));
vi.mock('./release-approvals', () => ({
  ReleaseApprovals: ({ slug }: { slug: string }) => {
    m.approvalsFor(slug);
    return <p>approvals for {slug}</p>;
  },
}));
vi.mock('./release-gates', () => ({
  ReleaseGates: ({ slug }: { slug: string }) => {
    m.gatesFor(slug);
    return <p>gates for {slug}</p>;
  },
}));
vi.mock('./release-schedule', () => ({
  ScheduledReleases: ({ app }: { app?: string }) => {
    m.schedulesFor(app);
    return <p>schedules for {app ?? 'account'}</p>;
  },
}));

const { ReleaseSafety, WorkspaceReleaseGuards } = await import('./release-safety');

const freeze = (over: Partial<ReleaseFreeze> = {}): ReleaseFreeze => ({
  id: 'f1',
  app: 'shop',
  kind: 'window',
  starts_at: '2026-11-03T10:00:00Z',
  reason: 'incident 4711',
  source: 'manual',
  created_by: 'ops@acme.dev',
  created_at: '2026-11-03T10:00:00Z',
  active: true,
  ...over,
});
const policy: ApprovalPolicy = {
  app: 'shop',
  required_approvals: 1,
  after_stage: 1,
  timeout_minutes: 60,
  approvers: 'admin',
  allow_self_approval: false,
  notify_channels: ['ops'],
  updated_by: 'me',
  created_at: '',
  updated_at: '',
};
const waiting = (over: Partial<ApprovalStatus> = {}): ApprovalStatus => ({
  deployment_id: 'dep-44-aaaaaaaa',
  app: 'shop',
  state: 'waiting',
  required_approvals: 1,
  approvals: 0,
  decisions: [],
  ...over,
});
const scheduled = (over: Partial<ScheduledRelease> = {}): ScheduledRelease => ({
  id: 's1',
  app: 'shop',
  deployment_id: 'dep-45-bbbbbbbb',
  revision: 45,
  release_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  state: 'scheduled',
  notify_channels: [],
  scheduled_by: 'me',
  created_at: '',
  updated_at: '',
  ...over,
});

beforeEach(() => {
  m.access = {};
  m.workspace = { org: null, label: 'Personal', ready: true };
  m.freezesFor.mockReset();
  m.schedulesFor.mockReset();
  m.approvalsFor.mockReset();
  m.gatesFor.mockReset();
  m.lift.mockReset();
  m.enabled = {};
  m.status = read({ app: 'shop', frozen: false, active: [] });
  m.policy = read(null);
  m.waiting = read([]);
  m.schedules = read([]);
});

const answer = () => screen.getByRole('region', { name: 'What can hold up a release' });

describe('ReleaseSafety (app tab)', () => {
  it('mounts each mechanism’s card for the app when it is released to the account', () => {
    render(<ReleaseSafety slug="shop" onOpenDeployment={vi.fn()} />);
    expect(m.freezesFor).toHaveBeenCalledWith({ kind: 'app', slug: 'shop' });
    expect(m.schedulesFor).toHaveBeenCalledWith('shop');
    expect(m.approvalsFor).toHaveBeenCalledWith('shop');
    expect(m.gatesFor).toHaveBeenCalledWith('shop');
  });

  it('opens with one plain answer when nothing holds a release', () => {
    render(<ReleaseSafety slug="shop" onOpenDeployment={vi.fn()} />);
    expect(within(answer()).getByRole('status')).toHaveTextContent(
      'Nothing is blocking releases.New versions go live as soon as they pass their checks.'
    );
    expect(within(answer()).queryByRole('button')).toBeNull();
  });

  it('says a policy makes new versions wait, and names the next freeze', () => {
    m.policy = read(policy);
    m.status = read({
      app: 'shop',
      frozen: false,
      active: [],
      next: freeze({ active: false, reason: 'weekend', next_starts_at: scheduled().release_at }),
    });
    render(<ReleaseSafety slug="shop" onOpenDeployment={vi.fn()} />);
    expect(answer()).toHaveTextContent(
      /Nothing is blocking releases\..*until an owner or admin approves them\. The next freeze, “weekend”, starts \w+ at \d\d:\d\d\./
    );
  });

  it('leads with a freeze, and lifts it from the headline', async () => {
    const active = freeze({ ends_at: scheduled().release_at });
    m.status = read({ app: 'shop', frozen: true, active: [active] });
    render(<ReleaseSafety slug="shop" onOpenDeployment={vi.fn()} />);
    expect(answer()).toHaveTextContent(/Releases are frozen until \w+ at \d\d:\d\d\./);
    expect(answer()).toHaveTextContent('“incident 4711”, set by ops@acme.dev.');
    await userEvent.click(within(answer()).getByRole('button', { name: 'Lift freeze' }));
    expect(m.lift).toHaveBeenCalledWith(active);
  });

  it('names the version waiting for approval and who may give it, with Review', () => {
    m.policy = read(policy);
    m.waiting = read([waiting({ expires_at: scheduled().release_at })]);
    render(<ReleaseSafety slug="shop" onOpenDeployment={vi.fn()} />);
    expect(answer()).toHaveTextContent('v44 is waiting for an approval from an owner or admin.');
    expect(answer()).toHaveTextContent(/If no one approves it by .+, it’s rolled back\./);
    expect(within(answer()).getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/dashboard/releases/dep-44-aaaaaaaa/approval'
    );
  });

  it('lists what else holds a release under the headline, each with its own action', async () => {
    const onOpen = vi.fn();
    m.status = read({ app: 'shop', frozen: true, active: [freeze()] });
    m.waiting = read([waiting()]);
    m.schedules = read([scheduled(), scheduled({ id: 's0', state: 'started' })]);
    render(<ReleaseSafety slug="shop" onOpenDeployment={onOpen} />);
    expect(answer()).toHaveTextContent('Releases are frozen until someone lifts the freeze.');
    const also = within(answer()).getByRole('list', { name: 'Also holding releases' });
    const rows = within(also).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('v44 is waiting for approval.');
    expect(rows[1]).toHaveTextContent(/v45 is scheduled to go live/);
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Open v45' }));
    expect(onOpen).toHaveBeenCalledWith('dep-45-bbbbbbbb');
  });

  it('never says nothing is blocking when a read failed, and checks again', async () => {
    m.waiting = { ...read(undefined), error: new Error('down') };
    render(<ReleaseSafety slug="shop" onOpenDeployment={vi.fn()} />);
    expect(answer()).not.toHaveTextContent('Nothing is blocking releases.');
    expect(answer()).toHaveTextContent(
      'Nothing we could check is blocking releases.Couldn’t check approvals.'
    );
    await userEvent.click(within(answer()).getByRole('button', { name: 'Check again' }));
    expect(m.waiting.refetch).toHaveBeenCalled();
  });

  it('waits for its reads before answering', () => {
    m.schedules = { ...read(undefined), isPending: true };
    render(<ReleaseSafety slug="shop" onOpenDeployment={vi.fn()} />);
    expect(answer()).toHaveTextContent('Checking what could hold up a release…');
  });

  it('explains each capability that is off, never reads it, and answers without it', () => {
    m.access = {
      'deploy-freezes': 'off',
      'scheduled-releases': 'plan-not-entitled',
      'release-approvals': 'off',
      'release-gates': 'runtime-unavailable',
    };
    render(<ReleaseSafety slug="shop" onOpenDeployment={vi.fn()} />);
    expect(screen.getAllByText('Not enabled for this account')).toHaveLength(2);
    expect(screen.getByText('Unavailable on this installation')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'See previews you can join' })).toHaveLength(2);
    expect(screen.getByText('Not included in your plan')).toBeInTheDocument();
    expect(m.freezesFor).not.toHaveBeenCalled();
    expect(m.schedulesFor).not.toHaveBeenCalled();
    expect(m.approvalsFor).not.toHaveBeenCalled();
    expect(m.gatesFor).not.toHaveBeenCalled();
    expect(m.enabled).toEqual({
      freezes: false,
      policy: false,
      waiting: false,
      schedules: false,
    });
    expect(answer()).toHaveTextContent('Nothing is blocking releases.');
  });
});

describe('WorkspaceReleaseGuards (Releases page)', () => {
  it('reads the personal workspace’s freezes from the account', () => {
    render(<WorkspaceReleaseGuards onOpen={vi.fn()} />);
    expect(m.freezesFor).toHaveBeenCalledWith({ kind: 'account' });
    expect(m.schedulesFor).toHaveBeenCalledWith(undefined);
  });

  it('reads a company workspace’s freezes from the organization, never the account', () => {
    m.workspace = { org: 'acme', label: 'Acme', ready: true };
    render(<WorkspaceReleaseGuards onOpen={vi.fn()} />);
    expect(m.freezesFor).toHaveBeenCalledWith({ kind: 'org', org: 'acme' });
    expect(m.freezesFor).not.toHaveBeenCalledWith({ kind: 'account' });
  });

  it('waits for the workspace before reading anyone’s freezes', () => {
    m.workspace = { org: null, label: 'Personal', ready: false };
    render(<WorkspaceReleaseGuards onOpen={vi.fn()} />);
    expect(m.freezesFor).not.toHaveBeenCalled();
  });

  it('leaves out a section whose capability is off rather than explaining it on Releases', () => {
    m.access = { 'deploy-freezes': 'off', 'scheduled-releases': 'off' };
    const { container } = render(<WorkspaceReleaseGuards onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(m.freezesFor).not.toHaveBeenCalled();
    expect(m.schedulesFor).not.toHaveBeenCalled();
  });
});
