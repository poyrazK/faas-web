import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  lists: [] as unknown[],
  one: undefined as unknown,
  enabled: [] as boolean[],
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  workspace: { org: null as string | null, label: 'Personal', ready: true },
  plan: 'pro',
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityStage: () => 'Beta' }));
vi.mock('@/lib/api/edge-rules', () => ({
  useEdgeRuleLists: (_account: string, enabled: boolean) => {
    state.enabled.push(enabled);
    return {
      data: enabled ? { lists: state.lists } : undefined,
      error: null,
      isPending: !enabled,
      refetch: vi.fn(),
    };
  },
  useEdgeRuleList: (_account: string, name: string | null) => ({
    data: name ? state.one : undefined,
    error: null,
    isPending: false,
  }),
  useCreateEdgeRuleList: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateEdgeRuleList: () => ({ mutateAsync: state.update, isPending: false }),
  useDeleteEdgeRuleList: () => ({ mutateAsync: state.remove, isPending: false }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => state.workspace }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', plan: state.plan } }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));

const { EdgeRuleLists } = await import('./edge-rule-lists');

const office = {
  id: 'l1',
  name: 'office-ips',
  kind: 'ip',
  description: 'HQ and VPN',
  item_count: 2,
  referenced_by: ['r1', 'r2'],
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
const spare = {
  ...office,
  id: 'l2',
  name: 'blocked-countries',
  kind: 'country',
  referenced_by: [],
};

beforeEach(() => {
  state.lists = [office, spare];
  state.one = { ...office, items: ['198.51.100.0/24', '203.0.113.7/32'] };
  state.enabled = [];
  state.create.mockReset().mockResolvedValue(office);
  state.update.mockReset().mockResolvedValue(office);
  state.remove.mockReset().mockResolvedValue(undefined);
  state.confirm.mockReset().mockResolvedValue(true);
  state.toast.mockReset();
  state.workspace = { org: null, label: 'Personal', ready: true };
  state.plan = 'pro';
});

describe('EdgeRuleLists', () => {
  it('lists the account’s lists with their kind, size and use', () => {
    render(<EdgeRuleLists />);
    expect(screen.getByText(/^Beta · /)).toBeInTheDocument();
    const row = screen.getByRole('group', { name: 'office-ips' });
    expect(row).toHaveTextContent('ip');
    expect(row).toHaveTextContent('2 items');
    expect(row).toHaveTextContent('Used by 2 rules');
  });

  it('reads nothing in a company workspace: lists belong to the signed-in account', () => {
    state.workspace = { org: 'acme', label: 'Acme', ready: true };
    render(<EdgeRuleLists />);
    expect(state.enabled.every((e) => !e)).toBe(true);
    expect(screen.getByText(/belong to your personal account/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New list' })).toBeNull();
  });

  it('creates a list from typed items', async () => {
    render(<EdgeRuleLists />);
    await userEvent.click(screen.getByRole('button', { name: 'New list' }));
    const dialog = screen.getByRole('dialog', { name: 'New list' });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'office-ips');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Kind/), 'ip');
    await userEvent.type(
      within(dialog).getByLabelText(/^Items/),
      '203.0.113.7{enter}198.51.100.0/24'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith({
        name: 'office-ips',
        kind: 'ip',
        items: ['203.0.113.7', '198.51.100.0/24'],
      })
    );
  });

  it('refuses a name apid would refuse, before the round trip', async () => {
    render(<EdgeRuleLists />);
    await userEvent.click(screen.getByRole('button', { name: 'New list' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Office IPs');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    expect(within(dialog).getByText(/lowercase letters, digits/)).toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('keeps a plan refusal in the dialog', async () => {
    state.create.mockRejectedValue(
      new ApiError({
        status: 403,
        code: 'plan_limit_edge_rule_lists',
        title: 'Edge rule list limit reached',
        detail: 'hobby plan caps edge rule lists at 5 per account; you have 5.',
      })
    );
    render(<EdgeRuleLists />);
    await userEvent.click(screen.getByRole('button', { name: 'New list' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'more');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/caps edge rule lists at 5/);
  });

  it('confirms an edit to a list rules use, naming how many, then replaces the items', async () => {
    render(<EdgeRuleLists />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit office-ips' }));
    const dialog = screen.getByRole('dialog', { name: 'office-ips' });
    const items = within(dialog).getByLabelText(/^Items/);
    expect(items).toHaveValue('198.51.100.0/24\n203.0.113.7/32');
    await userEvent.type(items, '{enter}192.0.2.1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save list' }));
    expect(state.confirm.mock.calls[0][0]).toMatchObject({
      title: 'Change office-ips?',
      description: expect.stringContaining('2 rules use this list'),
    });
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({
        name: 'office-ips',
        items: ['198.51.100.0/24', '203.0.113.7/32', '192.0.2.1'],
      })
    );
  });

  it('deletes only a list no rule uses', async () => {
    render(<EdgeRuleLists />);
    expect(screen.getByRole('button', { name: 'Delete office-ips' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete blocked-countries' }));
    expect(state.confirm.mock.calls[0][0]).toMatchObject({ destructive: true });
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith('blocked-countries'));
  });

  it('explains on Free that lists start on Hobby, instead of offering one apid refuses', () => {
    state.plan = 'free';
    state.lists = [];
    render(<EdgeRuleLists />);
    expect(screen.queryByRole('button', { name: 'New list' })).toBeNull();
    expect(screen.getByText(/Rule lists are on Hobby and above/)).toBeInTheDocument();
  });

  it('explains a list that came into use since the page read it', async () => {
    const err = new ApiError({
      status: 409,
      code: 'edge_rule_list_in_use',
      title: 'In use',
      detail: 'r9',
    });
    state.remove.mockRejectedValue(err);
    render(<EdgeRuleLists />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete blocked-countries' }));
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'error',
          description: expect.stringMatching(/rule uses/),
          error: err,
        })
      )
    );
  });
});
