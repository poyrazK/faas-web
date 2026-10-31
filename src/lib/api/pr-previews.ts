import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

/**
 * PR previews created from the console (B27).
 *
 * `POST /v1/apps/{slug}/previews` provisions `pr-{N}-{parent}` as its own
 * app, undeployed, with a lease (faas handlers_preview_create.go:27). It is
 * idempotent on the parent and PR number: a repeat answers 200 with the same
 * app, reopened and with its expiry moved to now + the lease (:109-129).
 * `GET /v1/preview/{slug}` is the one-preview read: the app, its parent, the
 * latest and production deployments, the difference between them and its
 * links (handlers_preview_status.go:15).
 */
export type PreviewResource = components['schemas']['PreviewResourceResponse'];
export type PreviewAppResponse = components['schemas']['AppResponse'];

/** handlers_preview_create.go:19-20 — 7 days by default, at most 30. */
export const PREVIEW_TTL_DEFAULT_HOURS = 168;
export const PREVIEW_TTL_MAX_HOURS = 720;
/** pkg/api/app_slug.go:47 — the generated slug is refused above this. */
export const PREVIEW_SLUG_MAX = 63;

export const previewKey = (slug: string) => ['preview', slug] as const;

export function previewSlugFor(parent: string, prNumber: number | string) {
  return `pr-${prNumber}-${parent}`;
}

export function validPreviewTtl(hours: number) {
  return Number.isInteger(hours) && hours >= 1 && hours <= PREVIEW_TTL_MAX_HOURS;
}

export interface CreatePreviewInput {
  parent: string;
  prNumber: number;
  ttlHours: number;
}

export function useCreatePreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ parent, prNumber, ttlHours }: CreatePreviewInput) => {
      const result = await api.POST('/v1/apps/{slug}/previews', {
        params: { path: { slug: parent } },
        body: { pr_number: prNumber, ttl_hours: ttlHours },
      });
      const app = await unwrap(Promise.resolve(result));
      // 201 is a new preview; 200 is the existing one, renewed.
      return { app, created: result.response.status === 201 };
    },
    onSuccess: ({ app }) => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      void qc.invalidateQueries({ queryKey: previewKey(app.slug) });
    },
  });
}

export function usePreview(slug: string) {
  return useQuery({
    queryKey: previewKey(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/preview/{slug}', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
    staleTime: 10_000,
  });
}
