import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { PrivateNetwork } from '@/lib/api/networks';

const access = vi.hoisted(() => ({ value: 'on' as string }));
const workspace = vi.hoisted(() => ({ org: null as string | null }));
const list = vi.fn();
const members = vi.fn();
const peerings = vi.fn();
const create = vi.fn();
const remove = vi.fn();
const policy = vi.fn();
const peer = vi.fn();
const unpeer = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.value, refresh: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct' } }) }));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => ({ org: workspace.org, label: 'Acme Corp', ready: true }),
}));
vi.mock('@/lib/api/networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/networks')>()),
  useNetworks: (accountId: string) => list(accountId) as unknown,
  useNetworkMembers: (_a: string, id: string) => members(id) as unknown,
  useNetworkPeerings: (_a: string, id: string) => peerings(id) as unknown,
  useCreateNetwork: () => ({ mutateAsync: create, isPending: false }),
  useDeleteNetwork: () => ({ mutateAsync: remove, isPending: false }),
  useUpdateNetworkPolicy: () => ({ mutateAsync: policy, isPending: false }),
  useCreatePeering: () => ({ mutateAsync: peer, isPending: false }),
  useDeletePeering: () => ({ mutateAsync: unpeer, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { withCapability } = await import('../capability-gate');
const { PrivateNetworksBody } = await import('./private-networks');
const Page = withCapability('private-networks', 'Private networks', PrivateNetworksBody);

const prod: PrivateNetwork = {
  id: 'prod-net',
  name: 'prod-net',
  region: 'fra1',
  cidr: '10.42.0.0/16',
  allowed_cidrs: ['10.42.8.0/24'],
  firewall_rules: [{ direction: 'ingress', protocol: 'tcp', ports: ['5432'] }],
  status: 'ready',
  created_at: '2026-10-01T00:00:00Z',
};
const data: PrivateNetwork = {
  id: 'data-net',
  name: 'data-net',
  region: 'fra1',
  cidr: '10.43.0.0/16',
  status: 'ready',
};
const lab: PrivateNetwork = {
  id: 'lab-net',
  name: 'lab-net',
  region: 'ams3',
  cidr: '10.50.0.0/24',
  status: 'error',
  status_detail: 'host bridge failed',
};
const read = <T,>(value: T, extra: Record<string, unknown> = {}) => ({
  data: value,
  error: null,
  isPending: false,
  isFetching: false,
  refetch: vi.fn(),
  ...extra,
});

beforeEach(() => {
  access.value = 'on';
  workspace.org = null;
  for (const fn of [list, members, peerings, create, remove, policy, peer, unpeer, confirm, toast])
    fn.mockReset();
  list.mockReturnValue(read({ networks: [prod, data, lab] }));
  members.mockReturnValue(
    read({
      network_id: 'prod-net',
      cidr: prod.cidr,
      capacity: 65533,
      used: 1,
      available: 65532,
      members: [{ id: 'm1', owner_type: 'app', owner_id: 'a'.repeat(32), address: '10.42.0.2' }],
    })
  );
  peerings.mockReturnValue(read({ peerings: [] }));
  confirm.mockResolvedValue(true);
});

describe('Private networks page', () => {
  it.each(['off', 'plan-not-entitled', 'runtime-unavailable'])(
    'reads nothing while private-networks is %s',
    (state) => {
      access.value = state;
      render(<Page onSelect={vi.fn()} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(list).not.toHaveBeenCalled();
    }
  );

  it('links the plan page when the plan does not include private networks', () => {
    access.value = 'plan-not-entitled';
    render(<Page onSelect={vi.fn()} />);
    expect(screen.getByRole('link', { name: /view plans/i })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
  });

  it('reads nothing in a company workspace, and says networks are the account’s', () => {
    workspace.org = 'acme-corp';
    render(<Page onSelect={vi.fn()} />);
    expect(list).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/not to Acme Corp/);
  });

  it('says so when the installation has not turned private networking on', () => {
    list.mockReturnValue(
      read(undefined, {
        error: new ApiError({ status: 503, code: 'private_network_not_enabled', title: 'Off' }),
      })
    );
    render(<Page onSelect={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/not enabled on this installation/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lists each network with its status in words and its policy', () => {
    render(<Page onSelect={vi.fn()} />);
    expect(screen.getAllByText('Ready')).toHaveLength(2);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('host bridge failed')).toBeInTheDocument();
    expect(screen.getByText(/1 allowed range, 1 firewall rule/)).toBeInTheDocument();
    expect(screen.getAllByText(/no restriction inside the network/i)).toHaveLength(2);
  });

  it('creates a network with an optional allowlist and opens it', async () => {
    const onSelect = vi.fn();
    create.mockResolvedValue({ ...data, id: 'new-net', name: 'new-net' });
    render(<Page onSelect={onSelect} />);
    const form = screen.getByRole('button', { name: /create network/i }).closest('form')!;
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'new-net');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Region' }), 'fra1');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Range' }), '10.60.0.0/16');
    await userEvent.type(
      within(form).getByRole('textbox', { name: /allowed ranges/i }),
      '10.60.1.0/24'
    );
    await userEvent.click(within(form).getByRole('button', { name: /create network/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        body: {
          name: 'new-net',
          region: 'fra1',
          cidr: '10.60.0.0/16',
          allowed_cidrs: ['10.60.1.0/24'],
        },
      })
    );
    expect(onSelect).toHaveBeenCalledWith('new-net');
  });

  it('refuses a malformed range before sending', async () => {
    render(<Page onSelect={vi.fn()} />);
    const form = screen.getByRole('button', { name: /create network/i }).closest('form')!;
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'x');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Region' }), 'fra1');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Range' }), '10.60.0.0');
    expect(within(form).getByRole('button', { name: /create network/i })).toBeDisabled();
  });

  it('shows members and capacity of the selected network', () => {
    render(<Page selected="prod-net" onSelect={vi.fn()} />);
    expect(members).toHaveBeenCalledWith('prod-net');
    expect(screen.getByText(/1 of 65533 addresses in use/)).toBeInTheDocument();
    expect(screen.getByText('10.42.0.2')).toBeInTheDocument();
  });

  it('offers peering only with same-region networks, and says what it opens', async () => {
    peer.mockResolvedValue({});
    render(<Page selected="prod-net" onSelect={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: /peer with/i });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['data-net (10.43.0.0/16)']);
    await userEvent.click(screen.getByRole('button', { name: /request peering/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/stays pending/i) })
    );
    await waitFor(() => expect(peer).toHaveBeenCalledWith({ peer: 'data-net' }));
  });

  it('removes a peering only after a destructive confirmation', async () => {
    peerings.mockReturnValue(
      read({
        peerings: [
          {
            id: 'peer-1',
            network_id: 'prod-net',
            peer_network_id: 'data-net',
            region: 'fra1',
            status: 'pending',
          },
        ],
      })
    );
    unpeer.mockResolvedValue(undefined);
    render(<Page selected="prod-net" onSelect={vi.fn()} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /remove peering with data-net/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/withdrawn/i),
      })
    );
    await waitFor(() => expect(unpeer).toHaveBeenCalledWith({ peering: 'peer-1' }));
  });

  it('replaces both policy lists after saying how it applies', async () => {
    policy.mockResolvedValue(prod);
    render(<Page selected="prod-net" onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /add rule/i }));
    const rule = screen.getByRole('group', { name: 'Rule 2' });
    await userEvent.selectOptions(within(rule).getByRole('combobox', { name: 'Protocol' }), 'icmp');
    await userEvent.click(screen.getByRole('button', { name: /^replace policy$/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/1 allowed range and 2 firewall rules/),
      })
    );
    await waitFor(() =>
      expect(policy).toHaveBeenCalledWith({
        allowed_cidrs: ['10.42.8.0/24'],
        firewall_rules: [
          { direction: 'ingress', protocol: 'tcp', ports: ['5432'] },
          { direction: 'ingress', protocol: 'icmp' },
        ],
      })
    );
  });

  it('holds a TCP rule without ports back from saving', async () => {
    render(<Page selected="prod-net" onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /add rule/i }));
    expect(screen.getByRole('button', { name: /^replace policy$/i })).toBeDisabled();
  });

  it('deletes behind a typed confirmation and explains an attached network by its code', async () => {
    remove.mockRejectedValue(new ApiError({ status: 409, code: 'conflict', title: 'Attached' }));
    render(<Page selected="prod-net" onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /delete network/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, typeToConfirm: 'prod-net' })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/detach the apps/i) })
      )
    );
  });

  it('says a selected network that is not in the account is missing', () => {
    render(<Page selected="gone-net" onSelect={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no network gone-net/i);
  });
});
