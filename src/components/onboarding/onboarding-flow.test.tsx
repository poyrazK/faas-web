import { useState, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NewAppSearch } from '@/components/dashboard/new-app-source';
import { bindWorkspaceAccount, setActiveOrg } from '@/lib/workspace';
import { readOnboarding, writeOnboarding, sampleVersion } from '@/lib/onboarding-draft';
import { OnboardingFlow } from './onboarding-flow';

const mocks = vi.hoisted(() => ({
  account: { id: 'actor-a', email: 'a@example.test', plan: 'free' },
  user: { email: 'a@example.test' },
  inventory: vi.fn(),
  navigate: vi.fn(),
  search: vi.fn(),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  defaultStringifySearch: (await importOriginal<typeof import('@tanstack/react-router')>())
    .defaultStringifySearch,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    account: mocks.account,
    user: mocks.user,
    loading: false,
    refreshAccount: vi.fn(),
  }),
  beginOnboardingGitHubConnect: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({ useOrgs: () => ({ data: { orgs: [] } }) }));
vi.mock('@/lib/api/onboarding', () => ({
  useOnboardingInventory: (owner: unknown) => {
    mocks.inventory(owner);
    return { apps: [], deployments: [], pending: false, error: null, refresh: vi.fn() };
  },
}));
vi.mock('@/components/dashboard/new-app-wizard', () => ({
  NewAppWizard: ({ search, suggestedName }: { search: NewAppSearch; suggestedName?: string }) => (
    <div data-testid="wizard">{JSON.stringify({ search, suggestedName })}</div>
  ),
}));
vi.mock('./onboarding-recovery', () => ({
  OnboardingRecovery: ({ draft }: { draft: unknown }) => (
    <p data-testid="recovery">{JSON.stringify(draft)}</p>
  ),
}));
beforeEach(() => {
  localStorage.clear();
  bindWorkspaceAccount('');
  vi.clearAllMocks();
  mocks.account = { id: 'actor-a', email: 'a@example.test', plan: 'free' };
  mocks.user = { email: 'a@example.test' };
});
afterEach(() => {
  bindWorkspaceAccount('');
  localStorage.clear();
});
function Setup({ initial = {} }: { initial?: NewAppSearch }) {
  const [search, setSearch] = useState(initial);
  return (
    <OnboardingFlow
      search={search}
      onSearchChange={(next) => {
        mocks.search(next);
        setSearch(next);
      }}
    />
  );
}
it('binds the confirmed account without dashboard chrome and offers both paths before requesting GitHub', async () => {
  render(<Setup />);
  expect(await screen.findByRole('button', { name: 'Try a sample' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Choose a repository' })).toBeVisible();
  expect(mocks.inventory).toHaveBeenCalledWith({ account: 'actor-a', workspace: null });
  fireEvent.click(screen.getByRole('button', { name: 'Try a sample' }));
  expect(await screen.findByTestId('wizard')).toHaveTextContent('function');
  expect(readOnboarding({ account: 'actor-a', workspace: null }).draft).toMatchObject({
    kind: 'sample',
    phase: 'preparing',
  });
  expect(mocks.search).toHaveBeenLastCalledWith({ source: 'function', step: 'configure' });
});
it('respects a supplied repository and immutable ref instead of forcing a choice', async () => {
  const ref = 'a'.repeat(40);
  render(<Setup initial={{ source: 'git', repo: 'acme/api', ref, step: 'setup' }} />);
  expect(await screen.findByTestId('wizard')).toHaveTextContent('acme/api');
  expect(screen.getByTestId('wizard')).toHaveTextContent(ref);
  expect(screen.queryByRole('button', { name: 'Try a sample' })).not.toBeInTheDocument();
});
it('dismisses into the console without writing the legacy completion flag', async () => {
  render(<Setup />);
  fireEvent.click(await screen.findByRole('button', { name: 'Explore the console' }));
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' });
  expect(readOnboarding({ account: 'actor-a', workspace: null }).dismissed).toBe(true);
  expect(localStorage.getItem('gregale.onboarded')).toBeNull();
});
it('binds a saved company before mounting the inventory or creation owner', async () => {
  localStorage.setItem('gregale.active-org.actor-a', 'company-a');
  bindWorkspaceAccount('actor-b');
  setActiveOrg('company-b');
  render(<Setup />);
  await screen.findByRole('button', { name: 'Try a sample' });
  expect(
    mocks.inventory.mock.calls.every(
      ([owner]) => owner.account === 'actor-a' && owner.workspace === 'company-a'
    )
  ).toBe(true);
});
it('drops the old mounted draft immediately on actor change and never restores it for another account', async () => {
  writeOnboarding({
    version: 1,
    owner: { account: 'actor-a', workspace: null },
    dismissed: false,
    draft: {
      kind: 'sample',
      starter: sampleVersion(),
      app: 'private-saved-app',
      phase: 'accepted',
    },
  });
  const view = render(<Setup />);
  expect(await screen.findByTestId('recovery')).toHaveTextContent('private-saved-app');
  mocks.account = { id: 'actor-b', email: 'b@example.test', plan: 'free' };
  mocks.user = { email: 'b@example.test' };
  act(() => view.rerender(<Setup />));
  await waitFor(() => expect(screen.queryByTestId('recovery')).not.toBeInTheDocument());
  expect(await screen.findByRole('button', { name: 'Try a sample' })).toBeVisible();
  expect(readOnboarding({ account: 'actor-b', workspace: null }).draft).toBeUndefined();
});
