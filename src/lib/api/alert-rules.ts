import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Alert rule reads and writes beyond the list hooks in queries.ts: one rule's
 * detail, the SLOs and synthetic checks a rule can name, and the writes that
 * carry a webhook secret.
 */
export type AlertRule = components['schemas']['AlertRuleResponse'];
export type CreateAlertRule = components['schemas']['CreateAlertRuleRequest'];
export type UpdateAlertRule = components['schemas']['UpdateAlertRuleRequest'];
export type SLO = components['schemas']['SLOResponse'];
export type SyntheticCheck = components['schemas']['SyntheticCheckResponse'];

/** One rule as the {slug} app sees it (faas handlers_alerts.go:337-373). */
export function useAlertRule(slug: string, id: string) {
  return useQuery({
    queryKey: [...keys.appAlerts(slug), id],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/alerts/{id}', { params: { path: { slug, id } }, signal })),
    enabled: Boolean(slug && id),
    retry: retryPolicy,
  });
}

/**
 * The app's SLOs, for an slo_budget_* rule's `slo_id`. Callers enable it only
 * while custom-slos is on: the route is refused for an account without it.
 */
export function useAppSLOs(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['apps', slug, 'slos'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/slos', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug) && enabled,
    retry: retryPolicy,
  });
}

/** The app's synthetic checks, for a synthetic_check_* rule's `synthetic_check_id`. */
export function useAppSyntheticChecks(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['apps', slug, 'synthetics'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/synthetics', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug) && enabled,
    retry: retryPolicy,
  });
}

/**
 * Creates a rule. Direct, not a TanStack mutation: the body can carry the
 * plaintext webhook secret, which a mutation would keep in its cached
 * `variables` after the request. The caller invalidates `keys.appAlerts`.
 */
export function createAlertRuleOnce(slug: string, body: CreateAlertRule) {
  return unwrap(api.POST('/v1/apps/{slug}/alerts', { params: { path: { slug } }, body }));
}

/** Patches a rule; direct for the same reason when it sets a new webhook secret. */
export function updateAlertRuleOnce(slug: string, id: string, body: UpdateAlertRule) {
  return unwrap(api.PATCH('/v1/apps/{slug}/alerts/{id}', { params: { path: { slug, id } }, body }));
}
