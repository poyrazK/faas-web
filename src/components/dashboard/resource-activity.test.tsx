import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api/errors';
import { clockTime } from '@/lib/time';
import type { ResourceActivity } from '@/lib/api/resource-activity';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a
      href={`${to.replace(/\$(\w+)/g, (_, key: string) => params?.[key] ?? '')}${search ? '?' + new URLSearchParams(search) : ''}`}
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
  it('shows deploy/config/domain/TLS events, captured actor, time, failures and affected links', () => {
    state.rows = [
      row('4', 'deploy.failed', { deployment_id: release }),
      row('3', 'app.config_updated', {
        summary: 'Developer updated api settings (ram_mb, require_authn, public_auth)',
        data: {
          changes: [
            { field: 'ram_mb', old: 256, new: 512 },
            { field: 'require_authn' },
            { field: 'public_auth', values_redacted: true },
          ],
        },
      }),
      row('2', 'env.set'),
      row('1', 'domain.tls_issued', {
        actor: { type: 'system', label: 'Certificate manager' },
        resource: { type: 'domain', label: 'api.example.com' },
      }),
    ];
    render(<ResourceActivityTimeline appId={app} appSlug="api" />);
    expect(screen.getByRole('region', { name: 'App activity' })).toBeInTheDocument();
    expect(screen.getAllByRole('time')).toHaveLength(4);
    expect(screen.getAllByRole('time')[0]).toHaveAttribute('dateTime', '2026-10-01T12:00:00.000Z');
    expect(screen.getByText('by Certificate manager (system)')).toBeInTheDocument();
    expect(screen.getAllByRole('time')[0]).toHaveTextContent(
      clockTime(Date.parse('2026-10-01T12:00:00Z'))
    );
    expect(screen.getByText('Deployment failed')).toBeInTheDocument();
    expect(screen.getByText('App settings updated')).toBeInTheDocument();
    expect(screen.getByText('Memory limit · API key requirement · +1 more')).toBeInTheDocument();
    expect(screen.getByText('api.example.com', { selector: 'span' })).toBeInTheDocument();
    // Completed is the norm and is not spelled out.
    expect(screen.queryByText(/Completed/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View release' })).toHaveAttribute(
      'href',
      `/dashboard/apps/api/releases/${release}?panel=activity`
    );
    expect(
      ['View settings', 'View environment'].map((name) =>
        screen.getByRole('link', { name }).getAttribute('href')
      )
    ).toEqual(['/dashboard/apps/api?tab=Runtime', '/dashboard/apps/api?tab=Environment']);
    expect(screen.getByRole('link', { name: 'View domain' })).toHaveAttribute(
      'href',
      '/dashboard/domains?q=api.example.com'
    );
    expect(screen.getByRole('button', { name: 'About activity' })).toBeInTheDocument();
  });
  it('keeps unknown outcomes and actor identities explicit', () => {
    state.rows = [
      row('1', 'future.unknown', { actor: { type: 'system', label: '' }, occurred_at: 'invalid' }),
    ];
    render(<ResourceActivityTimeline appId={app} />);
    expect(screen.getByText('Outcome unknown')).toBeInTheDocument();
    expect(screen.getByText('by Unknown actor (system)')).toBeInTheDocument();
    expect(screen.getByText('Time unknown')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Date unknown' })).toBeInTheDocument();
  });
  it('groups events by day with short event titles and a separate actor line', () => {
    const now = Date.now();
    const at = (ms: number) => new Date(ms).toISOString();
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const today = midnight.getTime();
    state.rows = [
      row('3', 'deploy.failed', {
        occurred_at: at(Math.max(today, now - 60_000)),
        summary: 'Deployment of api failed (requested by Developer)',
      }),
      row('2', 'app.deployed', {
        occurred_at: at(Math.max(today, now - 120_000)),
        summary: 'Developer deployed api',
      }),
      row('1', 'env.set', { occurred_at: at(today - 6 * 60 * 60 * 1000) }),
    ];
    render(<ResourceActivityTimeline appId={app} appSlug="api" />);
    expect(screen.getByText('2 events today, 1 failed.')).toBeInTheDocument();
    const todayGroup = screen.getByRole('region', { name: 'Today' });
    expect(within(todayGroup).getAllByRole('listitem')).toHaveLength(2);
    expect(within(todayGroup).getByText('Deployment failed')).toBeInTheDocument();
    expect(within(todayGroup).getByText('Requested by Developer')).toBeInTheDocument();
    expect(within(todayGroup).getByText('Deployment completed')).toBeInTheDocument();
    expect(within(todayGroup).getByText('by Developer')).toBeInTheDocument();
    const yesterday = screen.getByRole('region', { name: 'Yesterday' });
    expect(within(yesterday).getByText('Environment variable updated')).toBeInTheDocument();
    expect(within(yesterday).getByText('by Developer')).toBeInTheDocument();
  });
  it('keeps raw kinds, ids and data behind each event’s details', async () => {
    state.rows = [row('9', 'env.set', { data: { key: 'LOG_LEVEL' } })];
    render(<ResourceActivityTimeline appId={app} />);
    const details = screen.getByText('Details').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('Details'));
    expect(details).toHaveAttribute('open');
    expect(within(details).getByText('env.set summary')).toBeVisible();
    expect(within(details).getByText('env.set')).toBeVisible();
    expect(within(details).getByText('Developer')).toBeVisible();
    expect(within(details).getByText('Event ID')).toBeVisible();
    expect(within(details).getByText('9')).toBeVisible();
    expect(details).toHaveTextContent('LOG_LEVEL');
  });
  it('shows only the exact release while providing app-wide context navigation', () => {
    state.rows = [
      row('1', 'deploy.requested', { deployment_id: release }),
      row('2', 'env.set'),
      row('3', 'deploy.failed', { deployment_id: 'c'.repeat(32) }),
    ];
    render(<ResourceActivityTimeline appId={app} appSlug="api" deploymentId={release} />);
    expect(screen.getByText('Deployment requested')).toBeInTheDocument();
    expect(screen.queryByText('Environment variable updated')).not.toBeInTheDocument();
    expect(screen.queryByText('Deployment failed')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all app activity' })).toHaveAttribute(
      'href',
      '/dashboard/apps/api?tab=Activity'
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
    expect(screen.getByText('Environment variable updated')).toBeInTheDocument();
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
