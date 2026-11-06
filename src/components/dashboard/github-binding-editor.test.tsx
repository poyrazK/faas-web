import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { GitHubBindingEditor } from './github-binding-editor';
import type { GitHubConnection } from '@/lib/api/github-connection';
const state = vi.hoisted(() => ({ bind: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/api/github-accounts', () => ({
  useGitHubAccounts: () => ({
    data: {
      connections: [
        { installation_id: 42, github_login: 'personal' },
        { installation_id: 99, github_login: 'company' },
      ],
    },
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/lib/api/queries', () => ({
  useBindRepo: () => ({ mutateAsync: state.bind, isPending: false }),
}));
vi.mock('./repo-picker', () => ({
  RepoPicker: ({
    value,
    onChange,
    installationId,
  }: {
    value: string;
    onChange: (value: string) => void;
    installationId: number;
  }) => (
    <input
      aria-label="Repository"
      data-installation={installationId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
const current = {
  state: 'bound',
  health: 'healthy',
  connected: true,
  installation_id: 42,
  repo_full_name: 'personal/api',
  production_branch: 'main',
  deploy_branches: { staging: 'test' },
  last_reconcile_repository_count: 1,
  last_reconcile_detached_count: 0,
} satisfies GitHubConnection;
beforeEach(() => {
  vi.clearAllMocks();
  state.bind.mockResolvedValue({});
});
it('binds this app using the chosen installation and preserves branch mappings', async () => {
  const user = userEvent.setup();
  render(<GitHubBindingEditor slug="my-api" current={current} onClose={state.close} />);
  await user.selectOptions(screen.getByLabelText('GitHub installation'), '99');
  expect(screen.getByLabelText('Repository')).toHaveValue('');
  expect(screen.getByLabelText('Repository')).toHaveAttribute('data-installation', '99');
  await user.type(screen.getByLabelText('Repository'), 'company/api');
  await user.click(screen.getByRole('button', { name: 'Save connection' }));
  await waitFor(() =>
    expect(state.bind).toHaveBeenCalledWith({
      installationId: 99,
      repo: 'company/api',
      branch: 'main',
      deployBranches: { staging: 'test' },
    })
  );
  expect(state.close).toHaveBeenCalledOnce();
});
it('does not save a changed binding when cancelled', async () => {
  render(<GitHubBindingEditor slug="my-api" current={current} onClose={state.close} />);
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(state.close).toHaveBeenCalledOnce();
  expect(state.bind).not.toHaveBeenCalled();
});
