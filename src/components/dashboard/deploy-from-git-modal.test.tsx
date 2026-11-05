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
  review: vi.fn(),
  reviewPending: false,
  executionMode: undefined as string | undefined,
  confirm: vi.fn(),
  scheduleAccess: 'off' as string,
}));

vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: mocks.scheduleAccess, refresh: vi.fn() }),
  useCapabilityStage: () => 'Preview',
}));
vi.mock('@/lib/api/notification-channels', () => ({
  useNotificationChannels: () => ({
    data: [{ id: 'c1', name: 'releases', kind: 'slack', target: 'T1', created_at: '' }],
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
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
  useApp: () => ({
    data: { id: 'app-a', slug: 'alpha', manifest: { execution_mode: mocks.executionMode } },
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/lib/api/source-review', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/source-review')>()),
  useReviewSource: () => ({ mutateAsync: mocks.review, isPending: mocks.reviewPending }),
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

const SHA = '3f1c2b7d9e8a6f5b4c3d2e1f0a9b8c7d6e5f4a3b';
const REVIEW = (servingIds = ['dep-0'], protectedTarget = false) => ({
  app_id: 'app-a',
  repo: 'acme/api',
  commit_sha: SHA,
  installation_id: 42,
  repository_id: 7,
  source_root: '',
  release_review: {
    app_id: 'app-a',
    scope: 'default',
    configuration_hash: 'c'.repeat(64),
    latest_deployment_id: 'dep-0',
    serving_deployment_ids: servingIds,
    ...(protectedTarget ? { protected: true } : {}),
  },
});

async function review(user: ReturnType<typeof userEvent.setup>, repo = 'acme/api', ref = 'main') {
  await user.click(screen.getByRole('button', { name: 'Review first' }));
  await user.clear(screen.getByLabelText('Repository'));
  await user.type(screen.getByLabelText('Repository'), repo);
  await user.clear(screen.getByLabelText('Ref'));
  await user.type(screen.getByLabelText('Ref'), ref);
  await user.click(screen.getByRole('button', { name: 'Review' }));
}

beforeEach(() => {
  mocks.deploy.mockReset().mockResolvedValue({ id: 'dep-1' });
  mocks.bind.mockReset().mockResolvedValue({});
  mocks.toast.mockReset();
  mocks.binding = null;
  mocks.bindingPending = false;
  mocks.installRepos = [];
  mocks.review.mockReset().mockResolvedValue(REVIEW());
  mocks.reviewPending = false;
  mocks.executionMode = undefined;
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.scheduleAccess = 'off';
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

  describe('reviewed source', () => {
    it('reviews a ref, shows what it pinned, and stages exactly that commit at 0%', async () => {
      const user = userEvent.setup();
      mocks.binding = { state: 'installed' };
      const onAccepted = open();
      await review(user);
      expect(mocks.review).toHaveBeenCalledWith({ repo: 'acme/api', ref: 'main' });
      const pinned = await screen.findByRole('region', { name: 'Reviewed source' });
      expect(pinned).toHaveTextContent(SHA.slice(0, 12));
      expect(pinned).toHaveTextContent('acme/api');
      expect(pinned).toHaveTextContent('c'.repeat(12));
      expect(pinned).toHaveTextContent('dep-0');
      await user.click(screen.getByRole('button', { name: 'Stage at 0%' }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalled());
      expect(mocks.deploy).toHaveBeenCalledWith({
        repo: 'acme/api',
        ref: SHA,
        format: 'tarball',
        no_triggers: true,
        traffic_percent: 0,
        expected_source: REVIEW(),
      });
      expect(onAccepted).toHaveBeenCalledWith({ id: 'dep-1', repo: 'acme/api', ref: SHA });
      // A reviewed release never writes the push-to-deploy binding.
      expect(mocks.bind).not.toHaveBeenCalled();
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'Reviewed commit staged' })
      );
    });

    it('drops the review when the source it was for is edited', async () => {
      const user = userEvent.setup();
      open();
      await review(user);
      await screen.findByRole('region', { name: 'Reviewed source' });
      await user.type(screen.getByLabelText('Ref'), 'x');
      expect(screen.queryByRole('region', { name: 'Reviewed source' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Stage at 0%' })).not.toBeInTheDocument();
    });

    it.each([
      ['source_ref_stale', /source changed after it was reviewed/i],
      ['release_review_changed', /configuration or serving release changed/i],
    ])('asks for a new review when the deploy answers %s', async (code, pattern) => {
      const user = userEvent.setup();
      const onSubmissionError = vi.fn();
      open(vi.fn(), onSubmissionError);
      mocks.deploy.mockRejectedValue(new ApiError({ status: 409, code, title: code, detail: 'x' }));
      await review(user);
      await user.click(await screen.findByRole('button', { name: 'Stage at 0%' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(pattern);
      expect(alert).toHaveTextContent(/nothing was deployed/i);
      expect(screen.queryByRole('region', { name: 'Reviewed source' })).not.toBeInTheDocument();
      expect(onSubmissionError).not.toHaveBeenCalledWith(expect.any(String));
      mocks.review.mockClear();
      await user.click(within(alert).getByRole('button', { name: 'Review again' }));
      expect(mocks.review).toHaveBeenCalledWith({ repo: 'acme/api', ref: 'main' });
      expect(await screen.findByRole('region', { name: 'Reviewed source' })).toBeInTheDocument();
    });

    it('holds staging while traffic is split across releases', async () => {
      const user = userEvent.setup();
      mocks.review.mockResolvedValue(REVIEW(['dep-0', 'dep-9']));
      open();
      await review(user);
      expect(await screen.findByText(/split across 2 releases/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Stage at 0%' })).toBeDisabled();
    });

    it('hands a worker over natively instead of staging it', async () => {
      const user = userEvent.setup();
      mocks.executionMode = 'worker';
      open();
      await review(user);
      await user.click(await screen.findByRole('button', { name: 'Roll out reviewed commit' }));
      await waitFor(() => expect(mocks.deploy).toHaveBeenCalled());
      const body = mocks.deploy.mock.calls[0][0] as Record<string, unknown>;
      expect(body).toMatchObject({ ref: SHA, native_rollout: 'worker', expected_source: REVIEW() });
      expect(body).not.toHaveProperty('traffic_percent');
    });

    it('reports a refused review where it happened', async () => {
      const user = userEvent.setup();
      mocks.review.mockRejectedValue(
        new ApiError({
          status: 400,
          code: 'validation_failed',
          title: 'Validation failed',
          detail: 'ref must resolve to a branch or be a full lowercase commit SHA',
        })
      );
      open();
      await review(user, 'acme/api', 'v1.2.0');
      expect(await screen.findByRole('alert')).toHaveTextContent(/full lowercase commit SHA/);
      expect(mocks.deploy).not.toHaveBeenCalled();
    });
  });

  describe('deploy freezes and scheduled releases', () => {
    const frozen = () =>
      new ApiError({
        status: 409,
        code: 'release_frozen',
        title: 'Production releases are frozen',
        detail:
          'Production releases of alpha are frozen: "incident 4711" by ops@acme.dev, until lifted.',
        freezes: [
          {
            id: 'f1',
            app: 'alpha',
            kind: 'window',
            starts_at: '2026-11-03T10:00:00Z',
            reason: 'incident 4711',
            source: 'manual',
            created_by: 'ops@acme.dev',
            created_at: '2026-11-03T10:00:00Z',
            active: true,
          },
        ],
      });

    it('shows a frozen refusal and resends with an audited override after confirming', async () => {
      const user = userEvent.setup();
      mocks.deploy.mockRejectedValueOnce(frozen());
      const onAccepted = open();
      await deploy(user, 'acme/api', 'main');
      const refusal = await screen.findByRole('alert', { name: 'Release frozen' });
      expect(refusal).toHaveTextContent('incident 4711');
      await user.type(within(refusal).getByLabelText('Override reason'), 'hotfix');
      mocks.confirm.mockResolvedValueOnce(false);
      await user.click(within(refusal).getByRole('button', { name: 'Deploy anyway' }));
      expect(mocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Deploy Alpha into the freeze?', destructive: true })
      );
      expect(mocks.deploy).toHaveBeenCalledTimes(1);
      await user.click(within(refusal).getByRole('button', { name: 'Deploy anyway' }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalled());
      expect(mocks.deploy).toHaveBeenLastCalledWith({
        repo: 'acme/api',
        ref: 'main',
        format: 'tarball',
        override_freeze: 'hotfix',
      });
    });

    it('offers no start time while scheduled releases are off for the account', () => {
      open();
      expect(screen.queryByText(/start the production rollout later/)).toBeNull();
    });

    it('builds now and schedules the rollout, after confirming when it starts', async () => {
      const user = userEvent.setup();
      mocks.scheduleAccess = 'on';
      open();
      await user.click(screen.getByLabelText(/start the production rollout later/));
      const start = new Date(Date.now() + 2 * 3_600_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const local = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}`;
      await user.type(screen.getByLabelText('Start the rollout'), local);
      await user.click(screen.getByLabelText(/releases/));
      await deploy(user, 'acme/api', 'main');
      await waitFor(() => expect(mocks.deploy).toHaveBeenCalled());
      expect(mocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Build now and release Alpha later?' })
      );
      expect(mocks.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          release_at: new Date(Date.parse(local)).toISOString(),
          release_notify: ['releases'],
        })
      );
    });
  });
});
