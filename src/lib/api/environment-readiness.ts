import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { validEnvironment } from './projects';
import { canonicalApprovalId, validApprovalId } from './approval-id';
type S = components['schemas'];
export type EnvironmentIdentity = {
  accountId: string;
  projectId: string;
  project: string;
  target: string;
};
export type PromotionFilters = {
  source?: string;
  status?: 'running' | 'succeeded' | 'failed';
  before?: string;
};
type PreviewWire = S['ProjectEnvironmentPromotionPreviewResponse'];
type StatusWire = S['ProjectEnvironmentPromotionStatusResponse'];
type SummaryWire = S['ProjectEnvironmentPromotionSummaryResponse'];
function invalid(): never {
  throw new Error('Environment evidence identity or shape could not be confirmed.');
}
function text(value: unknown, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value) || value.length > 4096) invalid();
  return value;
}
function bool(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') invalid();
  return value;
}
function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid();
  return value as number;
}
function optionalFields<K extends string>(
  raw: object,
  fields: readonly K[]
): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {};
  for (const key of fields) {
    const value = (raw as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && value !== '') result[key] = text(value);
  }
  return result;
}
function hashes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 200)
    invalid();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(key) ||
      typeof value !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value)
    )
      invalid();
    Object.defineProperty(out, key, { value, enumerable: true });
  }
  return out;
}
async function context(identity: EnvironmentIdentity, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!identity.accountId || !identity.projectId || !validEnvironment(identity.target)) invalid();
  const account = await unwrap(api.GET('/v1/account', { signal }));
  if (account.id !== identity.accountId)
    throw new Error('The account context changed. Refresh environment evidence.');
  const project = await unwrap(
    api.GET('/v1/projects/{slug}', { params: { path: { slug: identity.project } }, signal })
  );
  signal?.throwIfAborted();
  if (project.id !== identity.projectId || project.slug !== identity.project)
    throw new Error('The project context changed. Refresh environment evidence.');
}
function release(
  raw: S['ProjectReleaseSetResponse'] | undefined,
  identity: EnvironmentIdentity,
  environment: string
) {
  if (!raw) return;
  if (
    raw.account_id !== identity.accountId ||
    raw.project_id !== identity.projectId ||
    raw.environment !== environment
  )
    invalid();
  return {
    id: text(raw.id),
    environment,
    active: bool(raw.active),
    ttl_seconds: integer(raw.ttl_seconds),
    ...optionalFields(raw, ['expires_at', 'created_at'] as const),
  };
}
function qualification(
  raw: S['ProjectEnvironmentQualificationResponse'] | undefined,
  source: string
) {
  if (!raw) return;
  if (
    raw.environment !== source ||
    !Array.isArray(raw.checks) ||
    raw.checks.length > 2 ||
    !['passed', 'failed'].includes(raw.status)
  )
    invalid();
  return {
    id: text(raw.id),
    environment: source,
    release_set_id: text(raw.release_set_id),
    status: raw.status,
    configuration_version: integer(raw.configuration_version, -1),
    configuration_hash: text(raw.configuration_hash, true),
    secret_revision_hashes: hashes(raw.secret_revision_hashes),
    ...(raw.workload_config_hashes
      ? { workload_config_hashes: hashes(raw.workload_config_hashes) }
      : {}),
    created_at: text(raw.created_at),
    expires_at: text(raw.expires_at),
    checks: raw.checks.map((check) => {
      if (!Array.isArray(check.results) || check.results.length > 200) invalid();
      return {
        name: text(check.name),
        status: text(check.status),
        results: check.results.map((result) => ({
          workload_slug: text(result.workload_slug),
          deployment_id: text(result.deployment_id),
          status: text(result.status),
          ...optionalFields(result, ['error_code'] as const),
          ...(result.http_status !== undefined ? { http_status: integer(result.http_status) } : {}),
        })),
      };
    }),
  };
}
function change(raw: S['ProjectEnvironmentPromotionChange']) {
  return {
    workload_slug: text(raw.workload_slug),
    workload_name: text(raw.workload_name),
    kind: text(raw.kind),
    ...optionalFields(raw, [
      'source_deployment_id',
      'target_deployment_id',
      'source_build_id',
      'target_build_id',
      'source_revision',
      'target_revision',
      'source_revision_kind',
      'target_revision_kind',
      'source_workload_config_hash',
      'target_workload_config_hash',
      'promoted_workload_config_hash',
    ] as const),
  };
}
export async function readPromotionPreview(
  identity: EnvironmentIdentity,
  source: string,
  signal?: AbortSignal
) {
  if (!validEnvironment(source) || source === identity.target) invalid();
  await context(identity, signal);
  const raw: PreviewWire = await unwrap(
    api.GET('/v1/projects/{slug}/environments/{environment}/promotion-preview', {
      params: {
        path: { slug: identity.project, environment: identity.target },
        query: { from: source, sync_config: false },
      },
      signal,
    })
  );
  await context(identity, signal);
  if (
    raw.project_slug !== identity.project ||
    raw.from_environment !== source ||
    raw.to_environment !== identity.target ||
    !Array.isArray(raw.changes) ||
    raw.changes.length > 200 ||
    raw.config_diff.project_slug !== identity.project ||
    raw.config_diff.from_environment !== source ||
    raw.config_diff.to_environment !== identity.target
  )
    invalid();
  if (!/^[a-f0-9]{64}$/.test(text(raw.promotion_hash))) invalid();
  const blocks = raw.blocking_reasons ?? [];
  if (!Array.isArray(blocks) || blocks.length > 200) invalid();
  return {
    project_slug: identity.project,
    from_environment: source,
    to_environment: identity.target,
    promotion_hash: raw.promotion_hash,
    can_promote: bool(raw.can_promote),
    approval_required: bool(raw.approval_required),
    to_environment_protected: bool(raw.to_environment_protected),
    qualification_required: bool(raw.qualification_required),
    release_graph_mode: bool(raw.release_graph_mode),
    sync_config: bool(raw.sync_config),
    blocking_reasons: blocks.map((reason) => text(reason)),
    config: {
      fromVersion: integer(raw.config_diff.from_version),
      toVersion: integer(raw.config_diff.to_version),
      sourceHash: text(raw.config_diff.from_hash, true),
      targetHash: text(raw.config_diff.to_hash, true),
    },
    changes: raw.changes.map(change),
    qualification: qualification(raw.qualification, source),
    sourceRelease: release(raw.from_release_set, identity, source),
    targetRelease: release(raw.to_release_set, identity, identity.target),
  };
}
function summary(raw: SummaryWire, identity: EnvironmentIdentity) {
  if (
    raw.project_slug !== identity.project ||
    raw.to_environment !== identity.target ||
    !validEnvironment(raw.from_environment)
  )
    invalid();
  return {
    promotion_id: text(raw.promotion_id),
    project_slug: identity.project,
    from_environment: raw.from_environment,
    to_environment: identity.target,
    promotion_hash: text(raw.promotion_hash),
    status: text(raw.status),
    created_at: text(raw.created_at),
    updated_at: text(raw.updated_at),
    sync_config: bool(raw.sync_config),
    ...optionalFields(raw, [
      'completed_at',
      'rollback_status',
      'verification_status',
      'verification_completed_at',
    ] as const),
  };
}
export async function readPromotionHistory(
  identity: EnvironmentIdentity,
  filters: PromotionFilters,
  signal?: AbortSignal
) {
  await context(identity, signal);
  const raw = await unwrap(
    api.GET('/v1/projects/{slug}/environments/{environment}/promotions', {
      params: {
        path: { slug: identity.project, environment: identity.target },
        query: {
          limit: 25,
          ...(filters.source ? { from: filters.source } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.before ? { before: filters.before } : {}),
        },
      },
      signal,
    })
  );
  await context(identity, signal);
  if (!Array.isArray(raw.items) || raw.items.length > 25) invalid();
  const items = raw.items.map((row) => {
    const result = summary(row, identity);
    if (
      (filters.source && result.from_environment !== filters.source) ||
      (filters.status && result.status !== filters.status)
    )
      invalid();
    return result;
  });
  return { items, ...(raw.next_before ? { nextBefore: text(raw.next_before) } : {}) };
}
export async function readPromotionReceipt(
  identity: EnvironmentIdentity,
  id: string,
  signal?: AbortSignal
) {
  text(id);
  await context(identity, signal);
  const raw: StatusWire = await unwrap(
    api.GET('/v1/projects/{slug}/environments/{environment}/promotions/{promotion}', {
      params: { path: { slug: identity.project, environment: identity.target, promotion: id } },
      signal,
    })
  );
  await context(identity, signal);
  if (raw.promotion_id !== id || !Array.isArray(raw.workloads) || raw.workloads.length > 200)
    invalid();
  return {
    ...summary(raw, identity),
    ...optionalFields(raw, [
      'rollback_started_at',
      'rollback_completed_at',
      'verification_started_at',
    ] as const),
    ...(raw.release_graph
      ? {
          release_graph: {
            ...optionalFields(raw.release_graph, [
              'source_release_set_id',
              'previous_target_release_set_id',
              'target_release_set_id',
              'restored_target_release_set_id',
            ] as const),
            ttl_seconds: integer(raw.release_graph.ttl_seconds),
          },
        }
      : {}),
    workloads: raw.workloads.map((row) => ({
      workload_slug: text(row.workload_slug),
      workload_name: text(row.workload_name),
      status: text(row.status),
      ...optionalFields(row, [
        'source_deployment_id',
        'previous_target_deployment_id',
        'target_deployment_id',
        'restored_target_deployment_id',
        'rollback_status',
        'verification_status',
      ] as const),
    })),
  };
}
export async function readApprovalReceipt(
  identity: EnvironmentIdentity,
  id: string,
  signal?: AbortSignal
) {
  const approvalId = canonicalApprovalId(id);
  if (!approvalId) invalid();
  await context(identity, signal);
  const raw = await unwrap(
    api.GET('/v1/projects/{slug}/environments/{environment}/approvals/{approval}', {
      params: {
        path: { slug: identity.project, environment: identity.target, approval: approvalId },
      },
      signal,
    })
  );
  await context(identity, signal);
  if (
    canonicalApprovalId(text(raw.approval_id)) !== approvalId ||
    raw.environment !== identity.target ||
    !['pending', 'expired', 'consumed'].includes(raw.status)
  )
    invalid();
  return {
    approval_id: approvalId,
    environment: identity.target,
    token_kind: text(raw.token_kind),
    status: raw.status,
    created_at: text(raw.created_at),
    expires_at: text(raw.expires_at),
    ...optionalFields(raw, ['consumed_at'] as const),
  };
}
export { canonicalApprovalId, validApprovalId };
// unwrap still runs session/MFA hooks. Its raw Problem must not survive in
// React Query's error state, including failures in the context fences.
async function safeRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    throw new Error('Environment evidence could not be read. Refresh the current context.');
  }
}
const key = (identity: EnvironmentIdentity) =>
  [
    'account',
    identity.accountId,
    'project',
    identity.projectId,
    identity.project,
    'environment',
    identity.target,
    'readiness',
  ] as const;
