import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
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
  installRepos: [] as { id: number; full_name: string; default_branch: string; private: boolean }[],
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search?: Record<string, string>;
    children: ReactNode;
  }) => <a href={`${to}${search ? '?' + new URLSearchParams(search) : ''}`}>{children}</a>,
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
    unlistedNote,
  }: {
    id?: string;
    value: string;
    onChange: (repo: string) => void;
    unlistedNote?: string;
  }) => (
    <input
      id={id}
      value={value}
      data-unlisted-note={unlistedNote}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock('@/lib/api/queries', () => ({
  useDeployFromRef: () => ({ mutateAsync: mocks.deploy, isPending: false }),
  useBindRepo: () => ({ mutateAsync: mocks.bind, isPending: false }),
  useAppRepoBinding: () => ({ data: mocks.binding ?? undefined, isPending: mocks.bindingPending }),
  useInstallRepos: () => ({ data: mocks.installRepos, isPending: false }),
}));

function open(onAccepted = vi.fn(), onSubmissionError = vi.fn()) {
  render(
    <DeployFromGitModal
      open
      onClose={vi.fn()}
      appSlug="alpha"
      appName="Alpha"
      onAccepted={onAccepted}
      onSubmissionError={onSubmissionError}
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
  mocks.installRepos = [];
});

describe('Deploy from Git', () => {
  it('starts from the repository and branch the app is already bound to', () => {
    mocks.binding = { state: 'bound', repo_full_name: 'acme/api', production_branch: 'prod' };
    open();
    expect(screen.getByLabelText('Repository')).toHaveValue('acme/api');
    expect(screen.getByLabelText('Ref')).toHaveValue('prod');
  });

  it('labels the bound repository in case the installation does not list it', () => {
    mocks.binding = { state: 'bound', repo_full_name: 'acme/api', production_branch: 'prod' };
    open();
    expect(screen.getByLabelText('Repository')).toHaveAttribute(
      'data-unlisted-note',
      'bound repository'
    );
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

  it("binds an unbound app without naming a branch, so apid uses the repository's default", async () => {
    const user = userEvent.setup();
    mocks.binding = { state: 'installed' };
    open();
    await deploy(user, 'acme/api', 'main');
    await waitFor(() =>
      expect(mocks.bind).toHaveBeenCalledWith({ installationId: 42, repo: 'acme/api' })
    );
    expect(mocks.bind.mock.calls[0][0]).not.toHaveProperty('branch');
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Pushes to acme/api's default branch now deploy Alpha.",
        })
      )
    );
  });

  it.each([
    ['a tag', 'v1.2.0'],
    ['a commit', 'a'.repeat(40)],
  ])('binds the same way when the deployed ref is %s', async (_label, ref) => {
    const user = userEvent.setup();
    mocks.binding = { state: 'installed' };
    open();
    await deploy(user, 'acme/api', ref);
    await waitFor(() =>
      expect(mocks.bind).toHaveBeenCalledWith({ installationId: 42, repo: 'acme/api' })
    );
  });

  it('does not bind when the binding read has not answered', async () => {
    const user = userEvent.setup();
    mocks.binding = null;
    const onAccepted = open();
    await deploy(user, 'acme/api', 'main');
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  describe('ambiguous GitHub installation', () => {
    const AMBIGUOUS = () =>
      new ApiError({
        status: 409,
        code: 'github_install_ambiguous',
        title: 'GitHub installation is ambiguous',
        detail: 'more than one connected installation can access the repository',
      });
    const LISTED = [{ id: 1, full_name: 'acme/api', default_branch: 'main', private: false }];

    it('binds the app to the connected installation, then deploys again', async () => {
      const user = userEvent.setup();
      mocks.binding = { state: 'installed' };
      mocks.installRepos = LISTED;
      mocks.deploy.mockRejectedValueOnce(AMBIGUOUS()).mockResolvedValueOnce({ id: 'dep-2' });
      const onSubmissionError = vi.fn();
      const onAccepted = open(vi.fn(), onSubmissionError);
      await deploy(user, 'acme/api', 'v1.2.0');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/more than one of your GitHub installations/i);
      // Settings → Integrations only refreshes the connection; it cannot pick one.
      expect(within(alert).queryByRole('link')).toBeNull();
      expect(mocks.bind).not.toHaveBeenCalled();

      await user.click(within(alert).getByRole('button', { name: /bind and deploy/i }));
      await waitFor(() =>
        expect(mocks.bind).toHaveBeenCalledWith({ installationId: 42, repo: 'acme/api' })
      );
      await waitFor(() =>
        expect(onAccepted).toHaveBeenCalledWith({ id: 'dep-2', repo: 'acme/api', ref: 'v1.2.0' })
      );
      expect(mocks.deploy).toHaveBeenCalledTimes(2);
      // Bound once, before the retry: no second bind after the build is accepted.
      expect(mocks.bind).toHaveBeenCalledTimes(1);
      // The raw API sentence must not reach the page behind the modal or the toast.
      expect(onSubmissionError).not.toHaveBeenCalledWith(
        expect.stringMatching(/more than one connected/)
      );
      expect(mocks.toast).not.toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/more than one connected/) })
      );
      expect(mocks.toast).not.toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/Integrations/) })
      );
    });

    it('says binding moves push-to-deploy when the app is bound to another repository', async () => {
      const user = userEvent.setup();
      mocks.binding = { state: 'bound', repo_full_name: 'acme/web', production_branch: 'main' };
      mocks.installRepos = LISTED;
      mocks.deploy.mockRejectedValueOnce(AMBIGUOUS());
      open();
      await deploy(user, 'acme/api', 'main');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/acme\/web stop deploying Alpha/);
    });

    it('says what fixes it on GitHub when the connected installation cannot see the repository', async () => {
      const user = userEvent.setup();
      mocks.binding = { state: 'installed' };
      mocks.installRepos = [];
      mocks.deploy.mockRejectedValueOnce(AMBIGUOUS());
      open();
      await deploy(user, 'acme/api', 'main');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/On GitHub.*Repository access.*all but one/);
      expect(within(alert).queryByRole('link')).toBeNull();
      expect(within(alert).queryByRole('button')).toBeNull();
    });

    it('shows a failed bind in the modal', async () => {
      const user = userEvent.setup();
      mocks.binding = { state: 'installed' };
      mocks.installRepos = LISTED;
      mocks.deploy.mockRejectedValueOnce(AMBIGUOUS());
      mocks.bind.mockRejectedValue(new Error('installation suspended'));
      open();
      await deploy(user, 'acme/api', 'main');
      await user.click(await screen.findByRole('button', { name: /bind and deploy/i }));
      expect(await screen.findByText(/installation suspended/)).toBeInTheDocument();
      expect(mocks.deploy).toHaveBeenCalledTimes(1);
    });
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
