import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FreezeOwner } from '@/lib/api/release-freezes';

const m = vi.hoisted(() => ({
  access: {} as Record<string, string>,
  workspace: { org: null as string | null, label: 'Personal', ready: true },
  freezesFor: vi.fn(),
  schedulesFor: vi.fn(),
}));

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({ access: m.access[id] ?? 'on', refresh: vi.fn() }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => m.workspace }));
// The sections' own reads are covered beside them; here only what mounts matters.
vi.mock('./release-freezes', () => ({
  ReleaseFreezes: ({ owner }: { owner: FreezeOwner }) => {
    m.freezesFor(owner);
    return <p>freezes for {JSON.stringify(owner)}</p>;
  },
}));
vi.mock('./release-schedule', () => ({
  ScheduledReleases: ({ app }: { app?: string }) => {
    m.schedulesFor(app);
    return <p>schedules for {app ?? 'account'}</p>;
  },
}));

const { ReleaseSafety, WorkspaceReleaseGuards } = await import('./release-safety');

beforeEach(() => {
  m.access = {};
  m.workspace = { org: null, label: 'Personal', ready: true };
  m.freezesFor.mockReset();
  m.schedulesFor.mockReset();
});

describe('ReleaseSafety (app tab)', () => {
  it('shows the app’s freezes and schedules when both are released to the account', () => {
    render(<ReleaseSafety slug="shop" onOpenDeployment={vi.fn()} />);
    expect(m.freezesFor).toHaveBeenCalledWith({ kind: 'app', slug: 'shop' });
    expect(m.schedulesFor).toHaveBeenCalledWith('shop');
  });

  it('explains each capability that is off, and never mounts its reads', () => {
    m.access = { 'deploy-freezes': 'off', 'scheduled-releases': 'plan-not-entitled' };
    render(<ReleaseSafety slug="shop" onOpenDeployment={vi.fn()} />);
    expect(screen.getByText('Not enabled for this account')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See previews you can join' })).toBeInTheDocument();
    expect(screen.getByText('Not included in your plan')).toBeInTheDocument();
    expect(m.freezesFor).not.toHaveBeenCalled();
    expect(m.schedulesFor).not.toHaveBeenCalled();
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
