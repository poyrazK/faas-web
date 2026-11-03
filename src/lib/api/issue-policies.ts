import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Issue alert policies and shared saved views (faas docs/issues.md § Event-
 * frequency alerts, § New-issue and regression alert policy, § Compound
 * alerts, § Shared saved inbox views). The policies are gated on the
 * `issue-alert-policies` capability and the views on `issue-saved-views`,
 * both children of `issues`.
 *
 * Every policy write replaces the whole policy against the revision it was
 * read at, so a write is a direct call that returns the saved policy; the
 * caller puts that answer in the cache rather than reading it again.
 */
type S = components['schemas'];
export type ImpactPolicy = S['IssueImpactAlertPolicy'];
export type FrequencyPolicy = S['IssueFrequencyAlertPolicy'];
export type FrequencyRule = S['IssueFrequencyAlertRule'];
export type LifecyclePolicy = S['IssueLifecycleAlertPolicy'];
export type LifecyclePreview = S['IssueLifecycleAlertPreview'];
export type CompoundPolicy = S['IssueCompoundAlertPolicy'];
export type CompoundRule = S['IssueCompoundAlertRule'];
export type CompoundPreview = S['IssueCompoundAlertPreview'];
export type SavedView = S['IssueSavedView'];
export type SavedViewFilters = S['IssueSavedViewFilters'];

type Policy = 'impact' | 'frequency' | 'lifecycle' | 'compound';
export const issuePolicyKey = (accountId: string, slug: string, policy: Policy) =>
  ['account', accountId, 'app', slug, 'issue-alert-policy', policy] as const;
export const savedViewsKey = (accountId: string, slug: string) =>
  ['account', accountId, 'app', slug, 'issue-saved-views'] as const;

const enabled = (accountId: string, slug: string) => Boolean(accountId && slug);

export function useImpactPolicy(accountId: string, slug: string) {
  return useQuery({
    queryKey: issuePolicyKey(accountId, slug, 'impact'),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/issue-impact-alert-policy', { params: { path: { slug } }, signal })
      ),
    enabled: enabled(accountId, slug),
    retry: retryPolicy,
  });
}

export function useFrequencyPolicy(accountId: string, slug: string) {
  return useQuery({
    queryKey: issuePolicyKey(accountId, slug, 'frequency'),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/issue-frequency-alert-policy', {
          params: { path: { slug } },
          signal,
        })
      ),
    enabled: enabled(accountId, slug),
    retry: retryPolicy,
  });
}

export function useLifecyclePolicy(accountId: string, slug: string) {
  return useQuery({
    queryKey: issuePolicyKey(accountId, slug, 'lifecycle'),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/issue-lifecycle-alert-policy', {
          params: { path: { slug } },
          signal,
        })
      ),
    enabled: enabled(accountId, slug),
    retry: retryPolicy,
  });
}

export function useCompoundPolicy(accountId: string, slug: string) {
  return useQuery({
    queryKey: issuePolicyKey(accountId, slug, 'compound'),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/issue-compound-alert-policy', {
          params: { path: { slug } },
          signal,
        })
      ),
    enabled: enabled(accountId, slug),
    retry: retryPolicy,
  });
}

export function setImpactPolicy(slug: string, minimum_customers: number) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/issue-impact-alert-policy', {
      params: { path: { slug } },
      body: { minimum_customers },
    })
  );
}

export function setFrequencyPolicy(
  slug: string,
  body: S['UpdateIssueFrequencyAlertPolicyRequest']
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/issue-frequency-alert-policy', { params: { path: { slug } }, body })
  );
}

export function setLifecyclePolicy(
  slug: string,
  body: S['UpdateIssueLifecycleAlertPolicyRequest']
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/issue-lifecycle-alert-policy', { params: { path: { slug } }, body })
  );
}

export function setCompoundPolicy(slug: string, body: S['UpdateIssueCompoundAlertPolicyRequest']) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/issue-compound-alert-policy', { params: { path: { slug } }, body })
  );
}

/** Read-only: no save, no cooldown reserved, nothing sent (openapi previewIssueLifecycleAlert). */
export function previewLifecycleAlert(slug: string, body: S['PreviewIssueLifecycleAlertRequest']) {
  return unwrap(
    api.POST('/v1/apps/{slug}/issue-lifecycle-alert-policy/preview', {
      params: { path: { slug } },
      body,
    })
  );
}

/** Read-only evaluation of an unsaved rule against retained evidence. */
export function previewCompoundAlert(slug: string, body: S['PreviewIssueCompoundAlertRequest']) {
  return unwrap(
    api.POST('/v1/apps/{slug}/issue-compound-alert-policy/preview', {
      params: { path: { slug } },
      body,
    })
  );
}

/** Writes a policy's answer into the cache, so the next edit starts from its revision. */
export function useStorePolicy(accountId: string, slug: string) {
  const qc = useQueryClient();
  return <T>(policy: Policy, value: T) =>
    qc.setQueryData(issuePolicyKey(accountId, slug, policy), value);
}

export function useSavedViews(accountId: string, slug: string) {
  return useQuery({
    queryKey: savedViewsKey(accountId, slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/issue-saved-views', { params: { path: { slug } }, signal })),
    enabled: enabled(accountId, slug),
    retry: retryPolicy,
  });
}

export function putSavedView(slug: string, key: string, body: S['PutIssueSavedViewRequest']) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/issue-saved-views/{view_key}', {
      params: { path: { slug, view_key: key } },
      body,
    })
  );
}

export function deleteSavedView(slug: string, key: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/issue-saved-views/{view_key}', {
      params: { path: { slug, view_key: key } },
    })
  );
}

/** A stable view key from its name: lowercase, digits and dashes, 48 at most. */
export function viewKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}
