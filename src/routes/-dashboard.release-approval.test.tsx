import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  access: 'on',
  approvalRead: vi.fn(),
  intent: undefined as string | undefined,
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as object),
    useParams: () => ({ deploymentId: 'd'.repeat(32) }),
    useSearch: () => ({ intent: m.intent }),
  }),
  Link: ({ children }: { children: unknown }) => (
    <a href="/dashboard/releases">{children as string}</a>
  ),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: m.access, refresh: vi.fn() }),
}));
vi.mock('@/lib/api/queries', () => ({
  useDeployment: () => ({
    data: { id: 'd'.repeat(32), revision: 44 },
    error: null,
    isPending: false,
  }),
}));
vi.mock('@/lib/api/release-approvals', () => ({
  useReleaseApproval: () => {
    m.approvalRead();
    return { data: { app: 'shop' } };
  },
}));
vi.mock('@/components/dashboard/release-approvals', () => ({
  ReleaseApproval: ({ release, intent }: { release: string; intent?: string }) => (
    <p>
      deciding {release} {intent ?? 'none'}
    </p>
  ),
}));
vi.mock('@/components/dashboard/deployment-diff', () => ({
  DeploymentDiff: ({ slug }: { slug?: string }) => <p>diff of {slug}</p>,
}));

const { ReleaseApprovalPage, Route } = await import('./dashboard.releases_.$deploymentId.approval');

beforeEach(() => {
  m.access = 'on';
  m.intent = undefined;
  m.approvalRead.mockReset();
});

describe('the release approval page', () => {
  it('decides the release the link names, with the change it would ship', () => {
    m.intent = 'approve';
    render(<ReleaseApprovalPage />);
    expect(screen.getByText('deciding v44 approve')).toBeInTheDocument();
    expect(screen.getByText('diff of shop')).toBeInTheDocument();
  });

  it('explains itself and reads nothing while approvals are off for the account', () => {
    m.access = 'off';
    render(<ReleaseApprovalPage />);
    expect(screen.getByText('Not enabled for this account')).toBeInTheDocument();
    expect(screen.queryByText(/deciding/)).toBeNull();
    expect(m.approvalRead).not.toHaveBeenCalled();
  });

  it('keeps only the two intents the buttons send', () => {
    const validate = (
      Route as unknown as { validateSearch: (raw: Record<string, unknown>) => { intent?: string } }
    ).validateSearch;
    expect(validate({ intent: 'reject' }).intent).toBe('reject');
    expect(validate({ intent: 'merge' }).intent).toBeUndefined();
  });
});
