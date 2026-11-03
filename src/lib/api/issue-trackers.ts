import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError } from './errors';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Issue tracker references and the app owner's Linear connection (faas
 * docs/issues.md § GitHub and Linear tracker links, § Connect a Linear team,
 * § Native Linear ticket creation), gated on `issue-trackers`; and deployment
 * source maps (§ Publish deployment artifacts), gated on `issues`.
 *
 * The Linear API key and webhook secret are write-only: they go out in one
 * direct PUT and never enter the query cache or a mutation's state, and the
 * connection read returns metadata only.
 */
type S = components['schemas'];
export type LinearConnection = S['IssueTrackerLinearConnection'];
export type TrackerLink = S['IssueTrackerLink'];
export type TicketResult = S['NativeIssueTicketResult'];
export type SourceMaps = S['IssueSourceMapsMetadata'];
export type SourceMapManifest = S['IssueSourceMapManifest'];

export const linearConnectionKey = (accountId: string, slug: string) =>
  ['account', accountId, 'app', slug, 'issue-tracker-linear-connection'] as const;
export const trackerLinksKey = (accountId: string, slug: string, issueId: string) =>
  ['account', accountId, 'app', slug, 'issue', issueId, 'tracker-links'] as const;
export const sourceMapsKey = (accountId: string, slug: string, deploymentId: string) =>
  ['account', accountId, 'app', slug, 'deployment', deploymentId, 'issue-source-maps'] as const;

export function useLinearConnection(accountId: string, slug: string) {
  return useQuery({
    queryKey: linearConnectionKey(accountId, slug),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/issue-tracker-linear-connection', {
          params: { path: { slug } },
          signal,
        })
      ),
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
  });
}

/**
 * Connects or disconnects. Deliberately direct: the body carries the API key
 * and webhook secret, which a TanStack mutation would keep in its variables.
 */
export function configureLinearOnce(
  slug: string,
  body: S['UpdateIssueTrackerLinearConnectionRequest']
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/issue-tracker-linear-connection', {
      params: { path: { slug } },
      body,
    })
  );
}

/** Create or recover one Linear ticket; the caller keeps `request_id` across retries. */
export function createLinearTicketOnce(
  slug: string,
  issueId: string,
  body: S['CreateNativeLinearIssueTicketRequest']
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/issues/{issue_id}/native-linear-tickets', {
      params: { path: { slug, issue_id: issueId } },
      body,
    })
  );
}

export function useTrackerLinks(accountId: string, slug: string, issueId: string) {
  return useInfiniteQuery({
    queryKey: trackerLinksKey(accountId, slug, issueId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/issues/{issue_id}/tracker-links', {
          params: {
            path: { slug, issue_id: issueId },
            query: pageParam ? { cursor: pageParam } : {},
          },
          signal,
        })
      ),
    getNextPageParam: (page) => page.next_cursor,
    enabled: Boolean(accountId && slug && issueId),
    retry: retryPolicy,
  });
}

export function saveTrackerLink(
  slug: string,
  issueId: string,
  body: S['PutIssueTrackerLinkRequest']
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/issues/{issue_id}/tracker-links', {
      params: { path: { slug, issue_id: issueId } },
      body,
    })
  );
}

export function removeTrackerLink(slug: string, issueId: string, linkId: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/issues/{issue_id}/tracker-links/{link_id}', {
      params: { path: { slug, issue_id: issueId, link_id: linkId } },
    })
  );
}

/** apid answers `not_found` for a deployment with nothing published (handlers_issues.go:129-130). */
export function isNothingPublished(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'not_found';
}

/** A deployment's source-map readiness; `not_found` means nothing was published for it. */
export function useSourceMaps(accountId: string, slug: string, deploymentId: string) {
  return useQuery({
    queryKey: sourceMapsKey(accountId, slug, deploymentId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/deployments/{deployment_id}/issue-source-maps', {
          params: { path: { slug, deployment_id: deploymentId } },
          signal,
        })
      ),
    enabled: Boolean(accountId && slug && deploymentId),
    retry: (count, error) => !isNothingPublished(error) && retryPolicy(count, error),
  });
}

/** Direct: the manifest can be megabytes, and the answer is what the page shows. */
export function publishSourceMaps(
  slug: string,
  deploymentId: string,
  body: S['PublishIssueSourceMapsRequest']
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/deployments/{deployment_id}/issue-source-maps', {
      params: { path: { slug, deployment_id: deploymentId } },
      body,
    })
  );
}

export function retireSourceMaps(slug: string, deploymentId: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/deployments/{deployment_id}/issue-source-maps', {
      params: { path: { slug, deployment_id: deploymentId } },
    })
  );
}

/** apid's upload cap: 4 MiB plus 64 KiB of envelope (docs/issues.md § Publish deployment artifacts). */
export const SOURCE_MAP_UPLOAD_BYTES = 4 * 1024 * 1024 + 64 * 1024;

/**
 * Reads a generated `.gregale-issue-maps.json` (from `gregale-issue-source-maps`)
 * just far enough to send it: the shape the spec requires. apid compiles and
 * bounds-checks the maps itself and answers with its own reasons.
 */
export function parseManifest(text: string): SourceMapManifest | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'The file is not JSON. Choose the manifest that gregale-issue-source-maps wrote.';
  }
  const m = value as Partial<SourceMapManifest> | null;
  if (!m || typeof m !== 'object' || m.version !== 1 || !Array.isArray(m.artifacts))
    return 'The file is not a version 1 source-map manifest (it needs "version": 1 and "artifacts").';
  if (m.artifacts.length < 1 || m.artifacts.length > 32)
    return `A manifest holds 1 to 32 maps; this one has ${m.artifacts.length}.`;
  const bad = m.artifacts.find(
    (a) =>
      !a ||
      typeof a.generatedFile !== 'string' ||
      typeof a.payload !== 'string' ||
      typeof a.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(a.sha256)
  );
  if (bad) return 'Every artifact needs generatedFile, a 64-character hex sha256 and a payload.';
  return m as SourceMapManifest;
}
