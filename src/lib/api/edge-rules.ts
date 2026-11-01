import { useEffect, useRef } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryFilters,
} from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { edgeRuleListFilters, type EdgeRule } from './queries';

/**
 * The parts of edge rules beyond the rules themselves: recorded versions of an
 * app's rule set and rollback (faas ADR-961 §2, pkg/apid/edgerules/
 * versions.go), protection suggestions from the app's own traffic
 * (ADR-20261020105000, suggestions.go), the WAF false-positive review and its
 * one-step exclusions (ADR-831 amendment 13, waf_review.go), and the account's
 * reusable rule lists (ADR-963, lists.go). Routes: faas
 * pkg/apid/apidserver/server.go:3699-3714.
 *
 * Per-app keys sit under the app's ['apps', slug, 'edge-rules'], beside the
 * rule list; `edgeRuleListFilters` (queries.ts) matches only the lists, so the
 * optimistic toggle and delete never touch a version list or a review. They
 * follow rule changes through `useEdgeRuleSetFollower`.
 */

type S = components['schemas'];
export type EdgeRuleSetVersion = S['EdgeRuleSetVersionResponse'];
export type EdgeRuleSuggestion = S['EdgeRuleRecipeSuggestion'];
export type EdgeWAFReviewGroup = S['EdgeWAFReviewGroup'];
export type EdgeRuleList = S['EdgeRuleListResponse'];
export type EdgeRuleListKind = EdgeRuleList['kind'];

const setKey = (slug: string) => ['apps', slug, 'edge-rules'] as const;
const listsKey = (accountId: string) => ['edge-rule-lists', accountId] as const;

/** What an app's rule set feeds — versions, suggestions, the review — not the rules. */
const derivedFilters = (slug: string): QueryFilters => ({
  queryKey: setKey(slug),
  predicate: ({ queryKey: k }) => k.length > 3 && k[3] !== 'account',
});

/**
 * A rule's kind payload. apid returns the stored action wrapped by kind —
 * `{"kind":"waf","waf":{…},"penalty":{…}}` — because EdgeRuleResponse
 * marshals state.EdgeRuleAction (faas pkg/apid/edgerules/rules.go:46-47,
 * pkg/state/types.go:8638-8725; handlers_edge_rules_test.go:706-714 reads it
 * so). The vendored spec documents the flat payload, which is also what
 * create and PATCH take, so both read the same here.
 */
export function ruleAction(rule: Pick<EdgeRule, 'kind' | 'action'>): unknown {
  const action = rule.action as Record<string, unknown> | null | undefined;
  if (action && typeof action === 'object' && action.kind === rule.kind)
    return (action[rule.kind] as object | undefined) ?? {};
  return action;
}

const openAPIFilters: QueryFilters = {
  predicate: (q) => q.queryKey[0] === 'apps' && q.queryKey[2] === 'openapi',
};

function rereadRules(qc: QueryClient, slug?: string) {
  return Promise.all([
    qc.invalidateQueries(edgeRuleListFilters),
    qc.invalidateQueries(openAPIFilters),
    ...(slug ? [qc.invalidateQueries({ queryKey: setKey(slug) })] : []),
  ]);
}

/**
 * Every committed change to an app's rules records a version, so whatever
 * changed the rules — this page, the CLI, a rollback — the version list, the
 * suggestions (which skip recipes already added) and the review (which marks
 * excluded CRS rules) are reread when the rule set's signature moves.
 */
export function useEdgeRuleSetFollower(slug: string, signature: string) {
  const qc = useQueryClient();
  const last = useRef(signature);
  useEffect(() => {
    if (last.current === signature) return;
    last.current = signature;
    void qc.invalidateQueries(derivedFilters(slug));
  }, [qc, slug, signature]);
}

