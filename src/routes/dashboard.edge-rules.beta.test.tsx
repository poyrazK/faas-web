import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';

/** The rules table as a beta surface: its label, log mode, conditions, and the off state. */

const state = vi.hoisted(() => ({
  access: 'on',
  rules: [] as unknown[],
}));
vi.mock('@/lib/api/queries', () => ({
  useEdgeRules: () => ({ data: state.rules, isPending: false, error: null, refetch: vi.fn() }),
  useAppEdgeRules: () => ({ data: state.rules, isPending: false, error: null, refetch: vi.fn() }),
  useApps: () => ({ data: [{ id: 'app-1', slug: 'api' }] }),
  useDeleteEdgeRule: () => ({ mutateAsync: vi.fn() }),
  useUpdateEdgeRule: () => ({ mutateAsync: vi.fn() }),
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
vi.mock('@/components/dashboard/edge-rules/dialog', () => ({ EdgeRuleDialog: () => null }));

import { EdgeRulesBody } from './dashboard.edge-rules';

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
});

it('carries the beta label of the edge-rules capability', () => {
  render(<EdgeRulesBody slug="api" />);
  expect(screen.getByText('Beta')).toBeInTheDocument();
});

it('shows a log-mode rule as logging, its name and its condition', () => {
  render(<EdgeRulesBody slug="api" />);
  expect(screen.getByText('log only')).toBeInTheDocument();
  expect(screen.getByText('Block unverified bots')).toBeInTheDocument();
  expect(screen.getByText(/2 conditions \(all\)/)).toBeInTheDocument();
});

it('keeps the rules readable but offers no new one while edge rules are off for the account', () => {
  state.access = 'off';
  render(<EdgeRulesBody slug="api" />);
  expect(screen.getByRole('button', { name: /Add rule/ })).toBeDisabled();
  expect(screen.getByText(/not enabled for this account/i)).toBeInTheDocument();
  expect(screen.getByText('Block unverified bots')).toBeInTheDocument();
});
