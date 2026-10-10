import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const createApp = vi.hoisted(() => vi.fn());
const deployGit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/create-and-deploy', () => ({
  useCreateAndDeploy: () => ({ createApp, deployGit }),
}));
const account = vi.hoisted(() => ({
  value: {
    plan: 'free',
    app_count: 1,
    limits: { deployed_apps: 3, ram_mb: 256 },
    github_install_id: '42',
  } as Record<string, unknown>,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: account.value }) }));
vi.mock('@/components/dashboard/repo-picker', () => ({
  RepoPicker: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (r: string, b?: string) => void;
  }) => (
    <input
      aria-label="Repository"
      value={value}
      onChange={(e) => onChange(e.target.value, 'main')}
    />
  ),
}));
const deployments = vi.hoisted(() => ({ value: [] as { id: string }[] }));
vi.mock('@/lib/api/queries', () => ({
  useAppDeployments: () => ({ data: { pages: [{ items: deployments.value }] } }),
}));

const { StepGit } = await import('./step-git');
const { StepCli } = await import('./step-cli');

describe('StepGit', () => {
  it('derives the name from the repo and previews its URL', () => {
    render(<StepGit onLaunched={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'acme/api' } });
    expect(screen.getByLabelText('App name')).toHaveValue('api');
    expect(screen.getByText('api.gregale.app')).toBeInTheDocument();
  });

  it('creates, deploys and launches', async () => {
    createApp.mockResolvedValue({ id: 'api' });
    deployGit.mockResolvedValue({ id: 'dep1' });
    const onLaunched = vi.fn();
    render(<StepGit onLaunched={onLaunched} />);
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'acme/api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deploy api' }));
    await waitFor(() =>
      expect(onLaunched).toHaveBeenCalledWith({
        slug: 'api',
        source: 'git',
        repo: 'acme/api',
        ref: 'main',
        deploymentId: 'dep1',
      })
    );
  });

  it('still launches when the build could not be submitted, carrying the reason', async () => {
    createApp.mockResolvedValue({ id: 'api' });
    deployGit.mockRejectedValue(new Error('Connect GitHub before deploying from a repository.'));
    const onLaunched = vi.fn();
    render(<StepGit onLaunched={onLaunched} />);
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'acme/api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deploy api' }));
    await waitFor(() =>
      expect(onLaunched).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'api',
          submitError: 'Connect GitHub before deploying from a repository.',
        })
      )
    );
  });

  it('keeps the card open with the reason when the app cannot be created', async () => {
    createApp.mockRejectedValue(new Error('"api" already exists.'));
    const onLaunched = vi.fn();
    render(<StepGit onLaunched={onLaunched} />);
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'acme/api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deploy api' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(onLaunched).not.toHaveBeenCalled();
  });

  it('says the plan limit before deploy, with the real numbers', () => {
    account.value = { ...account.value, app_count: 3 };
    render(<StepGit onLaunched={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'acme/api' } });
    expect(screen.getByText("You're using 3 of 3 apps on Free")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deploy api' })).toBeDisabled();
    account.value = { ...account.value, app_count: 1 };
  });
});

describe('StepCli', () => {
  it('shows the verified commands once the app exists, and launches when the first deploy lands', async () => {
    createApp.mockResolvedValue({ id: 'acme-api' });
    const onLaunched = vi.fn();
    const { rerender } = render(<StepCli onLaunched={onLaunched} />);
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'acme-api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create acme-api' }));
    expect(await screen.findByText(/gregale deploy --name acme-api/)).toBeInTheDocument();
    expect(screen.getByText(/curl -fsSL https:\/\/get\.gregale\.dev \| sh/)).toBeInTheDocument();
    deployments.value = [{ id: 'dep9' }];
    rerender(<StepCli onLaunched={onLaunched} />);
    await waitFor(() =>
      expect(onLaunched).toHaveBeenCalledWith({
        slug: 'acme-api',
        source: 'cli',
        deploymentId: 'dep9',
      })
    );
    deployments.value = [];
  });

  it('lets you do it later', async () => {
    createApp.mockResolvedValue({ id: 'acme-api' });
    const onLaunched = vi.fn();
    render(<StepCli onLaunched={onLaunched} />);
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'acme-api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create acme-api' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Do it later' }));
    expect(onLaunched).toHaveBeenCalledWith({ slug: 'acme-api', source: 'cli' });
  });
});
