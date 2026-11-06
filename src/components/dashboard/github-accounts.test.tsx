import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubAccounts } from './github-accounts';
const state = vi.hoisted(() => ({ remove: vi.fn(), verify: vi.fn(), confirm: vi.fn() }));
vi.mock('@/lib/api/github-accounts', () => ({
  useGitHubAccounts: () => ({
    data: {
      connections: [
        { installation_id: 42, github_login: 'personal', health: 'healthy', repository_count: 1 },
        { installation_id: 99, github_login: 'company', health: 'unknown', repository_count: 3 },
      ],
    },
    isPending: false,
    error: null,
  }),
  useDisconnectGitHubAccount: () => ({ mutateAsync: state.remove, isPending: false }),
  useVerifyGitHubAccount: () => ({ mutateAsync: state.verify, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
beforeEach(() => {
  vi.clearAllMocks();
  state.confirm.mockResolvedValue(true);
  state.remove.mockResolvedValue(undefined);
  state.verify.mockResolvedValue({
    account_type: 'Organization',
    repository_selection: 'selected',
    permissions: { contents: 'read', checks: 'write' },
    repository_count: 3,
    verified_at: '2026-11-07T00:00:00Z',
  });
});
describe('GitHub account connections', () => {
  it('verifies the selected installation and shows live permissions', async () => {
    render(<GitHubAccounts />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Verify access' })[1]);
    await waitFor(() => expect(state.verify).toHaveBeenCalledWith(99));
    expect(await screen.findByText(/checks: write/)).toBeInTheDocument();
    expect(screen.getByText('company (Organization)')).toBeInTheDocument();
  });
  it('explains account-local disconnect and sends the exact selected installation', async () => {
    render(<GitHubAccounts />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Disconnect' })[0]);
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith(42));
    expect(state.confirm.mock.calls[0][0].description).toContain(
      'other Gregale accounts stay connected'
    );
  });
  it('keeps the connection when the user cancels', async () => {
    state.confirm.mockResolvedValue(false);
    render(<GitHubAccounts />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Disconnect' })[1]);
    expect(state.remove).not.toHaveBeenCalled();
  });
});
