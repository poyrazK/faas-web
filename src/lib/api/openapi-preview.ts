import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

type WirePreview = components['schemas']['AppOpenAPIPolicyPreviewResponse'];
type WireRule = components['schemas']['AppOpenAPIPolicyPreviewRule'];
type WireRoute = components['schemas']['AppOpenAPIPolicyPreviewRoute'];
class PreviewContextError extends Error {}
export type PreviewRule = Omit<WireRule, 'action'>;
export type PreviewRoute = Omit<WireRoute, 'rules'> & { rules: PreviewRule[] };
export type OpenAPIPreview = Omit<WirePreview, 'routes' | 'suggestions'> & {
  routes: PreviewRoute[];
};

export const openAPIPreviewKey = (accountId: string, slug: string) =>
  ['account', accountId, 'app', slug, 'openapi-policy-preview'] as const;

/** Policy actions can contain header credentials. Cache only match metadata. */
function safePreview(value: WirePreview): OpenAPIPreview {
  return {
    app_id: value.app_id,
    source: value.source,
    observed_available: value.observed_available,
    observed_source: value.observed_source,
    observed_inventory_available: value.observed_inventory_available,
    observed_cap_hit: value.observed_cap_hit,
    collectors_expected: value.collectors_expected,
    collectors_healthy: value.collectors_healthy,
    openapi_version: value.openapi_version,
    routes: value.routes.map((route) => ({
      path: route.path,
      method: route.method,
      status: route.status,
      declared: route.declared,
      observed: route.observed,
      covered: route.covered,
      rules: (route.rules ?? []).map((rule) => ({
        id: rule.id,
        match_host: rule.match_host,
        match_path: rule.match_path,
        match_methods: rule.match_methods,
        priority: rule.priority,
        enabled: rule.enabled,
        kind: rule.kind,
        validate_mode: rule.validate_mode,
      })),
    })),
  };
}

export function previewObservation(value: OpenAPIPreview) {
  if (
    !value.observed_available ||
    value.observed_source === 'unavailable' ||
    value.collectors_expected < 1
  )
    return 'unavailable';
  if (value.observed_source === 'partial' || value.collectors_healthy !== value.collectors_expected)
    return 'partial';
  if (value.observed_cap_hit) return 'capped';
  return 'live';
}

export async function readOpenAPIPreview(accountId: string, slug: string, signal?: AbortSignal) {
  const [account, app, preview] = await Promise.all([
    unwrap(api.GET('/v1/account', { signal })),
    unwrap(api.GET('/v1/apps/{slug}', { params: { path: { slug } }, signal })),
    unwrap(api.GET('/v1/apps/{slug}/openapi/preview', { params: { path: { slug } }, signal })),
  ]);
  if (account.id !== accountId || app.id !== preview.app_id)
    throw new PreviewContextError('OpenAPI preview context changed. Refresh the selected app.');
  return safePreview(preview);
}

export function useOpenAPIPreview(accountId: string, slug: string) {
  return useQuery({
    queryKey: openAPIPreviewKey(accountId, slug),
    queryFn: ({ signal }) => readOpenAPIPreview(accountId, slug, signal),
    enabled: Boolean(accountId && slug),
    retry: (count, error) => !(error instanceof PreviewContextError) && retryPolicy(count, error),
  });
}