/** Up to the 50 newest versions, newest first, without rule bodies (versions.go:94). */
export function useEdgeRuleVersions(slug: string) {
  return useQuery({
    queryKey: [...setKey(slug), 'versions'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/edge-rules/versions', { params: { path: { slug } }, signal })
      ),
    enabled: Boolean(slug),
  });
}

/** One recorded version with its rules. A version never changes once recorded. */
export function useEdgeRuleVersion(slug: string, version: number | null) {
  return useQuery({
    queryKey: [...setKey(slug), 'version', version],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/edge-rules/versions/{version}', {
          params: { path: { slug, version: version! } },
          signal,
        })
      ),
    enabled: Boolean(slug) && version !== null,
    staleTime: Infinity,
  });
}

/**
 * Restores a version's rules in one transaction (versions.go:151). `current`
 * is the latest version the person was shown: sent as If-Match, so a change
 * made since answers 412 `edge_rules_version_mismatch` instead of being rolled
 * over unseen (versions.go:47-81; the ETag is the quoted version number,
 * errors.go:6423).
 */
export function useRollbackEdgeRules(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ version, current }: { version: number; current: number }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/edge-rules/rollback', {
          params: { path: { slug } },
          body: { version },
          headers: { 'If-Match': `"${current}"` },
        })
      ),
    onSettled: () => rereadRules(qc, slug),
  });
}

/** At most five recipes, from the last 7 days of traffic (suggestions.go:28). */
export function useEdgeRuleSuggestions(slug: string) {
  return useQuery({
    queryKey: [...setKey(slug), 'suggestions'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/edge-rules/suggestions', { params: { path: { slug } }, signal })
      ),
    enabled: Boolean(slug),
  });
}

/** WAF detections over the default 7 days, grouped and assessed (waf_review.go:28). */
export function useEdgeWAFReview(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: [...setKey(slug), 'waf-review'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/edge-rules/waf-review', { params: { path: { slug } }, signal })
      ),
    enabled: Boolean(slug) && enabled,
  });
}

/**
 * Adds or removes CRS rule IDs on one kind=waf rule's exclusions, keeping the
 * rest of its action and its penalty; recorded as a new version
 * (waf_review.go:302-361).
 */
export function useUpdateWAFExclusions(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & S['EdgeWAFExclusionsRequest']) =>
      unwrap(api.POST('/v1/edge-rules/{id}/waf-exclusions', { params: { path: { id } }, body })),
    onSettled: () => rereadRules(qc, slug),
  });
}

/** The account's lists, without items (lists.go:69). Always the signed-in account's. */
export function useEdgeRuleLists(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: listsKey(accountId),
    queryFn: ({ signal }) => unwrap(api.GET('/v1/edge-rule-lists', { signal })),
    enabled: Boolean(accountId) && enabled,
  });
}

export function useEdgeRuleList(accountId: string, name: string | null) {
  return useQuery({
    queryKey: [...listsKey(accountId), name],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/edge-rule-lists/{name}', { params: { path: { name: name! } }, signal })),
    enabled: Boolean(accountId) && name !== null,
  });
}

function useListMutation<V, R>(fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // A list edit reapplies every rule that uses it (lists.go:214), so the
    // rule caches are reread as well as the lists.
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({
          predicate: (q) => q.queryKey[0] === 'edge-rule-lists',
        }),
        rereadRules(qc),
      ]),
  });
}

export function useCreateEdgeRuleList() {
  return useListMutation((body: S['CreateEdgeRuleListRequest']) =>
    unwrap(api.POST('/v1/edge-rule-lists', { body }))
  );
}

export function useUpdateEdgeRuleList() {
  return useListMutation(({ name, ...body }: { name: string } & S['UpdateEdgeRuleListRequest']) =>
    unwrap(api.PATCH('/v1/edge-rule-lists/{name}', { params: { path: { name } }, body }))
  );
}

export function useDeleteEdgeRuleList() {
  return useListMutation((name: string) =>
    unwrap(api.DELETE('/v1/edge-rule-lists/{name}', { params: { path: { name } } }))
  );
}
