import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { AppNetworkAttachment } from '@/lib/api/networks';

const access = vi.hoisted(() => ({ value: 'on' as string }));
const workspace = vi.hoisted(() => ({ org: null as string | null }));
const attachment = vi.fn();
const networks = vi.fn();
const attach = vi.fn();
const detach = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.value, refresh: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct' } }) }));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => ({ org: workspace.org, label: 'Acme Corp', ready: true }),
}));
vi.mock('@/lib/api/networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/networks')>()),
  useAppNetworkAttachment: (slug: string) => attachment(slug) as unknown,
  useNetworks: (accountId: string, enabled: boolean) => networks(accountId, enabled) as unknown,
  useAttachNetwork: () => ({ mutateAsync: attach, isPending: false }),
  useDetachNetwork: () => ({ mutateAsync: detach, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { AppPrivateNetwork } = await import('./app-private-network');

const read = <T,>(value: T, extra: Record<string, unknown> = {}) => ({
  data: value,
  error: null,
  isPending: false,
  isFetching: false,
  refetch: vi.fn(),
  ...extra,
});
const attached: AppNetworkAttachment = {
  feature_enabled: true,
  plan_allowed: true,
  max_cidrs: 16,
  attachment: {
    id: 'att-1',
    network_id: 'prod-net',
    region: 'fra1',
    cidrs: ['10.42.0.0/16'],
    allowed_cidrs: [],
    address: '10.42.0.2',
    status: 'error',
    status_detail: 'route policy failed on 1 of 2 nodes',
    nodes: [
      { node_id: 'node-1', fabric_status: 'ready', route_status: 'ready' },
      {
        node_id: 'node-2',
        fabric_status: 'ready',
        route_status: 'error',
        route_detail: 'nft busy',
      },
    ],
  },
};
const detached: AppNetworkAttachment = { ...attached, attachment: null };

beforeEach(() => {
  access.value = 'on';
  workspace.org = null;
  for (const fn of [attachment, networks, attach, detach, confirm, toast]) fn.mockReset();
  attachment.mockReturnValue(read(attached));
  networks.mockReturnValue(
    read({
      networks: [
        { id: 'prod-net', name: 'prod-net', region: 'fra1', cidr: '10.42.0.0/16', status: 'ready' },
        { id: 'data-net', name: 'data-net', region: 'fra1', cidr: '10.43.0.0/16', status: 'ready' },
      ],
    })
  );
  confirm.mockResolvedValue(true);
});

describe('App private network', () => {
  it.each(['off', 'plan-not-entitled', 'registry-error'])(
    'reads nothing while private-networks is %s',
    (state) => {
      access.value = state;
      render(<AppPrivateNetwork slug="api" />);
      expect(attachment).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /attach/i })).not.toBeInTheDocument();
    }
  );

  it('leads with the attachment status and shows each node’s convergence', () => {
    render(<AppPrivateNetwork slug="api" />);
    expect(screen.getByText('prod-net')).toBeInTheDocument();
    expect(screen.getAllByText('Error').length).toBeGreaterThan(0);
    expect(screen.getByText('route policy failed on 1 of 2 nodes')).toBeInTheDocument();
    const nodes = screen.getByRole('list', { name: /convergence by node/i });
    expect(within(nodes).getAllByRole('listitem')).toHaveLength(2);
    expect(within(nodes).getByText('nft busy')).toBeInTheDocument();
    expect(screen.getByText('No restriction')).toBeInTheDocument();
  });

  it('detaches behind a destructive confirmation that says traffic stops', async () => {
    detach.mockResolvedValue(undefined);
    render(<AppPrivateNetwork slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /^detach$/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/private traffic .* stops/i),
      })
    );
    await waitFor(() => expect(detach).toHaveBeenCalled());
  });

  it('attaches to one of the account’s networks and says it starts pending', async () => {
    attachment.mockReturnValue(read(detached));
    attach.mockResolvedValue(attached);
    render(<AppPrivateNetwork slug="api" />);
    expect(screen.getByText(/not attached/i)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'data-net');
    await userEvent.type(screen.getByRole('textbox', { name: /allowed ranges/i }), '10.43.1.0/24');
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/pending: private traffic stays blocked/i),
      })
    );
    await waitFor(() =>
      expect(attach).toHaveBeenCalledWith({
        network_id: 'data-net',
        allowed_cidrs: ['10.43.1.0/24'],
      })
    );
  });

  it('says a change replaces the current attachment', async () => {
    attach.mockResolvedValue(attached);
    render(<AppPrivateNetwork slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /change attachment/i }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'data-net');
    const form = screen.getByRole('combobox', { name: 'Network' }).closest('form')!;
    await userEvent.click(within(form).getByRole('button', { name: /change attachment/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/replaces the attachment to prod-net/i),
      })
    );
  });

  it('takes a typed network ID in a company workspace and reads no personal networks', async () => {
    workspace.org = 'acme-corp';
    attachment.mockReturnValue(read(detached));
    attach.mockResolvedValue(attached);
    render(<AppPrivateNetwork slug="api" />);
    expect(networks).toHaveBeenCalledWith('acct', false);
    expect(screen.queryByRole('combobox', { name: 'Network' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /network id/i }), 'team-net');
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }));
    await waitFor(() =>
      expect(attach).toHaveBeenCalledWith({ network_id: 'team-net', allowed_cidrs: [] })
    );
  });

  it('offers no attach form on a plan without private networks', () => {
    attachment.mockReturnValue(read({ ...detached, plan_allowed: false, max_cidrs: 0 }));
    render(<AppPrivateNetwork slug="api" />);
    expect(screen.getByRole('link', { name: /view plans/i })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
    expect(screen.queryByRole('button', { name: /^attach$/i })).not.toBeInTheDocument();
  });

  it('explains a plan refusal by its code', async () => {
    attachment.mockReturnValue(read(detached));
    attach.mockRejectedValue(
      new ApiError({ status: 402, code: 'plan_private_network_not_allowed', title: 'Plan' })
    );
    render(<AppPrivateNetwork slug="api" />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'prod-net');
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'Not included in your plan' })
      )
    );
  });

  it('says so when the installation has not enabled attachments', () => {
    attachment.mockReturnValue(
      read(undefined, {
        error: new ApiError({ status: 503, code: 'private_network_not_enabled', title: 'Off' }),
      })
    );
    render(<AppPrivateNetwork slug="api" />);
    expect(screen.getByRole('status')).toHaveTextContent(/not enabled on this installation/i);
  });
});
