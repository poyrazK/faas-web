import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  query: {} as { data?: unknown; isPending: boolean; error: unknown; refetch: () => void },
  sync: vi.fn(),
  disconnect: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/github-connection', () => ({
  useGitHubConnection: () => state.query,
  useSyncGitHub: () => ({ mutateAsync: state.sync, isPending: false }),
  useDisconnectGitHub: () => ({ mutateAsync: state.disconnect, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search?: Record<string, string>;
    children: ReactNode;
  }) => <a href={`${to}?${new URLSearchParams(search).toString()}`}>{children}</a>,
}));

const { GitHubConnectionPanel } = await import('./github-connection');

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const bound = {
  state: 'bound',
  health: 'healthy',
  connected: true,
  installation_id: 48213377,
  github_login: 'acme-corp',
  default_branch: 'main',
  repo_full_name: 'acme-corp/storefront',
  production_branch: 'release',
  binding_id: 'bind-app-1-acme-corp/storefront',
  linked_at: minutesAgo(60 * 24 * 3),
  last_reconciled_at: minutesAgo(12),
  last_reconcile_repository_count: 4,
  last_reconcile_detached_count: 0,
  activity: {
    webhook_deliveries: [
      {
        event_type: 'push',
        status: 'succeeded',
        commit_sha: '9f2c4e1a7b3d5f60718293a4b5c6d7e8f9012345',
        received_at: minutesAgo(30),
        updated_at: minutesAgo(29),
      },
    ],
    check_updates: [
      {
        deployment_id: '1b8f3c2e-4d5a-4e6f-9a0b-1c2d3e4f5a6b',
        status: 'dead',
        commit_sha: '9f2c4e1a7b3d5f60718293a4b5c6d7e8f9012345',
        updated_at: minutesAgo(28),
      },
    ],
  },
};

function show(data: unknown) {
  state.query = { data, isPending: false, error: null, refetch: vi.fn() };
  return render(<GitHubConnectionPanel slug="storefront" />);
}

beforeEach(() => {
  state.sync.mockReset();
  state.disconnect.mockReset();
  state.confirm.mockReset();
  state.toast.mockReset();
});

describe('a bound app', () => {
  it('shows the installation, repository, production branch, last sync and activity', () => {
    show(bound);
    const panel = screen.getByRole('region', { name: /github/i });
    expect(within(panel).getByRole('link', { name: 'acme-corp/storefront' })).toHaveAttribute(
      'href',
      'https://github.com/acme-corp/storefront'
    );
    expect(within(panel).getByText('release')).toBeInTheDocument();
    expect(within(panel).getByText(/acme-corp · 48213377/)).toBeInTheDocument();
    expect(within(panel).getByText('12m ago')).toBeInTheDocument();
    expect(within(panel).getByText(/healthy/i)).toBeInTheDocument();
    // A dead Check Run update is the reason a PR shows no Gregale status.
    expect(within(panel).getByText(/check run/i)).toBeInTheDocument();
    expect(within(panel).getAllByText('9f2c4e1')).toHaveLength(2);
    expect(within(panel).getByText('Failed')).toBeInTheDocument();
  });

  it('surfaces a degraded installation with the reconcile error', () => {
    show({ ...bound, health: 'degraded', last_reconcile_error: 'GitHub returned 401' });
    expect(screen.getByText(/degraded/i)).toBeInTheDocument();
    expect(screen.getByText('GitHub returned 401')).toBeInTheDocument();
  });

  it('syncs on demand and reports what GitHub can see', async () => {
    state.sync.mockResolvedValue({
      ...bound,
      sync_result: { detached: false, remote_repository_count: 4, synced_at: minutesAgo(0) },
    });
    show(bound);
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(state.sync).toHaveBeenCalledOnce();
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'GitHub connection synced' })
    );
  });

  it('says so when a sync detached a repository GitHub no longer shares', async () => {
    state.sync.mockResolvedValue({
      ...bound,
      state: 'installed',
      connected: false,
      repo_full_name: undefined,
      sync_result: { detached: true, remote_repository_count: 3, synced_at: minutesAgo(0) },
    });
    show(bound);
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'info',
        title: 'Repository detached',
        description: expect.stringMatching(/no longer has access to acme-corp\/storefront/),
      })
    );
  });

  it.each([
    ['github_install_not_found', /reconnect github/i],
    ['github_unreachable', /could not reach github/i],
    ['validation_failed', /reload/i],
  ])('explains a %s sync failure', async (code, copy) => {
    state.sync.mockRejectedValue(
      new ApiError({ status: 409, code, title: 'x', detail: 'server prose' } as never)
    );
    show(bound);
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', description: expect.stringMatching(copy) })
      )
    );
  });

  it('disconnects only after a destructive confirm that says what stops and what stays', async () => {
    state.confirm.mockResolvedValue(false);
    show(bound);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        title: 'Disconnect push-to-deploy?',
        description: expect.stringMatching(
          /pushes to acme-corp\/storefront no longer deploy.*app and its deployments stay/is
        ),
      })
    );
    expect(state.disconnect).not.toHaveBeenCalled();

    state.confirm.mockResolvedValue(true);
    state.disconnect.mockResolvedValue({ ...bound, state: 'installed', connected: false });
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(state.disconnect).toHaveBeenCalledOnce());
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Push-to-deploy disconnected' })
    );
  });
});

describe('an app without a binding', () => {
  it('says pushes do not deploy it and points at the CLI link command', () => {
    show({
      state: 'installed',
      health: 'healthy',
      connected: false,
      installation_id: 48213377,
      github_login: 'acme-corp',
      last_reconcile_repository_count: 4,
      last_reconcile_detached_count: 0,
    });
    expect(screen.getByText(/pushes do not deploy this app/i)).toBeInTheDocument();
    expect(
      screen.getByText('gregale github link storefront --repo OWNER/NAME')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('sends an account without an installation to the integrations settings', () => {
    show({
      state: 'not_installed',
      health: 'not_connected',
      connected: false,
      last_reconcile_repository_count: 0,
      last_reconcile_detached_count: 0,
    });
    expect(screen.getByRole('link', { name: /connect github/i })).toHaveAttribute(
      'href',
      '/dashboard/settings?section=integrations'
    );
  });
});

it('keeps a failed read distinct from a missing binding', () => {
  state.query = {
    data: undefined,
    isPending: false,
    error: new ApiError({ status: 503, code: 'capacity', title: 'x', detail: 'down' } as never),
    refetch: vi.fn(),
  };
  render(<GitHubConnectionPanel slug="storefront" />);
  expect(screen.getByRole('alert')).toHaveTextContent('down');
  expect(screen.queryByText(/pushes do not deploy/i)).not.toBeInTheDocument();
});
