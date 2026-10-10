import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

type S = components['schemas'];
export type Issue = S['Issue'];
export type IssueDetail = S['IssueDetail'];
export type IssueToken = S['IssueIngestToken'];
export type IssueTokenMetadata = Omit<IssueToken, 'token'>;
export type IssueFilters = {
  state?: string;
  environment?: string;
  assignee?: string;
  sort?: 'recent' | 'impact';
  min_customers?: number;
};
export type IssueHistoryKind = 'events' | 'releases' | 'activity';

export const issuesKey = (accountId: string, slug: string, filters: IssueFilters) =>
  ['account', accountId, 'app', slug, 'issues', filters] as const;
export const issueDetailKey = (accountId: string, slug: string, id: string, since?: string) =>
  ['account', accountId, 'app', slug, 'issue', id, 'detail', since ?? 'default-window'] as const;
export const issueHistoryKey = (
  accountId: string,
  slug: string,
  id: string,
  kind: IssueHistoryKind,
  since: string | undefined,
  firstCursor = ''
) =>
  [
    'account',
    accountId,
    'app',
    slug,
    'issue',
    id,
    kind,
    since ?? 'default-window',
    firstCursor,
  ] as const;
export const issueTokensKey = (accountId: string, slug: string) =>
  ['account', accountId, 'app', slug, 'issue-ingest-tokens'] as const;
export const issueDeploymentsKey = (accountId: string, slug: string) =>
  ['account', accountId, 'app', slug, 'issue-deployments'] as const;

export function useIssueDeployments(accountId: string, slug: string) {
  return useInfiniteQuery({
    queryKey: issueDeploymentsKey(accountId, slug),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/deployments', {
          params: {
            path: { slug },
            query: { limit: 50, ...(pageParam ? { before: pageParam } : {}) },
          },
          signal,
        })
      ),
    getNextPageParam: (page) => page.next_before,
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
  });
}

export function useIssues(accountId: string, slug: string, filters: IssueFilters) {
  return useInfiniteQuery({
    queryKey: issuesKey(accountId, slug, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/issues', {
          params: {
            path: { slug },
            query: { ...filters, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        })
      ),
    getNextPageParam: (page) => page.next_cursor,
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
  });
}

export function useIssueDetail(accountId: string, slug: string, id: string, since?: string) {
  return useQuery({
    queryKey: issueDetailKey(accountId, slug, id, since),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/issues/{issue_id}', {
          params: { path: { slug, issue_id: id }, query: since ? { since } : {} },
          signal,
        })
      ),
    enabled: Boolean(accountId && slug && id),
    retry: retryPolicy,
  });
}

const historyCursor = {
  events: 'event_cursor',
  releases: 'release_cursor',
  activity: 'activity_cursor',
} as const;
const nextHistoryCursor = {
  events: 'next_event_cursor',
  releases: 'next_release_cursor',
  activity: 'next_activity_cursor',
} as const;

/** Mount only after a detail page supplies the first opaque cursor. */
export function useIssueHistory(
  accountId: string,
  slug: string,
  id: string,
  kind: IssueHistoryKind,
  since: string | undefined,
  firstCursor: string
) {
  return useInfiniteQuery({
    queryKey: issueHistoryKey(accountId, slug, id, kind, since, firstCursor),
    initialPageParam: firstCursor,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/issues/{issue_id}', {
          params: {
            path: { slug, issue_id: id },
            query: { ...(since ? { since } : {}), [historyCursor[kind]]: pageParam },
          },
          signal,
        })
      ),
    getNextPageParam: (page) => page[nextHistoryCursor[kind]],
    enabled: Boolean(accountId && slug && id && firstCursor),
    retry: retryPolicy,
  });
}

/** Only named metadata can enter Query, including if the server adds an unexpected field. */
export function stripIssueTokenSecret(token: IssueToken): IssueTokenMetadata {
  const { id, name, app_id, deployment_id, environment, expires_at, revoked_at } = token;
  return { id, name, app_id, deployment_id, environment, expires_at, revoked_at };
}

export function useIssueTokens(accountId: string, slug: string) {
  return useQuery({
    queryKey: issueTokensKey(accountId, slug),
    queryFn: async ({ signal }) => {
      const result = await unwrap(
        api.GET('/v1/apps/{slug}/issue-ingest-tokens', {
          params: { path: { slug } },
          signal,
        })
      );
      return result.items.map(stripIssueTokenSecret);
    },
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
  });
}

/** Deliberately direct: a non-idempotent create must retain no secret in mutation state. */
export function createIssueTokenOnce(slug: string, body: S['CreateIssueIngestTokenRequest']) {
  return unwrap(
    api.POST('/v1/apps/{slug}/issue-ingest-tokens', {
      params: { path: { slug } },
      body,
    })
  );
}

export function revokeIssueToken(slug: string, tokenId: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/issue-ingest-tokens/{token_id}', {
      params: { path: { slug, token_id: tokenId } },
    })
  );
}

export function actOnIssue(
  slug: string,
  issueId: string,
  body: S['IssueActionRequest'],
  key: string
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/issues/{issue_id}/actions', {
      params: { path: { slug, issue_id: issueId } },
      headers: { 'Idempotency-Key': key },
      body,
    })
  );
}
