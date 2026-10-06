import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api/errors';
import type { ResourceActivity } from '@/lib/api/resource-activity';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string;
    params?: { workflowId: string };
    search?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a
      href={`${to.replace('$workflowId', params?.workflowId ?? '')}${search ? '?' + new URLSearchParams(search) : ''}`}
    >
      {children}
    </a>
  ),
}));
const state = vi.hoisted(() => ({
  account: 'account-1',
  workspaceError: null as unknown,
  error: null as unknown,
  pending: false,
  rows: [] as unknown[],
  next: false,
  nextError: false,
  refetch: vi.fn(),
  load: vi.fn(),
  workspace: vi.fn(),
  filters: {} as Record<string, unknown>,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: state.account } }) }));
vi.mock('@/lib/api/resource-activity', async (original) => ({
  ...(await original<object>()),
  useActivityWorkspace: () => ({
    data: state.workspaceError ? undefined : { slug: 'team', name: 'Team' },
    isPending: false,
    error: state.workspaceError,
    refetch: state.workspace,
    isFetching: false,
  }),
  useResourceActivity: (
    _account: string,
    _workspace: string,
    _app: string,
    filters: Record<string, unknown>
  ) => {
    state.filters = filters;
    return {
      data: { pages: [{ items: state.rows }] },
      isPending: state.pending,
      error: state.error,
      hasNextPage: state.next,
      isFetching: false,
      isFetchingNextPage: false,
      isFetchNextPageError: state.nextError,
      fetchNextPage: state.load,
      refetch: state.refetch,
    };
  },
}));
import { ResourceActivityTimeline } from './resource-activity';
const app = 'a'.repeat(32),
  release = 'b'.repeat(32);
function row(id: string, kind: string, options: Partial<ResourceActivity> = {}): ResourceActivity {
  return {
    id,
    app_id: app,
    occurred_at: '2026-10-01T12:00:00Z',
    kind,
    summary: `${kind} summary`,
    actor: { type: 'user', label: 'Developer' },
    resource: { type: 'app', label: 'api' },
    data: {},
    ...options,
  };
}
beforeEach(() => {
  state.account = 'account-1';
  state.workspaceError = null;
  state.error = null;
  state.pending = false;
  state.rows = [];
  state.next = false;
  state.nextError = false;
  state.refetch.mockReset();
  state.load.mockReset();
  state.workspace.mockReset();
});
describe('resource activity timeline', () => {
  it('shows deploy/config/domain/TLS events, captured actor, exact UTC time, outcome and affected links', () => {
    state.rows = [
      row('4', 'deploy.failed', { deployment_id: release }),
      row('3', 'app.config_updated'),
      row('2', 'env.set'),
      row('1', 'domain.tls_issued', {
        actor: { type: 'system', label: 'Certificate manager' },
        resource: { type: 'domain', label: 'api.example.com' },
      }),
    ];
    render(<ResourceActivityTimeline appId={app} appSlug="api" />);
    expect(screen.getByRole('region', { name: 'App activity' })).toBeInTheDocument();
    expect(screen.getAllByText('2026-10-01 12:00:00 UTC')).toHaveLength(4);
    expect(screen.getByText('Actor: Certificate manager (system)')).toBeInTheDocument();
    expect(screen.getByText('Outcome: Failed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View affected release' })).toHaveAttribute(
      'href',
      `/dashboard/deployments?deployment=${release}&releaseSection=audit`
    );
    expect(
      screen
        .getAllByRole('link', { name: 'View affected configuration' })
        .map((link) => link.getAttribute('href'))
    ).toEqual([
      '/dashboard/workflows/api?tab=Configuration',
      '/dashboard/workflows/api?tab=Env+vars',
    ]);
    expect(screen.getByRole('link', { name: 'View affected domain' })).toHaveAttribute(
      'href',
      '/dashboard/domains?q=api.example.com'
    );
    expect(screen.getByText(/retention expiry/)).toBeInTheDocument();
    expect(screen.getByText(/Historical coverage can be incomplete/)).toBeInTheDocument();
  });
  it('keeps unknown outcomes and actor identities explicit', () => {
    state.rows = [
      row('1', 'future.unknown', { actor: { type: 'system', label: '' }, occurred_at: 'invalid' }),
    ];
    render(<ResourceActivityTimeline appId={app} />);
    expect(screen.getByText('Outcome: Recorded — outcome not provided')).toBeInTheDocument();
    expect(screen.getByText('Actor: Unknown actor (system)')).toBeInTheDocument();
    expect(screen.getByText('Timestamp unavailable')).toBeInTheDocument();
  });
  it('shows only the exact release while providing app-wide context navigation', () => {
    state.rows = [
      row('1', 'deploy.requested', { deployment_id: release }),
      row('2', 'env.set'),
      row('3', 'deploy.failed', { deployment_id: 'c'.repeat(32) }),
    ];
    render(<ResourceActivityTimeline appId={app} appSlug="api" deploymentId={release} />);
    expect(screen.getByText('deploy.requested summary')).toBeInTheDocument();
    expect(screen.queryByText('env.set summary')).not.toBeInTheDocument();
    expect(screen.queryByText('deploy.failed summary')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all app activity' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/api?tab=Activity'
    );
  });
  it('changes server filters and clears them on account changes', async () => {
    const view = render(<ResourceActivityTimeline appId={app} />);
    await userEvent.selectOptions(screen.getByLabelText('Event category'), 'domain.');
    await userEvent.selectOptions(screen.getByLabelText('Actor category'), 'system');
    expect(state.filters).toEqual({ kind_prefix: 'domain.', actor_type: 'system' });
    state.account = 'account-2';
    view.rerender(<ResourceActivityTimeline appId={app} />);
    expect(state.filters).toEqual({});
  });
  it('shows permission limits and retries failed workspace resolution', async () => {
    state.workspaceError = new ApiError({
      status: 403,
      code: 'org_role_forbidden',
      title: 'Forbidden',
    });
    render(<ResourceActivityTimeline appId={app} />);
    expect(screen.getByRole('alert')).toHaveTextContent('workspace role');
    await userEvent.click(screen.getByRole('button', { name: 'Retry activity read' }));
    expect(state.workspace).toHaveBeenCalledOnce();
  });
  it('preserves loaded evidence and retries older-page errors using the same cursor', async () => {
    state.rows = [row('1', 'env.set')];
    state.next = true;
    state.nextError = true;
    state.error = new Error('Older page unavailable');
    render(<ResourceActivityTimeline appId={app} />);
    expect(screen.getByText('env.set summary')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Loaded events remain available');
    await userEvent.click(screen.getByRole('button', { name: 'Retry activity read' }));
    expect(state.load).toHaveBeenCalledOnce();
    expect(state.refetch).not.toHaveBeenCalled();
  });
  it('allows older pages when the loaded app page contains no release match', async () => {
    state.rows = [row('1', 'env.set')];
    state.next = true;
    render(<ResourceActivityTimeline appId={app} deploymentId={release} />);
    expect(screen.getByText('No matching events in the loaded history.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load older activity' }));
    expect(state.load).toHaveBeenCalledOnce();
  });
  it('renders loading and initial read failures without claiming empty history', () => {
    state.pending = true;
    const view = render(<ResourceActivityTimeline appId={app} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading resource activity');
    expect(screen.queryByText('No matching events in the loaded history.')).not.toBeInTheDocument();
    state.pending = false;
    state.error = new Error('API unavailable');
    view.rerender(<ResourceActivityTimeline appId={app} />);
    expect(screen.getByRole('alert')).toHaveTextContent('API unavailable');
  });
});
