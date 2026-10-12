import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompanionsSummary } from './companions-summary';
import { useCompanions, useCompanionChoices } from '@/lib/api/companions';
import { useCapability } from '@/lib/api/capabilities';
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'a' } }) }));
vi.mock('@/lib/api/companions', () => ({ useCompanions: vi.fn(), useCompanionChoices: vi.fn() }));
vi.mock('@/lib/api/capabilities', () => ({ useCapability: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const ready = { isPending: false, isFetching: false, error: null, refetch: vi.fn() };
const helper = {
  name: 'metrics',
  type: 'sidecar',
  ram_mb: 128,
  cpu_millicores: 0,
  scratch_mb: 0,
  port: 9090,
  primary_ingress: false,
  depends_on: [{ name: 'main', condition: 'started' }],
  environment_keys: ['TOKEN'],
};
function setup(state: 'available' | 'unavailable' = 'available', helpers = [helper]) {
  vi.mocked(useCapability).mockReturnValue({
    accountId: 'a',
    state: 'available',
    refresh: vi.fn(),
    capability: { maturity: 'preview', docs_url: '/docs/companions' },
  } as never);
  vi.mocked(useCompanionChoices).mockReturnValue({
    ...ready,
    data: {
      appId: 'app',
      items: [{ id: 'dep', status: 'live', createdAt: '2026-10-12T00:00:00Z' }],
      nextBefore: '2026-10-11T00:00:00Z',
    },
  } as never);
  vi.mocked(useCompanions).mockReturnValue({
    ...ready,
    data: {
      account_id: 'a',
      app_id: 'app',
      app_slug: 'api',
      deployment_id: 'dep',
      scope: 'staging',
      state,
      companions: helpers,
    },
  } as never);
}
it('separates declared resources and environment keys from unverified execution health', () => {
  setup();
  render(<CompanionsSummary slug="api" onSelect={vi.fn()} />);
  expect(screen.getByText('metrics')).toBeVisible();
  expect(screen.getByText('staging', { exact: true })).toBeVisible();
  expect(screen.getByText(/128 MiB/)).toBeVisible();
  expect(screen.getByText('TOKEN')).toBeVisible();
  expect(screen.getByText(/Execution health: Unverified/)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Documentation' })).not.toBeInTheDocument();
});
it('inspects existing declarations even when preset/runtime creation is unavailable', () => {
  setup();
  vi.mocked(useCapability).mockReturnValue({
    accountId: 'a',
    state: 'runtime-unavailable',
    refresh: vi.fn(),
  } as never);
  render(<CompanionsSummary slug="api" onSelect={vi.fn()} />);
  expect(screen.getByText('metrics')).toBeVisible();
  expect(screen.getByText(/does not establish that every custom helper/)).toBeVisible();
});
it.each(['unavailable', 'empty', 'error', 'refreshing'] as const)(
  'keeps %s evidence distinct',
  (state) => {
    setup(state === 'unavailable' ? 'unavailable' : 'available', state === 'empty' ? [] : [helper]);
    if (state === 'error' || state === 'refreshing')
      vi.mocked(useCompanions).mockReturnValue({
        ...ready,
        error: state === 'error' ? new Error('read denied') : null,
        isFetching: state === 'refreshing',
        data: { ...vi.mocked(useCompanions)('a', 'api', 'dep').data },
      } as never);
    render(<CompanionsSummary slug="api" onSelect={vi.fn()} />);
    if (state === 'empty') expect(screen.getByText(/No companions were declared/)).toBeVisible();
    else {
      expect(screen.queryByText('metrics')).not.toBeInTheDocument();
      expect(screen.queryByText(/No companions were declared/)).not.toBeInTheDocument();
    }
  }
);
it('preserves direct exact-record selection and delegates pagination to URL navigation', () => {
  setup();
  const select = vi.fn();
  render(<CompanionsSummary slug="api" selectedId="dep" onSelect={select} />);
  fireEvent.click(screen.getByRole('button', { name: 'Older deployments' }));
  expect(select).toHaveBeenCalledWith(undefined, '2026-10-11T00:00:00Z');
  expect(useCompanions).toHaveBeenCalledWith('a', 'api', 'dep');
});
it('hides mismatched deployment or app identity during a context change', () => {
  setup();
  render(<CompanionsSummary slug="other" selectedId="other-dep" onSelect={vi.fn()} />);
  expect(screen.queryByText('metrics')).not.toBeInTheDocument();
});
