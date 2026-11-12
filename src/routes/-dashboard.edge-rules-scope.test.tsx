import type { EdgeRule } from '@/lib/api/queries';
import type { ProjectScope } from '@/lib/project-scope';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The account's Edge rules page inside a project: only its apps' rules. */

const state = vi.hoisted(() => ({
  scope: null as unknown as ProjectScope,
  rules: [] as unknown[],
}));
vi.mock('@/lib/project-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/project-scope')>()),
  useProjectScope: () => state.scope,
}));
vi.mock('@/lib/api/queries', () => ({
  useCorsPresets: () => ({ data: { presets: [] }, isPending: false, error: null }),
  useEdgeRules: () => ({ data: state.rules, isPending: false, error: null, refetch: vi.fn() }),
  useAppEdgeRules: () => ({ data: state.rules, isPending: false, error: null, refetch: vi.fn() }),
  useApps: () => ({
    data: [
      { id: 'app-1', slug: 'api-gateway' },
      { id: 'app-2', slug: 'nightly-etl' },
    ],
    isPending: false,
  }),
  useDeleteEdgeRule: () => ({ mutateAsync: vi.fn() }),
  useUpdateEdgeRule: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct', plan: 'pro' } }) }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => ({
    accountId: 'acct',
    capability: { key, maturity: 'beta', enabled: true },
    state: 'available',
    refresh: vi.fn(),
  }),
  useCapabilityAccess: () => ({ access: 'on', refresh: vi.fn() }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/dashboard/cors-presets', () => ({ CorsPresetsPanel: () => null }));
vi.mock('@/components/dashboard/edge-rules/edge-rules-extras', () => ({
  EdgeRulesExtras: () => null,
}));
vi.mock('@/components/dashboard/edge-rules/dialog', () => ({ EdgeRuleDialog: () => null }));

import { EdgeRulesBody } from '@/components/dashboard/pages/edge-rules';

const rule = (id: string, app_id: string, priority: number): EdgeRule => ({
  id,
  account_id: 'acct',
  app_id,
  name: `rule ${id}`,
  kind: 'geo',
  match_host: '@app',
  match_path: '/**',
  match_methods: [],
  match_headers: {},
  priority,
  enabled: true,
  mode: 'enforce',
  action: { deny: ['TR'] },
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
});

const base = { label: '', choices: [] };
const NONE: ProjectScope = { ...base, project: null, appSlugs: null, settled: true };
const ACME: ProjectScope = {
  ...base,
  project: 'acme-shop',
  label: 'acme-shop',
  appSlugs: new Set(['api-gateway']),
  settled: true,
};
const LOADING: ProjectScope = { ...ACME, appSlugs: null, settled: false };

beforeEach(() => {
  state.scope = NONE;
  state.rules = [rule('shop', 'app-1', 10), rule('etl', 'app-2', 20)];
});

describe('Edge rules in a project', () => {
  it('lists only rules on the project’s apps and offers only its apps for a new rule', () => {
    state.scope = ACME;
    render(<EdgeRulesBody />);
    expect(screen.getByText('rule shop')).toBeInTheDocument();
    expect(screen.queryByText('rule etl')).toBeNull();
    const picker = screen.getByRole('combobox', { name: 'App a new rule is created on' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['api-gateway']);
  });

  it('names the project when it has no rules', () => {
    state.scope = ACME;
    state.rules = [rule('etl', 'app-2', 20)];
    render(<EdgeRulesBody />);
    expect(screen.getByText(/No edge rules on acme-shop apps yet/)).toBeInTheDocument();
  });

  it('marks presets and lists as account-wide', async () => {
    state.scope = ACME;
    render(<EdgeRulesBody />);
    await userEvent.click(screen.getByRole('tab', { name: 'CORS presets' }));
    expect(screen.getByText('Account-wide — not limited to acme-shop.')).toBeInTheDocument();
  });

  it('lists every rule without a project', () => {
    render(<EdgeRulesBody />);
    expect(screen.getByText('rule shop')).toBeInTheDocument();
    expect(screen.getByText('rule etl')).toBeInTheDocument();
    expect(screen.queryByText(/not limited to/)).toBeNull();
  });

  it('shows no rule while membership loads', () => {
    state.scope = LOADING;
    render(<EdgeRulesBody />);
    expect(screen.queryByText('rule shop')).toBeNull();
    expect(screen.queryByText('rule etl')).toBeNull();
    expect(screen.getByRole('button', { name: /Add rule/ })).toBeDisabled();
  });

  it('ignores the project on one app’s own Edge rules tab', () => {
    state.scope = ACME;
    state.rules = [rule('etl', 'app-2', 20)];
    render(<EdgeRulesBody slug="nightly-etl" />);
    expect(screen.getByText('rule etl')).toBeInTheDocument();
  });
});
