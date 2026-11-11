import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  query: {} as { data?: unknown; isPending: boolean; error: unknown; refetch: () => void },
  sync: vi.fn(),
  disconnect: vi.fn(),
  retry: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  workspace: { org: null as string | null, label: 'Personal', ready: true },
}));
vi.mock('@/lib/api/github-connection', () => ({
  useGitHubConnection: () => state.query,
  useSyncGitHub: () => ({ mutateAsync: state.sync, isPending: false }),
  useDisconnectGitHub: () => ({ mutateAsync: state.disconnect, isPending: false }),
  useRetryGitHubActivity: () => ({ mutateAsync: state.retry, isPending: false }),
}));
vi.mock('@/lib/api/queries', () => ({
  useApp: () => ({ data: { project_id: undefined }, isPending: false, error: null }),
  useBindRepo: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => state.workspace }));
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

const open = (name: RegExp | string) => userEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  state.sync.mockReset();
  state.disconnect.mockReset();
  state.retry.mockReset();
  state.confirm.mockReset();
  state.toast.mockReset();
  state.workspace = { org: null, label: 'Personal', ready: true };
});

describe('a bound app', () => {
  it('opens with which pushes deploy the app, from the binding', () => {
    show(bound);
    expect(screen.getByRole('region', { name: 'How code reaches this app' })).toHaveTextContent(
      'Pushes to release on acme-corp/storefront deploy storefront.'
    );
    expect(screen.getByRole('region', { name: 'How code reaches this app' })).toHaveTextContent(
      '1 recent GitHub update failed'
    );
  });

  it('shows the installation, repository, production branch, last sync and activity', async () => {
    show(bound);
    const panel = screen.getByRole('region', { name: /github/i });
    expect(within(panel).queryByText(/acme-corp · 48213377/)).not.toBeInTheDocument();
    await open('Show connection details');
    await open(/show recent activity/i);
    expect(within(panel).getByRole('link', { name: 'acme-corp/storefront' })).toHaveAttribute(
      'href',
      'https://github.com/acme-corp/storefront'
    );
    // The production branch heads the branch deployments list.
    expect(
      within(within(panel).getByRole('list', { name: 'Branch deployments' })).getAllByRole(
        'listitem'
      )[0]
    ).toHaveTextContent('release deploys to Production');
    expect(within(panel).getByText(/acme-corp · 48213377/)).toBeInTheDocument();
    expect(within(panel).getByText('12m ago')).toBeInTheDocument();
    expect(within(panel).getByText(/healthy/i)).toBeInTheDocument();
    // A dead Check Run update is the reason a PR shows no Gregale status.
    expect(within(panel).getByText('Check Run')).toBeInTheDocument();
    expect(within(panel).getAllByText('9f2c4e1')).toHaveLength(2);
    expect(within(panel).getByText('Failed')).toBeInTheDocument();
  });

  it('keeps the deployment-policy scope caveat behind the connection details', async () => {
    show(bound);
    expect(screen.queryByText(/github:manage scope/)).not.toBeInTheDocument();
    await open('Show connection details');
    expect(screen.getByText(/only to API keys with the github:manage scope/)).toBeInTheDocument();
  });

  it('surfaces a degraded installation with the reconcile error', () => {
    show({ ...bound, health: 'degraded', last_reconcile_error: 'GitHub returned 401' });
    expect(screen.getByText(/connection needs attention/i)).toBeInTheDocument();
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
    ['validation_failed', /expired before it arrived. Try again/i],
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

  it('shows which branch deploys where', () => {
    show({ ...bound, deploy_branches: { staging: 'staging' } });
    const list = screen.getByRole('list', { name: 'Branch deployments' });
    expect(within(list).getByText('release')).toBeInTheDocument();
    expect(within(list).getByText('staging environment')).toBeInTheDocument();
  });

  it('marks a failed row with an icon as well as colour and a label', async () => {
    show(bound);
    await open(/show recent activity/i);
    const failed = screen.getByText('Failed');
    expect(failed.closest('span')?.querySelector('svg')).not.toBeNull();
  });

  it('retries failed activity with a fresh key per press and reports the counts', async () => {
    state.retry.mockResolvedValue({
      ok: true,
      retried_webhooks: 2,
      retried_checks: 1,
      status: 'pending',
    });
    show(bound);
    await userEvent.click(screen.getByRole('button', { name: 'Retry failed activity' }));
    await userEvent.click(screen.getByRole('button', { name: 'Retry failed activity' }));
    expect(state.retry).toHaveBeenCalledTimes(2);
    const [[first], [second]] = state.retry.mock.calls as [[string], [string]];
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        title: 'Failed GitHub activity queued again',
        description: expect.stringMatching(/2 pushes and 1 Check Run update/),
      })
    );
  });

  it('says so when nothing was left to retry', async () => {
    state.retry.mockResolvedValue({
      ok: true,
      retried_webhooks: 0,
      retried_checks: 0,
      status: 'pending',
    });
    show(bound);
    await userEvent.click(screen.getByRole('button', { name: 'Retry failed activity' }));
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'Nothing to retry' })
      )
    );
  });

  it('offers no retry when nothing recent failed', () => {
    show({
      ...bound,
      activity: { webhook_deliveries: bound.activity.webhook_deliveries, check_updates: [] },
    });
    expect(screen.queryByRole('button', { name: 'Retry failed activity' })).not.toBeInTheDocument();
  });

  it.each([
    ['github_not_bound', 409, /no longer bound to a repository/],
    ['validation_failed', 400, /expired before it arrived/],
    ['capacity_unavailable', 503, /recovery is unavailable right now/],
  ])('explains a refused retry (%s)', async (code, status, copy) => {
    state.retry.mockRejectedValue(new ApiError({ status, code, title: 'x', detail: 'prose' }));
    show(bound);
    await userEvent.click(screen.getByRole('button', { name: 'Retry failed activity' }));
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'error',
          title: 'Could not retry GitHub activity',
          description: expect.stringMatching(copy),
        })
      )
    );
    if (code === 'github_not_bound') expect(state.query.refetch).toHaveBeenCalled();
  });

  it('names the organization when its role rules refuse a retry', async () => {
    state.workspace = { org: 'acme-corp', label: 'Acme Corp', ready: true };
    state.retry.mockRejectedValue(
      new ApiError({ status: 403, code: 'org_role_forbidden', title: 'x', detail: 'prose' })
    );
    show(bound);
    await userEvent.click(screen.getByRole('button', { name: 'Retry failed activity' }));
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringMatching(
            /created the app, while they are an owner or admin of Acme Corp/
          ),
        })
      )
    );
  });

  it('disconnects only after a destructive confirm that says what stops and what stays', async () => {
    state.confirm.mockResolvedValue(false);
    show(bound);
    await open('More GitHub actions');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect' }));
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
    await open('More GitHub actions');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect' }));
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
    expect(screen.getByText(/pushes don’t deploy it/i)).toBeInTheDocument();
    expect(
      screen.getByText('gregale github link storefront --repo OWNER/NAME')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More GitHub actions' })).not.toBeInTheDocument();
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
  expect(screen.queryByText(/pushes don’t deploy/i)).not.toBeInTheDocument();
});

it('explains why a company app’s connection reads as not found', () => {
  // GitHub bindings stay with the account that made them (faas
  // docs/organization-app-access.md); the /install handlers answer 404 to a
  // member the grant does not make the binding's owner (auth_facade.go:551-556).
  state.workspace = { org: 'acme-corp', label: 'Acme Corp', ready: true };
  state.query = {
    data: undefined,
    isPending: false,
    error: new ApiError({ status: 404, code: 'not_found', title: 'x', detail: 'no such app' }),
    refetch: vi.fn(),
  };
  render(<GitHubConnectionPanel slug="storefront" />);
  expect(screen.getByRole('status')).toHaveTextContent(
    /GitHub connections are not shared through Acme Corp yet/
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
