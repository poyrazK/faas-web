import { useState, type ReactNode } from 'react';
import type { NewAppSearch } from './new-app-source';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewAppWizard } from './new-app-wizard';
import { ApiError } from '@/lib/api/errors';
import type { ProjectPlan } from '@/lib/api/queries';

const mocks = vi.hoisted(() => ({
  workspace: { org: null as string | null, label: 'Personal' },
  addWorkflow: vi.fn(),
  bindRepo: vi.fn(),
  deployFromRef: vi.fn(),
  updateApp: vi.fn(),
  toast: vi.fn(),
  issueCSRF: vi.fn(),
  readPrivate: vi.fn(),
  deploymentStatus: 'building',
  appVisibility: 'public' as 'public' | 'internal',
  deploymentApp: 'app-1',
  retry: vi.fn(),
  confirm: vi.fn(),
  scan: vi.fn(),
  capabilityState: 'available',
  apps: [] as { id: string; slug: string; url?: string }[],
  account: {
    id: 'account-1',
    plan: 'hobby' as 'free' | 'hobby' | 'pro' | 'scale',
    app_count: 0,
    github_install_id: '42',
    limits: { ram_mb: 512, deployed_apps: 10 },
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: vi.fn() }));
vi.mock('./image-deploy-form', () => ({
  ImageDeployForm: ({ kind }: { kind?: string }) => (
    <div>{kind === 'worker' ? 'OCI worker setup' : 'HTTP image setup'}</div>
  ),
}));
vi.mock('./project-import', () => ({ ProjectImport: () => null }));
vi.mock('@/lib/api/logs', () => ({
  useLogStream: () => ({ lines: [], status: 'streaming', reason: null }),
}));
vi.mock('@/components/dashboard/repo-picker', () => ({
  // The real picker forwards id/name/form/ARIA to its control; so does this,
  // so label association is asserted through the wizard's own <label>.
  RepoPicker: ({
    onChange,
    className: _className,
    ...control
  }: {
    value: string;
    onChange: (value: string) => void;
    className?: string;
  }) => <input {...control} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/lib/api/workspace-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/workspace-apps')>()),
  useWorkspaceTarget: () => mocks.workspace,
}));
vi.mock('@/lib/store', () => ({
  useData: () => ({ addWorkflow: mocks.addWorkflow }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ loading: false, account: mocks.account }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({
    accountId: mocks.account.id,
    state: mocks.capabilityState,
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/api/bindings', () => ({ readPrivateAppCreateContext: mocks.readPrivate }));
vi.mock('@/lib/api/queries', () => ({
  useApp: () => ({
    data: {
      id: 'app-1',
      slug: 'demo-app',
      visibility: mocks.appVisibility,
      url: 'https://demo-app.example',
      runtime: 'node22',
      ram_mb: 128,
    },
    isPending: false,
    isError: false,
  }),
  useApps: () => ({ data: mocks.apps }),
  useRetryDeployment: () => ({ mutateAsync: mocks.retry, isPending: false }),
  useCancelDeployment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeployment: (id: string) => ({
    data: {
      id,
      app_id: mocks.deploymentApp,
      image_digest: '',
      kind: 'tarball',
      created_at: '2026-09-12T00:00:00Z',
      status: mocks.deploymentStatus,
    },
    isError: false,
  }),
  useBindRepoFor: () => ({ mutateAsync: mocks.bindRepo }),
  useDeployFromRefFor: () => ({ mutateAsync: mocks.deployFromRef }),
  useUpdateAppFor: () => ({ mutateAsync: mocks.updateApp }),
  useSourceRefScan: (input: unknown) => mocks.scan(input),
  // The wizard reads the starter catalog to prefill from a `?template=` name.
  useTemplates: () => ({ data: [], isPending: false, error: null }),
}));
vi.mock('@/lib/api/client', () => ({ issueCSRF: mocks.issueCSRF }));

/** Choosing a repository prefills the name; replace it with an explicit one. */
async function nameApp(user: ReturnType<typeof userEvent.setup>, value: string) {
  const field = await screen.findByLabelText('App name');
  await user.clear(field);
  await user.type(field, value);
}

async function submitGitApp(onDeploymentAccepted = vi.fn()) {
  const user = userEvent.setup();
  const view = render(<NewAppWizard onboarding onDeploymentAccepted={onDeploymentAccepted} />);
  await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await nameApp(user, 'demo-app');
  await user.click(screen.getByRole('button', { name: /review/i }));
  await user.click(await screen.findByRole('button', { name: /deploy app/i }));
  return { onDeploymentAccepted, ...view };
}

beforeEach(() => {
  mocks.workspace = { org: null, label: 'Personal' };
  vi.clearAllMocks();
  mocks.account.id = 'account-1';
  mocks.account.plan = 'hobby';
  mocks.account.app_count = 0;
  mocks.account.github_install_id = '42';
  mocks.account.limits = { ram_mb: 512, deployed_apps: 10 };
  mocks.deploymentStatus = 'building';
  mocks.appVisibility = 'public';
  mocks.deploymentApp = 'app-1';
  mocks.confirm.mockResolvedValue(true);
  mocks.retry.mockResolvedValue({ id: 'b'.repeat(32), app_id: 'app-1' });
  mocks.addWorkflow.mockResolvedValue({ id: 'demo-app', url: 'https://demo-app.example' });
  mocks.bindRepo.mockResolvedValue({ binding_id: 'bind-1' });
  mocks.deployFromRef.mockResolvedValue({ id: 'deployment-1' });
  mocks.updateApp.mockResolvedValue({});
  mocks.issueCSRF.mockResolvedValue('wizard-proof');
  mocks.readPrivate.mockResolvedValue(undefined);
  mocks.scan.mockReturnValue({ plan: undefined, error: null, scanning: false });
  mocks.capabilityState = 'available';
  mocks.apps = [{ id: 'app-1', slug: 'demo-app' }];
});

afterEach(() => vi.restoreAllMocks());

describe('NewAppWizard source picker', () => {
  it('groups sources with the Git path first and names each card by its title', () => {
    render(<NewAppWizard />);
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(3);
    const [code, image, project] = groups;
    const expectCards = (group: HTMLElement, names: string[]) => {
      const cards = within(group).getAllByRole('button');
      expect(cards).toHaveLength(names.length);
      cards.forEach((card, index) => expect(card).toHaveAccessibleName(names[index]));
    };
    expect(code).toHaveAccessibleName('From code');
    expectCards(code, ['Git repository', 'Template', 'Empty app']);
    expect(image).toHaveAccessibleName('From an image');
    expectCards(image, ['Container image', 'Long-lived worker']);
    expect(project).toHaveAccessibleName('Bring an existing project');
    const importCard = within(project).getByRole('button', { name: 'Import' });
    expect(importCard).toHaveAccessibleDescription(
      /several services \(Compose, Procfile, k8s, Render, Fly, or serverless\), scanned and created together as a project/
    );
    expect(screen.getByRole('button', { name: 'Git repository' })).toHaveAccessibleDescription(
      /one service from a branch, tag, or commit/
    );
  });

  it('preselects Git when GitHub is connected', () => {
    render(<NewAppWizard />);
    expect(screen.getByRole('button', { name: 'Git repository' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByLabelText('Repository')).toBeInTheDocument();
  });

  it('leaves the choice open without a GitHub connection', () => {
    mocks.account.github_install_id = '';
    render(<NewAppWizard />);
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(6);
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
  });

  it('keeps the container images and isolated runs disclosure', async () => {
    render(<NewAppWizard />);
    const toggle = screen.getByRole('button', { name: 'Container images and isolated runs' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Isolated runs' })).toBeInTheDocument();
  });
});

function scanPlan(workloads: Partial<ProjectPlan['workloads'][number]>[]): ProjectPlan {
  return {
    project_slug: 'demo',
    scan_source: workloads.length > 1 ? 'compose' : 'single',
    tier: 'hobby',
    workloads: workloads.map((w, i) => ({
      name: `svc-${i}`,
      root_dir: '',
      command: [],
      ports: [8080],
      ...w,
    })),
    managed: [],
    crons: [],
    observed_apps: 0,
    observed_crons: 0,
    limit_apps: 10,
    limit_crons: 10,
    can_apply: true,
    plan_token: 'token',
  };
}

describe('NewAppWizard repository prefill', () => {
  it('names the app after the chosen repository, slug-safe', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/My_Demo.API');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByLabelText('App name')).toHaveValue('my-demo-api');
  });

  it('keeps a name the user typed when the repository changes', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/first');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await nameApp(user, 'my-own-name');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const repository = await screen.findByLabelText('Repository');
    await user.clear(repository);
    await user.type(repository, 'gregale/second');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByLabelText('App name')).toHaveValue('my-own-name');
  });

  it('scans the chosen repository at its ref and prefills what one service reports', async () => {
    mocks.scan.mockImplementation((input: { enabled: boolean }) => ({
      plan: input.enabled ? scanPlan([{ dockerfile: 'Dockerfile' }]) : undefined,
      error: null,
      scanning: false,
    }));
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    expect(mocks.scan).toHaveBeenLastCalledWith({
      repo: 'gregale/demo',
      ref: 'main',
      installId: 42,
      projectSlug: 'demo',
      enabled: true,
    });
    expect(screen.getByText(/One service detected \(Single service\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    const type = await screen.findByLabelText('Type');
    expect(type).toHaveValue('app');
    expect(screen.getByText(/Detected from Single service/)).toBeInTheDocument();
    await user.selectOptions(type, 'function');
    expect(type).toHaveValue('function');
    expect(screen.queryByText(/Detected from Single service/)).not.toBeInTheDocument();
  });

  it('suggests Import for a multi-service repository and carries the slug and ref over', async () => {
    mocks.scan.mockImplementation((input: { enabled: boolean }) => ({
      plan: input.enabled
        ? scanPlan([{ name: 'api' }, { name: 'worker' }, { name: 'web' }])
        : undefined,
      error: null,
      scanning: false,
    }));
    const onSearchChange = vi.fn();
    const user = userEvent.setup();
    render(<NewAppWizard search={{ source: 'git' }} onSearchChange={onSearchChange} />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/shop');
    await user.clear(screen.getByLabelText('Ref'));
    await user.type(screen.getByLabelText('Ref'), 'develop');
    expect(
      screen.getByText(
        'This repository has 3 services. Import it as a project to create them together.'
      )
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import as a project' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({
      source: 'import',
      slug: 'shop',
      branch: 'develop',
    });
  });

  it('degrades quietly when the scan fails, without blocking Continue', async () => {
    mocks.scan.mockImplementation((input: { enabled: boolean }) => ({
      plan: undefined,
      error: input.enabled
        ? new ApiError({ status: 413, code: 'source_too_large', title: 'Too large' })
        : null,
      scanning: false,
    }));
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    const note = screen.getByText(/too large to scan here/);
    expect(note).not.toHaveAttribute('role', 'alert');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByLabelText('Type')).toHaveValue('function');
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe('NewAppWizard validation', () => {
  it('explains an empty Continue with no source and focuses the first source', async () => {
    mocks.account.github_install_id = '';
    const user = userEvent.setup();
    render(<NewAppWizard />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const git = screen.getByRole('button', { name: 'Git repository' });
    expect(git).toHaveFocus();
    expect(git).toHaveAccessibleDescription(/Choose where the code comes from to continue\./);
    expect(screen.queryByLabelText('App name')).not.toBeInTheDocument();
  });

  it('asks for a GitHub connection instead of doing nothing', async () => {
    mocks.account.github_install_id = '';
    const user = userEvent.setup();
    render(<NewAppWizard />);
    await user.click(screen.getByRole('button', { name: 'Git repository' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/Connect GitHub to deploy from a repository/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Git repository' })).toHaveFocus();
  });

  it('shows an inline error on the repository and focuses it', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const repository = screen.getByLabelText('Repository');
    expect(repository).toHaveFocus();
    expect(repository).toHaveAttribute('aria-invalid', 'true');
    expect(repository).toHaveAccessibleDescription('Choose a repository to deploy.');
    await user.type(repository, 'not a repo');
    expect(repository).toHaveAccessibleDescription('Use owner/name, like acme/api.');
    expect(screen.queryByLabelText('App name')).not.toBeInTheDocument();
  });

  it('focuses an invalid ref once the repository is fine', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    const ref = screen.getByLabelText('Ref');
    await user.clear(ref);
    await user.type(ref, 'bad..ref');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(ref).toHaveFocus();
    expect(ref).toHaveAccessibleDescription(/Use a valid branch, tag, or commit SHA/);
  });

  it('labels every Git and Configure field by its visible label', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    expect(screen.getByLabelText('Repository')).toHaveAttribute('name', 'repository');
    expect(screen.getByLabelText('Ref')).toHaveValue('main');
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByLabelText('App name')).toHaveValue('demo');
    expect(screen.getByLabelText('Type')).toHaveValue('function');
    expect(screen.getByLabelText('Runtime')).toHaveValue('node22');
    expect(screen.getByLabelText('App visibility')).toHaveAccessibleDescription(
      /Internal apps have no public platform URL/
    );
  });

  it('says why Deploy is unavailable on review', async () => {
    mocks.capabilityState = 'unavailable';
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.selectOptions(await screen.findByLabelText('App visibility'), 'internal');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const deploy = await screen.findByRole('button', { name: 'Deploy app' });
    expect(deploy).toBeDisabled();
    expect(deploy).toHaveAccessibleDescription(/Internal-only apps are not confirmed/);
  });
});

describe('NewAppWizard review', () => {
  async function reviewGit(user: ReturnType<typeof userEvent.setup>) {
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await nameApp(user, 'orders-api');
  }

  it('shows the public URL the app will get, under the zone its siblings use', async () => {
    mocks.apps = [
      { id: 'a', slug: 'private-thing' },
      { id: 'b', slug: 'storefront', url: 'https://storefront.gregale.app' },
    ];
    const user = userEvent.setup();
    await reviewGit(user);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Deploy app' });
    expect(screen.getByText('Public URL').nextElementSibling).toHaveTextContent(
      'https://orders-api.gregale.app'
    );
    expect(screen.queryByText('Assigned on create')).not.toBeInTheDocument();
  });

  it('falls back to the documented platform zone for a first app', async () => {
    mocks.apps = [];
    const user = userEvent.setup();
    await reviewGit(user);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Deploy app' });
    expect(screen.getByText('Public URL').nextElementSibling).toHaveTextContent(
      'https://orders-api.gregale.dev'
    );
  });

  it('says an internal app has no public URL', async () => {
    mocks.apps = [{ id: 'b', slug: 'storefront', url: 'https://storefront.gregale.app' }];
    const user = userEvent.setup();
    await reviewGit(user);
    await user.selectOptions(screen.getByLabelText('App visibility'), 'internal');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Deploy app' });
    expect(screen.getByText('Public URL').nextElementSibling).toHaveTextContent(
      'None (internal service only)'
    );
    expect(screen.queryByText(/gregale\.app/)).not.toBeInTheDocument();
  });
});

describe('NewAppWizard Git submission', () => {
  it('keeps a restored internal deployment endpoint non-clickable after it becomes live', () => {
    mocks.appVisibility = 'internal';
    mocks.deploymentStatus = 'live';
    render(
      <NewAppWizard
        search={{
          recovery: { app: 'demo-app', repo: 'team/api', ref: 'main', deployment: 'a'.repeat(32) },
        }}
      />
    );
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy app endpoint' })).not.toBeInTheDocument();
  });
  it('reviews internal-only creation and rechecks private-app capability before POST', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await nameApp(user, 'demo-app');
    await user.selectOptions(screen.getByLabelText('App visibility'), 'internal');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const deploy = await screen.findByRole('button', { name: 'Deploy app' });
    expect(screen.getByText('Public URL').nextElementSibling).toHaveTextContent(
      'None (internal service only)'
    );
    expect(screen.getByText(/Internal apps get no public URL/)).toBeInTheDocument();
    await user.click(deploy);
    await waitFor(() => expect(mocks.readPrivate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mocks.addWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'internal' })
      )
    );
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
  });
  it('does not create an internal app after account context changes during capability recheck', async () => {
    let release!: () => void;
    mocks.readPrivate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const user = userEvent.setup();
    const view = render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await nameApp(user, 'demo-app');
    await user.selectOptions(screen.getByLabelText('App visibility'), 'internal');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(await screen.findByRole('button', { name: 'Deploy app' }));
    await waitFor(() => expect(mocks.readPrivate).toHaveBeenCalledTimes(1));
    mocks.account.id = 'account-2';
    view.rerender(<NewAppWizard onboarding />);
    release();
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/Creation choices changed/i) })
      )
    );
    expect(mocks.addWorkflow).not.toHaveBeenCalled();
  });
  it('offers container setup without a GitHub installation', async () => {
    mocks.account.github_install_id = '';
    render(<NewAppWizard />);
    const container = screen.getByRole('button', { name: 'Container image' });
    expect(container).toHaveAccessibleDescription(/Deploy an immutable HTTP image/);
    await userEvent.click(container);
    expect(await screen.findByText('HTTP image setup')).toBeInTheDocument();
    expect(screen.queryByText('Connect GitHub first')).not.toBeInTheDocument();
  });
  it('offers a direct worker source without HTTP setup', async () => {
    render(<NewAppWizard search={{ source: 'worker' }} />);
    expect(await screen.findByText('OCI worker setup')).toBeInTheDocument();
    expect(screen.queryByText('HTTP image setup')).not.toBeInTheDocument();
  });
  it.each(['submitting', 'unknown'] as const)(
    'restores %s without automatically resending a deployment',
    (phase) => {
      mocks.deploymentStatus = 'failed';
      render(
        <NewAppWizard
          onboarding
          search={{
            recovery: {
              app: 'demo-app',
              repo: 'team/api',
              ref: 'main',
              deployment: 'a'.repeat(32),
              phase,
            },
          }}
        />
      );
      expect(screen.getByText(/outcome is unknown/i)).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Retry original deployment' })
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Deploy a fix' })).not.toBeInTheDocument();
      expect(mocks.retry).not.toHaveBeenCalled();
      expect(mocks.deployFromRef).not.toHaveBeenCalled();
      expect(mocks.addWorkflow).not.toHaveBeenCalled();
    }
  );

  it('follows the new ID after an accepted original retry', async () => {
    mocks.deploymentStatus = 'failed';
    const onSearchChange = vi.fn();
    render(
      <NewAppWizard
        onboarding
        search={{
          recovery: { app: 'demo-app', repo: 'team/api', ref: 'main', deployment: 'a'.repeat(32) },
        }}
        onSearchChange={onSearchChange}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry original deployment' }));
    await waitFor(() =>
      expect(onSearchChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          recovery: {
            app: 'demo-app',
            repo: 'team/api',
            ref: 'main',
            deployment: 'b'.repeat(32),
            phase: undefined,
          },
        }),
        { replace: true }
      )
    );
    expect(mocks.retry).toHaveBeenCalledWith({ id: 'a'.repeat(32), from_stage: 'source_download' });
    expect(mocks.addWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'not-an-id', app_id: 'app-1' },
    { id: 'a'.repeat(32), app_id: 'app-1' },
    { id: 'b'.repeat(32), app_id: 'other-app' },
  ])('does not follow an invalid fixed-ref response %j', async (response) => {
    mocks.deploymentStatus = 'failed';
    mocks.deployFromRef.mockResolvedValueOnce(response);
    render(
      <NewAppWizard
        onboarding
        search={{
          recovery: { app: 'demo-app', repo: 'team/api', ref: 'main', deployment: 'a'.repeat(32) },
        }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Deploy a fix' }));
    await userEvent.click(screen.getByRole('button', { name: 'Deploy fixed ref' }));
    expect(await screen.findByText(/outcome is unknown/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deploy fixed ref' })).toBeDisabled();
    expect(mocks.deployFromRef).toHaveBeenCalledTimes(1);
  });

  it('keeps the original attempt source when a proposed fixed ref is rejected', async () => {
    mocks.deploymentStatus = 'failed';
    mocks.deployFromRef.mockRejectedValueOnce(
      new ApiError({ status: 422, code: 'source_invalid', title: 'Ref not found' })
    );
    const onSearchChange = vi.fn();
    render(
      <NewAppWizard
        onboarding
        search={{
          recovery: { app: 'demo-app', repo: 'team/api', ref: 'main', deployment: 'a'.repeat(32) },
        }}
        onSearchChange={onSearchChange}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Deploy a fix' }));
    await userEvent.clear(screen.getByLabelText('Branch, tag, or commit'));
    await userEvent.type(screen.getByLabelText('Branch, tag, or commit'), 'missing-fix');
    await userEvent.click(screen.getByRole('button', { name: 'Deploy fixed ref' }));
    await waitFor(() =>
      expect(onSearchChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          recovery: expect.objectContaining({
            deployment: 'a'.repeat(32),
            ref: 'main',
            phase: 'rejected',
          }),
        }),
        { replace: true }
      )
    );
  });

  it('keeps correction available when the server explicitly rejects an original retry', async () => {
    mocks.deploymentStatus = 'failed';
    mocks.retry.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'source_invalid', title: 'Source expired' })
    );
    render(
      <NewAppWizard
        onboarding
        search={{
          recovery: { app: 'demo-app', repo: 'team/api', ref: 'main', deployment: 'a'.repeat(32) },
        }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry original deployment' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deploy a fix' })).toBeEnabled());
    expect(screen.queryByText(/outcome is unknown/i)).not.toBeInTheDocument();
  });

  it('deploys an explicitly chosen fixed ref into the saved app, without replaying the checked SHA', async () => {
    mocks.deploymentStatus = 'failed';
    mocks.deployFromRef.mockResolvedValueOnce({ id: 'c'.repeat(32), app_id: 'app-1' });
    const onSearchChange = vi.fn();
    render(
      <NewAppWizard
        onboarding
        search={{
          recovery: {
            app: 'demo-app',
            repo: 'team/api',
            ref: 'a'.repeat(40),
            deployment: 'a'.repeat(32),
          },
        }}
        onSearchChange={onSearchChange}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Deploy a fix' }));
    expect(screen.getByLabelText('Repository')).toHaveValue('team/api');
    expect(screen.getByLabelText('Branch, tag, or commit')).toHaveValue('');
    await user.type(screen.getByLabelText('Branch, tag, or commit'), 'feature/fix');
    await user.click(screen.getByRole('button', { name: 'Deploy fixed ref' }));
    await waitFor(() =>
      expect(mocks.deployFromRef).toHaveBeenCalledWith({
        slug: 'demo-app',
        repo: 'team/api',
        ref: 'feature/fix',
        format: 'tarball',
      })
    );
    expect(onSearchChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recovery: expect.objectContaining({
          app: 'demo-app',
          deployment: 'c'.repeat(32),
          ref: 'feature/fix',
        }),
      }),
      { replace: true }
    );
    expect(mocks.addWorkflow).not.toHaveBeenCalled();
    expect(mocks.bindRepo).not.toHaveBeenCalled();
  });

  it('does not resubmit after an ambiguous fixed-ref response', async () => {
    mocks.deploymentStatus = 'failed';
    mocks.deployFromRef.mockRejectedValueOnce(new TypeError('Network connection lost'));
    render(
      <NewAppWizard
        onboarding
        search={{
          recovery: { app: 'demo-app', repo: 'team/api', ref: 'main', deployment: 'a'.repeat(32) },
        }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Deploy a fix' }));
    await userEvent.click(screen.getByRole('button', { name: 'Deploy fixed ref' }));
    expect(await screen.findByText(/outcome is unknown/i)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Retry original deployment' })
    ).not.toBeInTheDocument();
    expect(mocks.deployFromRef).toHaveBeenCalledTimes(1);
  });

  it('saves the existing app pointer even when initial source submission is rejected', async () => {
    mocks.deployFromRef.mockRejectedValueOnce(
      new ApiError({ status: 422, code: 'source_invalid', title: 'Invalid source' })
    );
    const onSearchChange = vi.fn();
    const onAppCreated = vi.fn();
    const user = userEvent.setup();
    function Journey() {
      const [search, setSearch] = useState<NewAppSearch>({ source: 'git' });
      return (
        <NewAppWizard
          onboarding
          search={search}
          onAppCreated={onAppCreated}
          onSearchChange={(next, options) => {
            onSearchChange(next, options);
            setSearch(next);
          }}
        />
      );
    }
    render(<Journey />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await nameApp(user, 'demo-app');
    await user.click(screen.getByRole('button', { name: /review/i }));
    await user.click(await screen.findByRole('button', { name: /deploy app/i }));
    await waitFor(() =>
      expect(onSearchChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          recovery: { app: 'demo-app', repo: 'gregale/demo', ref: 'main', phase: 'rejected' },
        }),
        { replace: true }
      )
    );
    expect(mocks.addWorkflow).toHaveBeenCalledTimes(1);
    expect(onAppCreated).toHaveBeenCalledTimes(1);
  });

  it('resumes the failed attempt from a recovery URL without creating another app', () => {
    mocks.deploymentStatus = 'failed';
    render(
      <NewAppWizard
        onboarding
        search={{
          recovery: { app: 'demo-app', repo: 'team/api', ref: 'main', deployment: 'a'.repeat(32) },
        }}
      />
    );
    expect(screen.getByRole('heading', { name: 'Deployment failed' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry original deployment' })).toBeVisible();
    expect(mocks.addWorkflow).not.toHaveBeenCalled();
  });

  it('does not offer recovery actions for an attempt belonging to another app', () => {
    mocks.deploymentStatus = 'failed';
    mocks.deploymentApp = 'different-app';
    render(
      <NewAppWizard
        onboarding
        search={{
          recovery: { app: 'demo-app', repo: 'team/api', ref: 'main', deployment: 'a'.repeat(32) },
        }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/does not belong to this app/i);
    expect(
      screen.queryByRole('button', { name: 'Retry original deployment' })
    ).not.toBeInTheDocument();
  });

  it('connects GitHub with proof and preserves the onboarding return marker', async () => {
    mocks.account.github_install_id = '';
    const onConnectGitHub = vi.fn();
    let posted: FormData | undefined;
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
      this: HTMLFormElement
    ) {
      expect(onConnectGitHub).toHaveBeenCalledTimes(1);
      posted = new FormData(this);
    });
    render(<NewAppWizard onboarding onConnectGitHub={onConnectGitHub} />);

    await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(mocks.issueCSRF).toHaveBeenCalledWith('connect_github');
    expect(posted?.get('csrf_token')).toBe('wizard-proof');
    expect(posted?.get('return_to')).toBe('/dashboard/settings?section=integrations');
  });

  it('keeps resource defaults available behind a named disclosure', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    const summary = await screen.findByText('Resource settings');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    // The configuration step fades in; finding its text does not mean the
    // entrance animation has made it visible yet.
    await waitFor(() => expect(screen.getByText('128 MB · Parks when idle')).toBeVisible());
    await user.click(summary);
    expect(details).toHaveAttribute('open');
    expect(screen.getByRole('switch', { name: /scale to zero/i })).toBeVisible();
  });

  it('preserves chosen resources through review and back', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await nameApp(user, 'demo-app');
    await user.click(screen.getByText('Resource settings'));
    await user.click(screen.getByRole('button', { name: '256 MB' }));
    await user.click(screen.getByRole('switch', { name: /scale to zero/i }));
    expect(screen.getByText('256 MB · One instance kept resident')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Deploy app' });
    expect(screen.getByText('256 MB')).toBeInTheDocument();
    expect(screen.getByText('One instance kept resident')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect(screen.getByText('256 MB · One instance kept resident')).toBeVisible()
    );
    await user.click(screen.getByText('Resource settings'));
    expect(screen.getByRole('button', { name: '256 MB' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('switch', { name: /scale to zero/i })).not.toBeChecked();
    expect(mocks.addWorkflow).not.toHaveBeenCalled();
  });

  it('keeps quota-full deployment blocked and explains why', async () => {
    mocks.account.app_count = 10;
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await nameApp(user, 'demo-app');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('button', { name: 'Deploy app' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('plan limit of 10 apps');
    expect(mocks.addWorkflow).not.toHaveBeenCalled();
  });

  it('does not present a made-up per-invocation cost on review', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await nameApp(user, 'demo-app');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Deploy app' });
    expect(screen.queryByText(/Estimated cost at 100k invocations/)).not.toBeInTheDocument();
    expect(screen.getByText(/10 apps available/)).toBeInTheDocument();
  });

  it('lets a user reach Configure without an immediate name error', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    const name = await screen.findByLabelText('App name');
    expect(name).not.toHaveAttribute('aria-invalid');
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter an app name.');
    expect(mocks.addWorkflow).not.toHaveBeenCalled();
    await user.type(name, 'demo-app');
    expect(name).not.toHaveAttribute('aria-invalid');
  });

  it('validates on blur and submits Configure with Enter without creating an app', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    const name = await screen.findByLabelText('App name');
    await user.clear(name);
    await user.type(name, '-ab');
    expect(name).not.toHaveAttribute('aria-invalid');
    await user.tab();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Use 3–40 lowercase letters');
    await user.clear(name);
    await user.type(name, 'Demo-App{Enter}');
    expect(await screen.findByRole('button', { name: 'Deploy app' })).toBeEnabled();
    expect(screen.getByText('demo-app')).toBeInTheDocument();
    expect(mocks.addWorkflow).not.toHaveBeenCalled();
  });

  it('keeps the endpoint non-interactive until the first deployment is live', async () => {
    const { rerender, onDeploymentAccepted } = await submitGitApp();
    await screen.findByRole('heading', { name: 'Building your app' });
    expect(
      screen.queryByRole('link', { name: 'https://demo-app.example' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Call it' })).not.toBeInTheDocument();
    mocks.deploymentStatus = 'live';
    rerender(<NewAppWizard onboarding onDeploymentAccepted={onDeploymentAccepted} />);
    expect(screen.getByRole('link', { name: 'Open app' })).toHaveAttribute(
      'href',
      'https://demo-app.example'
    );
    const callIt = screen.getByRole('region', { name: 'Call it' });
    expect(callIt).toHaveTextContent('curl -i https://demo-app.example');
    expect(callIt).toHaveTextContent('gregale logs demo-app --follow');
  });

  it('prevents Free accounts from requesting a resident instance', async () => {
    mocks.account.plan = 'free';
    mocks.account.limits = { ram_mb: 128, deployed_apps: 3 };
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await user.click(await screen.findByText('Resource settings'));
    expect(screen.getByRole('switch', { name: /scale to zero/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: '128 MB' })).toBeEnabled();
    for (const memory of [256, 512, 1024, 2048]) {
      expect(screen.getByRole('button', { name: `${memory} MB` })).toBeDisabled();
    }
    expect(screen.getByText(/requires a paid plan/i)).toBeInTheDocument();
  });

  it('binds the new app before submitting its first source deployment', async () => {
    await submitGitApp();

    await waitFor(() => expect(mocks.deployFromRef).toHaveBeenCalledTimes(1));
    expect(mocks.bindRepo).toHaveBeenCalledWith({
      slug: 'demo-app',
      installationId: 42,
      repo: 'gregale/demo',
      branch: 'main',
    });
    expect(mocks.bindRepo.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deployFromRef.mock.invocationCallOrder[0]
    );
  });

  it('does not complete onboarding when deployment is rejected', async () => {
    mocks.deployFromRef.mockRejectedValueOnce(new Error('GitHub unavailable'));
    const { onDeploymentAccepted } = await submitGitApp();

    await waitFor(() => expect(mocks.deployFromRef).toHaveBeenCalledTimes(1));
    expect(onDeploymentAccepted).not.toHaveBeenCalled();
  });

  it('does not submit source when repository binding fails', async () => {
    mocks.bindRepo.mockRejectedValueOnce(new Error('binding failed'));
    const { onDeploymentAccepted } = await submitGitApp();

    await waitFor(() => expect(mocks.bindRepo).toHaveBeenCalledTimes(1));
    expect(mocks.deployFromRef).not.toHaveBeenCalled();
    expect(onDeploymentAccepted).not.toHaveBeenCalled();
  });

  it('completes onboarding after a successful accepted deployment', async () => {
    const { onDeploymentAccepted } = await submitGitApp();

    await waitFor(() => expect(onDeploymentAccepted).toHaveBeenCalledTimes(1));
  });

  it('completes onboarding when retry later receives a deployment id', async () => {
    mocks.deployFromRef
      .mockRejectedValueOnce(
        new ApiError({ status: 422, code: 'source_invalid', title: 'Source unavailable' })
      )
      .mockResolvedValueOnce({ id: 'b'.repeat(32), app_id: 'app-1' });
    const { onDeploymentAccepted } = await submitGitApp();

    const retry = await screen.findByRole('button', { name: 'Deploy a fix' });
    expect(onDeploymentAccepted).not.toHaveBeenCalled();
    await userEvent.setup().click(retry);
    await userEvent.click(screen.getByRole('button', { name: 'Deploy fixed ref' }));

    await waitFor(() => expect(onDeploymentAccepted).toHaveBeenCalledTimes(1));
    expect(mocks.bindRepo).toHaveBeenCalledTimes(1);
    expect(mocks.deployFromRef).toHaveBeenCalledTimes(2);
    expect(mocks.addWorkflow).toHaveBeenCalledTimes(1);
  });
});
