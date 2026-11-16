import type { EdgeRule } from '@/lib/api/queries';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

/** The rules table as a beta surface: its label, log mode, conditions, and the off state. */

// No project chosen (lib/project-scope.ts): the page behaves as before.
vi.mock('@/lib/project-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/project-scope')>()),
  useProjectScope: () => ({ project: null, label: '', appSlugs: null, settled: true, choices: [] }),
}));

const state = vi.hoisted(() => ({
  access: 'on',
  rules: [] as unknown[],
  update: vi.fn(),
  apps: [] as { id: string; slug: string }[],
}));
vi.mock('@/lib/api/queries', () => ({
  useCorsPresets: () => ({ data: { presets: [] }, isPending: false, error: null }),
  useEdgeRules: () => ({ data: state.rules, isPending: false, error: null, refetch: vi.fn() }),
  useAppEdgeRules: () => ({ data: state.rules, isPending: false, error: null, refetch: vi.fn() }),
  useApps: () => ({ data: state.apps }),
  useDeleteEdgeRule: () => ({ mutateAsync: vi.fn() }),
  useUpdateEdgeRule: () => ({ mutateAsync: state.update }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', plan: 'pro' } }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => ({
    accountId: 'acct',
    capability: { key, maturity: 'beta', enabled: true },
    state: 'available',
    refresh: vi.fn(),
  }),
  useCapabilityAccess: () => ({ access: state.access, refresh: vi.fn() }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/dashboard/cors-presets', () => ({ CorsPresetsPanel: () => null }));
vi.mock('@/components/dashboard/edge-rules/edge-rules-extras', () => ({
  EdgeRulesExtras: () => null,
}));
vi.mock('@/components/dashboard/edge-rules/dialog', () => ({
  EdgeRuleDialog: ({ rule, slug }: { rule: { id: string }; slug: string }) => (
    <div role="dialog" aria-label="Rule settings" data-app={slug}>
      {rule.id}
    </div>
  ),
}));

import { EdgeRulesBody } from '@/components/dashboard/pages/edge-rules';

const rule: EdgeRule = {
  id: 'bots-1',
  account_id: 'acct',
  app_id: 'app-1',
  name: 'Block unverified bots',
  kind: 'ip',
  match_host: '@app',
  match_path: '/**',
  match_methods: [],
  match_headers: {},
  priority: 10,
  enabled: true,
  mode: 'log',
  action: { deny: ['0.0.0.0/0', '::/0'] },
  match: {
    all: [
      { field: 'ua_family', op: 'eq', value: 'bot' },
      { field: 'verified_bot', op: 'missing' },
    ],
  },
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
};

beforeEach(() => {
  state.access = 'on';
  state.rules = [rule];
  state.apps = [{ id: 'app-1', slug: 'api' }];
  state.update.mockReset().mockResolvedValue({});
});

it('carries the beta label of the edge-rules capability', () => {
  render(<EdgeRulesBody slug="api" />);
  expect(screen.getByText('Beta')).toBeInTheDocument();
});

it('shows a log-mode rule as logging, its name and its condition', () => {
  render(<EdgeRulesBody slug="api" />);
  expect(screen.getByText('log only')).toBeInTheDocument();
  expect(screen.getByText('Block unverified bots')).toBeInTheDocument();
  expect(
    screen.getByText(/the client type is bot and the caller is not a verified crawler/)
  ).toBeInTheDocument();
  expect(screen.queryByText('Technical settings')).not.toBeInTheDocument();
});

it('keeps the rules readable but offers no new one while edge rules are off for the account', () => {
  state.access = 'off';
  render(<EdgeRulesBody slug="api" />);
  expect(screen.getByRole('button', { name: /Add rule/ })).toBeDisabled();
  expect(screen.getByText(/not enabled for this account/i)).toBeInTheDocument();
  expect(screen.getByText('Block unverified bots')).toBeInTheDocument();
});

it('opens settings from the rule by keyboard, while the pause switch remains independent', async () => {
  render(<EdgeRulesBody slug="api" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('switch', { name: 'Pause rule 10' }));
  expect(state.update).toHaveBeenCalledWith({ id: 'bots-1', enabled: false });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const row = screen.getByRole('button', { name: /Log only. Would block matching requests/ });
  expect(row).toHaveAttribute('aria-haspopup', 'dialog');
  expect(row.querySelector('button, [role="switch"]')).toBeNull();
  row.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: 'Rule settings' })).toHaveTextContent('bots-1');
});

it('finds a country rule by its plain-English effect', async () => {
  state.rules = [
    { ...rule, kind: 'geo', action: { deny: ['TR'] }, mode: 'enforce', match: undefined },
  ];
  render(<EdgeRulesBody slug="api" />);
  await userEvent.type(screen.getByPlaceholderText('Find a rule by what it does…'), 'Turkey');
  expect(screen.getByRole('button', { name: /Blocks requests from Turkey/ })).toBeInTheDocument();
});

it('keeps the known app scope when settings open before the app inventory arrives', async () => {
  state.apps = [];
  render(<EdgeRulesBody slug="api" />);
  await userEvent.click(
    screen.getByRole('button', { name: /Log only. Would block matching requests/ })
  );
  expect(screen.getByRole('dialog', { name: 'Rule settings' })).toHaveAttribute('data-app', 'api');
});