const enabled = (identity: EnvironmentIdentity) =>
  Boolean(
    identity.accountId &&
    identity.projectId &&
    identity.project &&
    validEnvironment(identity.target)
  );
export function usePromotionPreview(identity: EnvironmentIdentity, source: string) {
  return useQuery({
    queryKey: [...key(identity), 'preview', source],
    queryFn: ({ signal }) => safeRead(() => readPromotionPreview(identity, source, signal)),
    enabled: enabled(identity) && validEnvironment(source) && source !== identity.target,
    retry: false,
    staleTime: 0,
  });
}
export function usePromotionHistory(identity: EnvironmentIdentity, filters: PromotionFilters) {
  return useQuery({
    queryKey: [
      ...key(identity),
      'history',
      filters.source ?? null,
      filters.status ?? null,
      filters.before ?? null,
    ],
    queryFn: ({ signal }) => safeRead(() => readPromotionHistory(identity, filters, signal)),
    enabled: enabled(identity),
    retry: false,
    staleTime: 0,
  });
}
export function usePromotionReceipt(identity: EnvironmentIdentity, id: string) {
  return useQuery({
    queryKey: [...key(identity), 'operation', id],
    queryFn: ({ signal }) => safeRead(() => readPromotionReceipt(identity, id, signal)),
    enabled: enabled(identity) && Boolean(id),
    retry: false,
    staleTime: 0,
  });
}
export function useApprovalReceipt(identity: EnvironmentIdentity, id: string) {
  const approvalId = canonicalApprovalId(id);
  return useQuery({
    queryKey: [...key(identity), 'approval', approvalId ?? null],
    queryFn: ({ signal }) =>
      safeRead(() => readApprovalReceipt(identity, approvalId ?? '', signal)),
    enabled: enabled(identity) && Boolean(approvalId),
    retry: false,
    staleTime: 0,
  });
}
