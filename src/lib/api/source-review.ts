import { useMutation } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

/**
 * Reviewed-source releases: resolve a connected GitHub branch or commit to one
 * immutable commit and pin the app's release configuration, then deploy
 * exactly that, with the review as `expected_source`. faas decides it in
 * handlers_source_review.go; the MCP plan/apply pair is the reference client
 * (pkg/mcpmanagement/source_releases.go).
 */

export type SourceReview = components['schemas']['SourceReviewResponse'];
type SourceRefDeployRequest = components['schemas']['SourceRefDeployRequest'];

/**
 * `POST /v1/apps/{slug}/source-review`: resolves without building. A mutation,
 * not a query, because the answer is a point-in-time pin the person then acts
 * on, not a view to keep fresh.
 */
export function useReviewSource(slug: string) {
  return useMutation({
    mutationFn: (body: { repo: string; ref: string }) =>
      unwrap(api.POST('/v1/apps/{slug}/source-review', { params: { path: { slug } }, body })),
    retry: false,
  });
}

/**
 * How a reviewed commit reaches traffic. Request-mode apps are staged at 0%
 * and promoted separately; services and workers have no 0% staging and are
 * handed over natively (handlers_source_ref.go:148-155). Source review refuses
 * every other mode (handlers_source_review.go:36-39).
 */
export type ReviewedRollout = 'stage' | 'service' | 'worker';

export function reviewedRollout(executionMode: string | null | undefined): ReviewedRollout | null {
  if (!executionMode || executionMode === 'request') return 'stage';
  if (executionMode === 'service' || executionMode === 'worker') return executionMode;
  return null;
}

/**
 * The deploy body apid accepts with a review: the reviewed commit as `ref`,
 * `no_triggers`, and none of the rollout overrides (reviewedSourceStage,
 * handlers_source_review.go:122-138). Staging is `traffic_percent: 0`; a native
 * rollout omits traffic (handlers_release_review.go:56-59).
 */
export function reviewedDeployBody(
  review: SourceReview,
  rollout: ReviewedRollout
): SourceRefDeployRequest {
  const body: SourceRefDeployRequest = {
    repo: review.repo,
    ref: review.commit_sha,
    format: 'tarball',
    no_triggers: true,
    expected_source: review,
  };
  return rollout === 'stage'
    ? { ...body, traffic_percent: 0 }
    : { ...body, native_rollout: rollout };
}

/**
 * What apid would refuse about this review before anything is sent
 * (validateReviewedStage, handlers_release_review.go:56-61), in words.
 */
export function reviewBlocker(review: SourceReview, rollout: ReviewedRollout): string | null {
  const serving = review.release_review.serving_deployment_ids.length;
  if (serving > 1)
    return `Traffic is split across ${serving} releases. A reviewed release needs one serving baseline, so finish or recover the rollout, then review again.`;
  if (rollout !== 'stage' && review.release_review.protected)
    return 'This target is protected, so a reviewed native rollout cannot start here.';
  return null;
}
