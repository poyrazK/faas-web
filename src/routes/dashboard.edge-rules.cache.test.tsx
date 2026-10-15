import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';

const state = vi.hoisted(() => ({
  capability: 'available',
  accountId: 'account-a',
  rules: [] as unknown[],
  update: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({
  useEdgeRules: () => ({ data: state.rules, isPending: false, error: null, refetch: vi.fn() }),
  useAppEdgeRules: () => ({ data: state.rules, isPending: false, error: null, refetch: vi.fn() }),
  useApps: () => ({ data: [{ id: 'app-1', slug: 'api' }] }),
  useDeleteEdgeRule: () => ({ mutateAsync: state.remove }),
  useUpdateEdgeRule: () => ({ mutateAsync: state.update }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: state.accountId, plan: 'hobby' } }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ accountId: state.accountId, state: state.capability, refresh: vi.fn() }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@/components/dashboard/cors-presets', () => ({ CorsPresetsPanel: () => null }));
vi.mock('@/components/dashboard/edge-rules/dialog', () => ({ EdgeRuleDialog: () => null }));

import { EdgeRulesBody } from './dashboard.edge-rules';

const cacheRule: EdgeRule = {
  id: 'cache-1',
  account_id: 'account-a',
  app_id: 'app-1',
  kind: 'cache',
  match_host: '*',
  match_path: '/products/*',
  match_methods: ['GET', 'HEAD'],
  priority: 10,
  enabled: true,
  validate_mode: 'block',
  action: {
    max_age_seconds: 60,
    stale_while_revalidate_seconds: 0,
    stale_if_error_seconds: 300,
    methods: ['GET', 'HEAD'],
  },
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
};
const routeRule: EdgeRule = {
  ...cacheRule,
  id: 'route-1',
  kind: 'route',
  priority: 20,
  action: { target_app_slug: 'api' },
};

beforeEach(() => {
  state.capability = 'available';
  state.accountId = 'account-a';
  state.rules = [cacheRule, routeRule];
  state.update.mockReset().mockResolvedValue({});
  state.remove.mockReset().mockResolvedValue({});
  state.confirm.mockReset().mockResolvedValue(true);
  state.toast.mockReset();
});

it('keeps cache rule writes disabled during a capability outage without blocking route rules', () => {
  state.capability = 'runtime-unavailable';
  render(<EdgeRulesBody slug="api" />);
  expect(screen.getByRole('switch', { name: 'Pause rule 10' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Delete rule cache-1' })).toBeDisabled();
  expect(screen.getByText('Unavailable on this installation')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Pause rule 20' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Delete rule route-1' })).toBeEnabled();
});

it('cancels a confirmed cache deletion if availability changes while confirmation is pending', async () => {
  let decide!: (value: boolean) => void;
  state.confirm.mockReturnValue(
    new Promise<boolean>((resolve) => {
      decide = resolve;
    })
  );
  const view = render(<EdgeRulesBody slug="api" />);
  await userEvent.click(screen.getByRole('button', { name: 'Delete rule cache-1' }));
  await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
  state.capability = 'registry-error';
  view.rerender(<EdgeRulesBody slug="api" />);
  await act(async () => decide(true));
  expect(state.remove).not.toHaveBeenCalled();
});
