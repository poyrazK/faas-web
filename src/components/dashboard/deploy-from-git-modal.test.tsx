import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeployFromGitModal } from './deploy-from-git-modal';

const mocks = vi.hoisted(() => ({
  deploy: vi.fn(),
  bind: vi.fn(),
  toast: vi.fn(),
  binding: null as null | {
    state: 'not_installed' | 'installed' | 'bound';
    repo_full_name?: string;
    production_branch?: string;
  },
  bindingPending: false,
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'account', github_install_id: '42' } }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/dashboard/repo-picker', () => ({
  RepoPicker: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string;
    onChange: (repo: string) => void;
  }) => <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('@/lib/api/queries', () => ({
  useDeployFromRef: () => ({ mutateAsync: mocks.deploy, isPending: false }),
  useBindRepo: () => ({ mutateAsync: mocks.bind, isPending: false }),
  useAppRepoBinding: () => ({ data: mocks.binding ?? undefined, isPending: mocks.bindingPending }),
}));

function open(onAccepted = vi.fn()) {
  render(
    <DeployFromGitModal
      open
      onClose={vi.fn()}
      appSlug="alpha"
      appName="Alpha"
      onAccepted={onAccepted}
      onSubmissionError={vi.fn()}
    />
  );
  return onAccepted;
}

async function deploy(user: ReturnType<typeof userEvent.setup>, repo?: string, ref?: string) {
  if (repo !== undefined) {
    await user.clear(screen.getByLabelText('Repository'));
    await user.type(screen.getByLabelText('Repository'), repo);
  }
  if (ref !== undefined) {
    await user.clear(screen.getByLabelText('Ref'));
    await user.type(screen.getByLabelText('Ref'), ref);
  }
  await user.click(screen.getByRole('button', { name: 'Deploy' }));
}

beforeEach(() => {
  mocks.deploy.mockReset().mockResolvedValue({ id: 'dep-1' });
  mocks.bind.mockReset().mockResolvedValue({});
  mocks.toast.mockReset();
  mocks.binding = null;
  mocks.bindingPending = false;
});

describe('Deploy from Git', () => {
  it('starts from the repository and branch the app is already bound to', () => {
    mocks.binding = { state: 'bound', repo_full_name: 'acme/api', production_branch: 'prod' };
    open();
    expect(screen.getByLabelText('Repository')).toHaveValue('acme/api');
    expect(screen.getByLabelText('Ref')).toHaveValue('prod');
  });

  it('never rebinds a bound app to the ref that was deployed', async () => {
    const user = userEvent.setup();
    mocks.binding = { state: 'bound', repo_full_name: 'acme/api', production_branch: 'main' };
    const onAccepted = open();
    await deploy(user, undefined, 'v1.2.0');
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(mocks.deploy).toHaveBeenCalledWith({
      repo: 'acme/api',
      ref: 'v1.2.0',
      format: 'tarball',
    });
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it('binds an unbound app to the deployed branch and says push-to-deploy now follows it', async () => {
    const user = userEvent.setup();
    mocks.binding = { state: 'installed' };
    open();
    await deploy(user, 'acme/api', 'main');
    await waitFor(() =>
      expect(mocks.bind).toHaveBeenCalledWith({
        installationId: 42,
        repo: 'acme/api',
        branch: 'main',
      })
    );
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/acme\/api@main/) })
      )
    );
  });

  it('does not bind an unbound app to a commit', async () => {
    const user = userEvent.setup();
    mocks.binding = { state: 'installed' };
    const onAccepted = open();
    await deploy(user, 'acme/api', 'a'.repeat(40));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it('reports a failed bind instead of swallowing it', async () => {
    const user = userEvent.setup();
    mocks.binding = { state: 'installed' };
    mocks.bind.mockRejectedValue(new Error('installation suspended'));
    open();
    await deploy(user, 'acme/api', 'main');
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'error',
          description: expect.stringMatching(/installation suspended/),
        })
      )
    );
  });
});
