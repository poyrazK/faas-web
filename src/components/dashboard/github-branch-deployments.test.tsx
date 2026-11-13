import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { GitHubConnection } from '@/lib/api/github-connection';

const state = vi.hoisted(() => ({
  app: {} as { data?: { project_id?: string }; isPending: boolean; error: unknown },
  bind: vi.fn(),
  toast: vi.fn(),
  workspace: { org: null as string | null, label: 'Personal', ready: true },
}));
vi.mock('@/lib/api/queries', () => ({
  useApp: () => state.app,
  useBindRepo: () => ({ mutateAsync: state.bind, isPending: false }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => state.workspace }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));

const { GitHubBranchDeployments } = await import('./github-branch-deployments');

const status: GitHubConnection = {
  state: 'bound',
  health: 'healthy',
  connected: true,
  installation_id: 48213377,
  repo_full_name: 'acme-corp/storefront',
  production_branch: 'main',
  deploy_branches: { staging: 'staging', hotfix: 'default' },
  last_reconcile_repository_count: 4,
  last_reconcile_detached_count: 0,
};

const PROJECT = '3f2b8c1e-6a4d-4e5f-9b7a-1c2d3e4f5a6b';

function show(overrides: Partial<GitHubConnection> = {}, projectId: string | null = PROJECT) {
  state.app = { data: { project_id: projectId ?? undefined }, isPending: false, error: null };
  return render(<GitHubBranchDeployments slug="storefront" status={{ ...status, ...overrides }} />);
}

beforeEach(() => {
  state.bind.mockReset();
  state.toast.mockReset();
  state.workspace = { org: null, label: 'Personal', ready: true };
});

it('lists which branch deploys where: production first, then the mapped branches', () => {
  show();
  const rows = within(screen.getByRole('list', { name: 'Branch deployments' })).getAllByRole(
    'listitem'
  );
  expect(rows.map((row) => row.textContent)).toEqual([
    'main deploys to Production · production branch',
    'hotfix deploys to Production (default scope)',
    'staging deploys to staging environment',
  ]);
});

it('leaves the deployment-policy caveat to the connection details, and never claims previews', () => {
  show();
  expect(screen.queryByText(/github:manage/)).not.toBeInTheDocument();
  const list = screen.getByRole('list', { name: 'Branch deployments' });
  expect(within(list).queryByText(/pull request|preview/i)).not.toBeInTheDocument();
});

it('offers no editor for a standalone app, and says mappings need a project', () => {
  show({ deploy_branches: undefined }, null);
  expect(screen.queryByRole('button', { name: 'Edit mappings' })).not.toBeInTheDocument();
  expect(screen.getByText(/belong to a project, and this app is not in one/)).toBeInTheDocument();
});

it('offers no editor without a known production branch, since saving would move production', () => {
  show({ production_branch: undefined });
  expect(screen.queryByRole('button', { name: 'Edit mappings' })).not.toBeInTheDocument();
  show({ production_branch: '' });
  expect(screen.queryByRole('button', { name: 'Edit mappings' })).not.toBeInTheDocument();
});

it('offers no editor until it knows whether the app is in a project', () => {
  state.app = { data: undefined, isPending: true, error: null };
  render(<GitHubBranchDeployments slug="storefront" status={status} />);
  expect(screen.queryByRole('button', { name: 'Edit mappings' })).not.toBeInTheDocument();
  expect(screen.queryByText(/not in one/)).not.toBeInTheDocument();
});

it('saves an added mapping by binding the same repository and production branch again', async () => {
  state.bind.mockResolvedValue({ binding_id: 'b' });
  show();
  await userEvent.click(screen.getByRole('button', { name: 'Edit mappings' }));
  const form = screen.getByRole('form', { name: 'Edit branch deployments' });
  expect(within(form).getByText(/every app in it/)).toBeInTheDocument();
  await userEvent.click(within(form).getByRole('button', { name: 'Add branch' }));
  await userEvent.type(within(form).getByRole('textbox', { name: 'Branch 3' }), 'release/2.x');
  await userEvent.type(
    within(form).getByRole('textbox', { name: 'Environment for branch 3' }),
    'qa'
  );
  await userEvent.click(within(form).getByRole('button', { name: 'Remove hotfix' }));
  await userEvent.click(within(form).getByRole('button', { name: 'Save mappings' }));
  await waitFor(() => expect(state.bind).toHaveBeenCalledOnce());
  expect(state.bind).toHaveBeenCalledWith({
    installationId: 48213377,
    repo: 'acme-corp/storefront',
    branch: 'main',
    deployBranches: { staging: 'staging', 'release/2.x': 'qa' },
  });
  expect(state.toast).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'success', title: 'Branch deployments saved' })
  );
  expect(screen.queryByRole('form', { name: 'Edit branch deployments' })).not.toBeInTheDocument();
});

it('clears every mapping with an empty map, which apid reads as "remove them"', async () => {
  state.bind.mockResolvedValue({ binding_id: 'b' });
  show({ deploy_branches: { staging: 'staging' } });
  await userEvent.click(screen.getByRole('button', { name: 'Edit mappings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove staging' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save mappings' }));
  await waitFor(() =>
    expect(state.bind).toHaveBeenCalledWith(expect.objectContaining({ deployBranches: {} }))
  );
});

it('refuses a scope apid would reject, and a branch mapped twice, before sending', async () => {
  show();
  await userEvent.click(screen.getByRole('button', { name: 'Edit mappings' }));
  const scope = screen.getByRole('textbox', { name: 'Environment for branch 2' });
  await userEvent.clear(scope);
  await userEvent.type(scope, 'Staging Env');
  expect(screen.getByText(/lowercase letters, digits and hyphens/)).toBeInTheDocument();
  const branch = screen.getByRole('textbox', { name: 'Branch 1' });
  await userEvent.clear(branch);
  await userEvent.type(branch, 'staging');
  expect(screen.getByText('This branch is already mapped.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save mappings' }));
  expect(state.bind).not.toHaveBeenCalled();
});

it('shows an added row’s missing fields only once a save is pressed', async () => {
  show();
  await userEvent.click(screen.getByRole('button', { name: 'Edit mappings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add branch' }));
  expect(screen.queryByText('Enter a branch name.')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save mappings' }));
  expect(screen.getByText('Enter a branch name.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Branch 3' })).toHaveAttribute('aria-invalid', 'true');
  expect(state.bind).not.toHaveBeenCalled();
});

it.each([
  ['project_required', 409, /belong to a project, and this app is not in one/],
  ['github_install_not_owned', 403, /installation could not be verified/],
  ['github_unreachable', 502, /could not reach github/i],
  ['validation_failed', 400, /expired before it arrived/],
])('explains a refused save (%s) and keeps the edits', async (code, status, copy) => {
  state.bind.mockRejectedValue(new ApiError({ status, code, title: 'x', detail: 'prose' }));
  show();
  await userEvent.click(screen.getByRole('button', { name: 'Edit mappings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save mappings' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(copy);
  expect(screen.getByRole('form', { name: 'Edit branch deployments' })).toBeInTheDocument();
});

it('names the organization when a role refuses the bind', async () => {
  state.workspace = { org: 'acme-corp', label: 'Acme Corp', ready: true };
  state.bind.mockRejectedValue(
    new ApiError({ status: 403, code: 'org_role_forbidden', title: 'x', detail: 'prose' })
  );
  show();
  await userEvent.click(screen.getByRole('button', { name: 'Edit mappings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save mappings' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /created the app, while they are an owner or admin of Acme Corp/
  );
});
