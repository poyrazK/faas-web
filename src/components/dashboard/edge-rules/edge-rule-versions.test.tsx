import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  versions: [] as unknown[],
  version: undefined as unknown,
  versionsError: null as unknown,
  rollback: vi.fn(),
  refetch: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  asked: null as number | null,
}));
vi.mock('@/lib/api/edge-rules', () => ({
  useEdgeStage: () => 'Beta',
  useEdgeRuleVersions: () => ({
    data: state.versionsError ? undefined : state.versions,
    error: state.versionsError,
    isPending: false,
    refetch: state.refetch,
  }),
  useEdgeRuleVersion: (_slug: string, v: number | null) => {
    state.asked = v;
    return { data: v === null ? undefined : state.version, error: null, isPending: false };
  },
  useRollbackEdgeRules: () => ({ mutateAsync: state.rollback, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));

const { EdgeRuleVersions } = await import('./edge-rule-versions');

const rule = (id: string, over: Partial<EdgeRule> = {}): EdgeRule => ({
  id,
  account_id: 'acct',
  app_id: 'app',
  match_host: '@app',
  match_path: '/admin/**',
  match_methods: [],
  match_headers: {},
  priority: 20,
  enabled: true,
  kind: 'ip',
  action: { deny: ['0.0.0.0/0'] },
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
});

const current = [rule('a')];

beforeEach(() => {
  state.versions = [
    {
      version: 4,
      rule_count: 1,
      rules_sha256: 'x',
      created_at: '2026-10-30T10:00:00Z',
      current: true,
    },
    {
      version: 3,
      rule_count: 2,
      rules_sha256: 'y',
      created_at: '2026-10-29T10:00:00Z',
      current: false,
    },
  ];
  state.version = {
    version: 3,
    rule_count: 2,
    rules_sha256: 'y',
    created_at: '2026-10-29T10:00:00Z',
    current: false,
    rules: [
      rule('a', { priority: 10 }),
      rule('b', {
        kind: 'throttle',
        match_path: '/login',
        match: {
          all: [
            { not: { field: 'client_ip', op: 'in_list', list: 'office-ips' } },
            { field: 'path', op: 'prefix', values: ['/.env', '/.git/'] },
          ],
        },
        action: { requests_per_second: 5, burst: 10 } as EdgeRule['action'],
      }),
    ],
  };
  state.versionsError = null;
  state.rollback.mockReset().mockResolvedValue([]);
  state.confirm.mockReset().mockResolvedValue(true);
  state.toast.mockReset();
  state.refetch.mockReset();
});

async function openVersion3() {
  render(<EdgeRuleVersions slug="api" rules={current} />);
  await userEvent.click(screen.getByRole('button', { name: 'Compare version 3' }));
  return screen.getByRole('dialog', { name: 'Version 3' });
}

describe('EdgeRuleVersions', () => {
  it('lists versions newest first, marks the current one and says it is beta', () => {
    render(<EdgeRuleVersions slug="api" rules={current} />);
    expect(screen.getByText(/^Beta · /)).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('v4');
    expect(rows[0]).toHaveTextContent('Current');
    expect(rows[1]).toHaveTextContent('v3');
    expect(rows[1]).toHaveTextContent('2 rules');
    expect(state.asked).toBeNull();
  });

  it('shows the version beside the rules now, rule by rule', async () => {
    const dialog = await openVersion3();
    expect(within(dialog).getByText('1 rule comes back and 1 changes.')).toBeInTheDocument();
    const changed = within(dialog).getByRole('group', { name: 'Rule a: changes' });
    expect(within(changed).getByText('Now')).toBeInTheDocument();
    expect(within(changed).getByText('Version 3')).toBeInTheDocument();
    expect(within(changed).getByText('Changes: priority')).toBeInTheDocument();
    expect(within(changed).getByText('#20')).toBeInTheDocument();
    expect(within(changed).getByText('#10')).toBeInTheDocument();
    const back = within(dialog).getByRole('group', { name: 'Rule b: comes back' });
    expect(within(back).getByText('Not in the rules now')).toBeInTheDocument();
    expect(within(back).getByText('5 rps · burst 10')).toBeInTheDocument();
    expect(
      within(back).getByText(
        'when not (client_ip in list office-ips) and path prefix /.env, /.git/'
      )
    ).toBeInTheDocument();
  });

  it('confirms naming the version and what changes, then rolls back on the version read', async () => {
    const dialog = await openVersion3();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Roll back to version 3' }));
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Roll back to version 3?',
        description: expect.stringContaining('1 rule comes back and 1 changes.'),
        confirmLabel: 'Roll back',
        destructive: true,
      })
    );
    expect(state.confirm.mock.calls[0][0].description).toMatch(/live traffic/i);
    expect(state.confirm.mock.calls[0][0].description).toMatch(/version 5/);
    await waitFor(() => expect(state.rollback).toHaveBeenCalledWith({ version: 3, current: 4 }));
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Rolled back to version 3' })
    );
  });

  it('does nothing when the confirmation is declined', async () => {
    state.confirm.mockResolvedValue(false);
    const dialog = await openVersion3();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Roll back to version 3' }));
    expect(state.rollback).not.toHaveBeenCalled();
  });

  it('says the rules moved on when someone changed them since, and rereads', async () => {
    state.rollback.mockRejectedValue(
      new ApiError({
        status: 412,
        code: 'edge_rules_version_mismatch',
        title: 'Edge rules changed',
      })
    );
    const dialog = await openVersion3();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Roll back to version 3' }));
    expect(
      await within(dialog).findByText(/changed since this page read them/i)
    ).toBeInTheDocument();
    expect(state.refetch).toHaveBeenCalled();
  });

  it('keeps a refused restore in the dialog with the reason', async () => {
    state.rollback.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'conflict',
        title: 'Version cannot be restored',
        detail: 'the version references a CORS preset that no longer exists',
      })
    );
    const dialog = await openVersion3();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Roll back to version 3' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/CORS preset/);
  });

  it('offers no rollback to the current version', async () => {
    state.version = { ...(state.version as object), version: 4, current: true, rules: current };
    render(<EdgeRuleVersions slug="api" rules={current} />);
    await userEvent.click(screen.getByRole('button', { name: 'Compare version 4' }));
    const dialog = screen.getByRole('dialog', { name: 'Version 4' });
    expect(within(dialog).queryByRole('button', { name: /Roll back/ })).toBeNull();
    expect(within(dialog).getByText('The rules are the same as now.')).toBeInTheDocument();
  });
});
