import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeOrgHeader, bindWorkspaceAccount } from '@/lib/workspace';
import { WorkspaceSwitcher } from './workspace-switcher';

const org = (slug: string, name: string, personal = false) => ({
  id: `id-${slug}`,
  slug,
  name,
  personal,
  plan: 'pro' as const,
  status: 'active',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});
const orgs = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1' } }) }));
vi.mock('@/lib/api/queries', () => ({
  useOrgs: () => ({ data: { orgs: orgs.list }, isPending: false, isError: false }),
}));

afterEach(() => {
  window.localStorage.clear();
  bindWorkspaceAccount('');
});

function mount() {
  const root = createRootRoute({ component: WorkspaceSwitcher });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('WorkspaceSwitcher', () => {
  it('starts in the personal workspace and switches to a team organization', async () => {
    orgs.list = [org('me', 'me', true), org('team-a', 'Team A')];
    mount();
    const trigger = await screen.findByRole('button', { name: /Workspace: Personal/ });
    expect(activeOrgHeader()).toBeNull();
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Team A/ }));
    expect(activeOrgHeader()).toBe('team-a');
    expect(await screen.findByRole('button', { name: /Workspace: Team A/ })).toBeInTheDocument();
  });

  it('says what follows the workspace and what stays with the account', async () => {
    orgs.list = [org('me', 'me', true)];
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Workspace:/ }));
    const note = await screen.findByText(
      /The full app list and projects stay your signed-in account's/
    );
    expect(note).toHaveTextContent(
      "the workspace's app inventory on Projects, and new apps follow the selected workspace"
    );
  });

  it('drops a stored workspace the account no longer belongs to', async () => {
    window.localStorage.setItem('gregale.active-org.acct-1', 'gone');
    orgs.list = [org('me', 'me', true)];
    mount();
    await waitFor(() => expect(activeOrgHeader()).toBeNull());
    expect(screen.getByRole('button', { name: /Workspace: Personal/ })).toBeInTheDocument();
  });
});
