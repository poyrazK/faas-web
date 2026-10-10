import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import {
  createIssueTokenOnce,
  issueDetailKey,
  issueHistoryKey,
  issuesKey,
  issueTokensKey,
  revokeIssueToken,
  actOnIssue,
  useIssueDetail,
  useIssueHistory,
  useIssues,
  useIssueTokens,
} from './issues';

afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it('scopes issue pages by account, app and all filters, forwarding opaque cursors and AbortSignal', async () => {
  const get = vi
    .spyOn(api, 'GET')
    .mockResolvedValueOnce({
      data: { items: [], next_cursor: 'cursor-2' },
      response: new Response(),
    } as never)
    .mockResolvedValueOnce({ data: { items: [] }, response: new Response() } as never);
  const { wrapper } = setup();
  const filters = {
    state: 'open',
    environment: 'production',
    assignee: 'me',
    sort: 'impact' as const,
    min_customers: 3,
  };
  const hook = renderHook(() => useIssues('account-1', 'app-a', filters), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(async () => {
    await hook.result.current.fetchNextPage();
  });
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/issues',
    expect.objectContaining({
      params: { path: { slug: 'app-a' }, query: { ...filters, cursor: 'cursor-2' } },
      signal: expect.any(AbortSignal),
    })
  );
  expect(issuesKey('account-1', 'app-a', filters)).not.toEqual(
    issuesKey('account-1', 'app-a', { ...filters, sort: 'recent' })
  );
  expect(issuesKey('account-1', 'app-a', filters)).not.toEqual(
    issuesKey('account-2', 'app-a', filters)
  );
});

it('keeps detail and its three histories independently keyed to the same impact window', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue({
    data: {
      issue: { id: 'i1' },
      events: [],
      releases: [],
      activity: [],
      impact: {},
      next_event_cursor: 'event-2',
    },
    response: new Response(),
  } as never);
  const { wrapper } = setup();
  const detail = renderHook(
    () => useIssueDetail('account-1', 'app-a', 'i1', '2026-10-09T00:00:00Z'),
    { wrapper }
  );
  await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/issues/{issue_id}',
    expect.objectContaining({
      params: { path: { slug: 'app-a', issue_id: 'i1' }, query: { since: '2026-10-09T00:00:00Z' } },
      signal: expect.any(AbortSignal),
    })
  );
  expect(issueHistoryKey('account-1', 'app-a', 'i1', 'events', '2026-10-09T00:00:00Z')).not.toEqual(
    issueHistoryKey('account-1', 'app-a', 'i1', 'releases', '2026-10-09T00:00:00Z')
  );
  expect(issueDetailKey('account-1', 'app-a', 'i1', '2026-10-09T00:00:00Z')).not.toEqual(
    issueDetailKey('account-1', 'app-a', 'i1', '2026-10-08T00:00:00Z')
  );
  const history = renderHook(
    () => useIssueHistory('account-1', 'app-a', 'i1', 'events', '2026-10-09T00:00:00Z', 'event-2'),
    { wrapper }
  );
  await waitFor(() => expect(history.result.current.isSuccess).toBe(true));
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/issues/{issue_id}',
    expect.objectContaining({
      params: {
        path: { slug: 'app-a', issue_id: 'i1' },
        query: { since: '2026-10-09T00:00:00Z', event_cursor: 'event-2' },
      },
      signal: expect.any(AbortSignal),
    })
  );
});

it('strips unexpected bearer fields from token metadata and keeps creation out of mutation cache', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue({
    data: {
      items: [
        {
          id: 't1',
          name: 'production',
          app_id: 'app-id',
          deployment_id: 'd1',
          environment: 'application',
          expires_at: '2026-10-11T00:00:00Z',
          token: 'g_issue_secret',
          extra_secret: 'g_issue_secret',
        },
      ],
    },
    response: new Response(),
  } as never);
  const post = vi
    .spyOn(api, 'POST')
    .mockResolvedValue({
      data: { id: 't2', token: 'g_issue_secret' },
      response: new Response(null, { status: 201 }),
    } as never);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useIssueTokens('account-1', 'app-a'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(JSON.stringify(client.getQueryData(issueTokensKey('account-1', 'app-a')))).not.toContain(
    'g_issue_secret'
  );
  expect(get).toHaveBeenCalledWith(
    '/v1/apps/{slug}/issue-ingest-tokens',
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  const created = await createIssueTokenOnce('app-a', {
    deployment_id: 'd1',
    name: 'production',
    expires_at: '2026-10-11T00:00:00Z',
  });
  expect(created.token).toBe('g_issue_secret');
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(post).toHaveBeenCalledTimes(1);
});

it('uses identified revocation and an explicit operation key for authorized issue actions', async () => {
  const remove = vi
    .spyOn(api, 'DELETE')
    .mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
  const post = vi
    .spyOn(api, 'POST')
    .mockResolvedValue({ data: { id: 'i1' }, response: new Response() } as never);
  await revokeIssueToken('app-a', 'token-id');
  expect(remove).toHaveBeenCalledWith('/v1/apps/{slug}/issue-ingest-tokens/{token_id}', {
    params: { path: { slug: 'app-a', token_id: 'token-id' } },
  });
  await actOnIssue('app-a', 'i1', { action: 'resolve', fixed_deployment_id: 'd1' }, 'operation-1');
  expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/issues/{issue_id}/actions', {
    params: { path: { slug: 'app-a', issue_id: 'i1' } },
    headers: { 'Idempotency-Key': 'operation-1' },
    body: { action: 'resolve', fixed_deployment_id: 'd1' },
  });
});
