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
vi.mock('@/components/dashboard/deployment-progress', () => ({
  DeploymentProgress: () => <div>deployment progress</div>,
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
  useBindRepoFor: () => ({ mutateAsync: mocks.bindRepo }),
  useDeployFromRefFor: () => ({ mutateAsync: mocks.deployFromRef }),
  useUpdateAppFor: () => ({ mutateAsync: mocks.updateApp }),
  // The wizard reads the starter catalog to prefill from a `?template=` name.
  useTemplates: () => ({ data: [], isPending: false, error: null }),
}));

async function submitGitApp(onDeploymentAccepted = vi.fn()) {
  const user = userEvent.setup();
  render(<NewAppWizard onboarding onDeploymentAccepted={onDeploymentAccepted} />);
  await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await user.type(await screen.findByLabelText(/function name/i), 'demo-app');
  await user.click(screen.getByRole('button', { name: /review/i }));
  await user.click(await screen.findByRole('button', { name: /deploy function/i }));
  return { onDeploymentAccepted };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account.plan = 'hobby';
  mocks.addWorkflow.mockResolvedValue({ id: 'demo-app', url: 'https://demo-app.example' });
  mocks.bindRepo.mockResolvedValue({ binding_id: 'bind-1' });
  mocks.deployFromRef.mockResolvedValue({ id: 'deployment-1' });
  mocks.updateApp.mockResolvedValue({});
});

describe('NewAppWizard Git submission', () => {
  it('prevents Free accounts from requesting a resident instance', async () => {
    mocks.account.plan = 'free';
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('switch', { name: /scale to zero/i })).toBeDisabled();
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
  });
});
