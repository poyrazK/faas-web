import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { projects } from './projects';
import { environmentInventory } from './environments';
type S = components['schemas'];
export const mockApprovalId = '00000000-0000-4000-8000-000000000010';
export function mockPromotionPreview(
  project: string,
  target: string,
  source: string
): S['ProjectEnvironmentPromotionPreviewResponse'] | undefined {
  const owner = projects.find((p) => p.slug === project);
  if (
    !owner ||
    target === source ||
    !environmentInventory(project)?.some((e) => e.slug === target) ||
    !environmentInventory(project)?.some((e) => e.slug === source)
  )
    return;
  const hash = (source === 'staging' ? 'b' : 'a').repeat(64),
    targetHash = (target === 'production' ? 'a' : 'b').repeat(64);
  return {
    project_slug: project,
    from_environment: source,
    to_environment: target,
    to_environment_protected: target === 'production',
    approval_required: target === 'production',
    can_promote: false,
    blocking_reasons: [
      'The fixture qualification has expired. Review current source and target before any operation.',
    ],
    promotion_hash: 'c'.repeat(64),
    promotion_token: 'mock-preview-identity-not-used-by-console',
    release_graph_mode: false,
    qualification_required: true,
    config_diff: {
      project_slug: project,
      from_environment: source,
      to_environment: target,
      from_version: 1,
      to_version: 1,
      from_hash: hash,
      to_hash: targetHash,
      changes: [],
    },
    changes: owner.workloads.map((workload) => ({
      workload_slug: workload.slug,
      workload_name: workload.workload_name,
      kind: 'update',
      source_revision: 'b'.repeat(40),
      target_revision: 'a'.repeat(40),
      source_revision_kind: 'commit_sha',
      target_revision_kind: 'commit_sha',
      source_workload_config_hash: hash,
      target_workload_config_hash: targetHash,
    })),
    qualification: {
      id: '00000000-0000-4000-8000-000000000020',
      environment: source,
      release_set_id: '00000000-0000-4000-8000-000000000021',
      configuration_version: 1,
      configuration_hash: hash,
      secret_revision_hashes: Object.fromEntries(
        owner.workloads.map((w) => [w.slug, 'd'.repeat(64)])
      ),
      status: 'passed',
      created_at: db.iso(30 * 60 * 60 * 1000),
      expires_at: db.iso(6 * 60 * 60 * 1000),
      checks: [
        { name: 'health', status: 'passed', results: [] },
        { name: 'smoke', status: 'passed', results: [] },
      ],
    },
  };
}
export function mockPromotionHistory(
  project: string,
  target: string
): S['ProjectEnvironmentPromotionSummaryResponse'][] | undefined {
  if (!environmentInventory(project)?.some((e) => e.slug === target)) return;
  return [1, 2].map((n) => ({
    promotion_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    project_slug: project,
    from_environment: target === 'production' ? 'staging' : 'production',
    to_environment: target,
    promotion_hash: 'c'.repeat(64),
    status: n === 1 ? 'failed' : 'running',
    verification_status: n === 1 ? 'failed' : 'pending',
    ...(n === 1 ? { rollback_status: 'rollback_failed' as const } : {}),
    created_at: db.iso(n * 60 * 60 * 1000),
    updated_at: db.iso(30 * 60 * 1000),
  }));
}
export function mockPromotionReceipt(
  project: string,
  target: string,
  id: string
): S['ProjectEnvironmentPromotionStatusResponse'] | undefined {
  const row = mockPromotionHistory(project, target)?.find((p) => p.promotion_id === id);
  if (!row) return;
  return {
    ...row,
    workloads: projects
      .find((p) => p.slug === project)!
      .workloads.map((w, i) => ({
        workload_slug: w.slug,
        workload_name: w.workload_name,
        status: i === 0 ? 'promoted' : 'pending',
        target_deployment_id: db.deployments.find(
          (d) => d.app_id === db.apps.find((a) => a.slug === w.slug)?.id
        )?.id,
        ...(i === 0 ? { verification_status: 'failed' as const } : {}),
        rollback_status: 'failed',
      })),
  };
}
