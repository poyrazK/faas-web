import { ApiError } from '@/lib/api/errors';
import type { ProjectPlan } from '@/lib/api/queries';

/** What the project scanner read to produce a plan, in words. */
export const SCAN_SOURCE_LABEL: Record<ProjectPlan['scan_source'], string> = {
  k8s: 'Kubernetes manifests',
  compose: 'Docker Compose',
  procfile: 'Procfile',
  render: 'render.yaml',
  fly: 'fly.toml',
  serverless: 'serverless.yml',
  workspace: 'Workspace config',
  convention: 'Convention scan',
  single: 'Single service',
  unknown: 'Unknown layout',
};

/**
 * Why a repository scan gave no hint, as one quiet sentence.
 *
 * The scan is advisory, so none of these is an error the customer must act
 * on — the wizard works the same without it. Branches on the problem `code`
 * (the contract), never on the status or the prose.
 */
export function scanUnavailableReason(error: unknown): string {
  const code = error instanceof ApiError ? error.code : '';
  switch (code) {
    case 'source_too_large':
      return 'This repository is too large to scan here, so nothing was detected.';
    case 'not_found':
    case 'forbidden':
      return 'Gregale could not read this repository at this ref to scan it.';
    case 'validation_failed':
    case 'source_invalid':
    case 'build_undetected':
      return 'The scan could not detect a service at this ref.';
    case 'capacity_unavailable':
    case 'auth_rate_limited':
    case 'quota_exhausted':
      return 'The repository scan is busy right now, so nothing was detected.';
    default:
      return 'The repository scan is unavailable, so nothing was detected.';
  }
}
