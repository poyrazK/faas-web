import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewAppWizard } from './new-app-wizard';

const mocks = vi.hoisted(() => ({
  addWorkflow: vi.fn(),
  bindRepo: vi.fn(),
  deployFromRef: vi.fn(),
  updateApp: vi.fn(),
  toast: vi.fn(),
  deploymentStatus: 'building',
  account: {
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
vi.mock('@/lib/api/logs', () => ({
  useLogStream: () => ({ lines: [], status: 'streaming', reason: null }),
}));
vi.mock('@/components/dashboard/repo-picker', () => ({
  RepoPicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input
      aria-label="Repository"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@/lib/store', () => ({
  useData: () => ({ addWorkflow: mocks.addWorkflow }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ loading: false, account: mocks.account }),
}));
vi.mock('@/lib/api/queries', () => ({
  useDeployment: () => ({
    data: {
      id: 'deployment-1',
      app_id: 'app-1',
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
  // The wizard reads the starter catalog to prefill from a `?template=` name.
  useTemplates: () => ({ data: [], isPending: false, error: null }),
}));

async function submitGitApp(onDeploymentAccepted = vi.fn()) {
  const user = userEvent.setup();
  const view = render(<NewAppWizard onboarding onDeploymentAccepted={onDeploymentAccepted} />);
  await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await user.type(await screen.findByLabelText(/app name/i), 'demo-app');
  await user.click(screen.getByRole('button', { name: /review/i }));
  await user.click(await screen.findByRole('button', { name: /deploy app/i }));
  return { onDeploymentAccepted, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account.plan = 'hobby';
  mocks.account.app_count = 0;
  mocks.account.github_install_id = '42';
  mocks.account.limits = { ram_mb: 512, deployed_apps: 10 };
  mocks.deploymentStatus = 'building';
  mocks.addWorkflow.mockResolvedValue({ id: 'demo-app', url: 'https://demo-app.example' });
  mocks.bindRepo.mockResolvedValue({ binding_id: 'bind-1' });
  mocks.deployFromRef.mockResolvedValue({ id: 'deployment-1' });
  mocks.updateApp.mockResolvedValue({});
});

describe('NewAppWizard Git submission', () => {
  it('keeps resource defaults available behind a named disclosure', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    const summary = await screen.findByText('Resource settings');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('128 MB · Parks when idle')).toBeVisible();
    await user.click(summary);
    expect(details).toHaveAttribute('open');
    expect(screen.getByRole('switch', { name: /scale to zero/i })).toBeVisible();
  });

  it('preserves chosen resources through review and back', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(await screen.findByLabelText('App name'), 'demo-app');
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
    await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(await screen.findByLabelText('App name'), 'demo-app');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('button', { name: 'Deploy app' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('plan limit of 10 apps');
    expect(mocks.addWorkflow).not.toHaveBeenCalled();
  });

  it('does not present a made-up per-invocation cost on review', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(await screen.findByLabelText('App name'), 'demo-app');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Deploy app' });
    expect(screen.queryByText(/Estimated cost at 100k invocations/)).not.toBeInTheDocument();
    expect(screen.getByText(/10 apps available/)).toBeInTheDocument();
  });

  it('lets a user reach Configure without an immediate name error', async () => {
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    const name = await screen.findByLabelText('App name');
    expect(name).not.toHaveAttribute('aria-invalid');
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
    await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    const name = await screen.findByLabelText('App name');
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
    mocks.deploymentStatus = 'live';
    rerender(<NewAppWizard onboarding onDeploymentAccepted={onDeploymentAccepted} />);
    expect(screen.getByRole('link', { name: 'Open app' })).toHaveAttribute(
      'href',
      'https://demo-app.example'
    );
  });

  it('prevents Free accounts from requesting a resident instance', async () => {
    mocks.account.plan = 'free';
    mocks.account.limits = { ram_mb: 128, deployed_apps: 3 };
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
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
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ id: 'deployment-2' });
    const { onDeploymentAccepted } = await submitGitApp();

    const retry = await screen.findByRole('button', { name: /try again/i });
    expect(onDeploymentAccepted).not.toHaveBeenCalled();
    await userEvent.setup().click(retry);

    await waitFor(() => expect(onDeploymentAccepted).toHaveBeenCalledTimes(1));
    expect(mocks.bindRepo).toHaveBeenCalledTimes(2);
    expect(mocks.deployFromRef).toHaveBeenCalledTimes(2);
    expect(mocks.addWorkflow).toHaveBeenCalledTimes(1);
  });
});
