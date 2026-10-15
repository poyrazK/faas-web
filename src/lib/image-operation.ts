import type { components } from './api/schema';
import { imageRequest } from './oci-image';
type CreateRequest = components['schemas']['CreateAppRequest'];
export type ImageCreateRequest = Pick<
  CreateRequest,
  | 'slug'
  | 'type'
  | 'ram_mb'
  | 'idle_timeout_s'
  | 'visibility'
  | 'execution_mode'
  | 'restart_policy'
  | 'startup_deadline_s'
  | 'max_retries'
>;
export type ImageWorkloadKind = 'http' | 'worker';
export interface ImageOperation {
  version: 1;
  workloadKind?: ImageWorkloadKind;
  accountId: string;
  existingSlug: string;
  createKey: string;
  deployKey: string;
  createdAt: number;
  attemptAt: number;
  createRequest: CreateRequest;
  deployRequest: components['schemas']['CreateDeploymentRequest'];
  stage:
    | 'create-pending'
    | 'create-rejected'
    | 'app-created'
    | 'credentials'
    | 'deploy-submitting'
    | 'deploy-unknown'
    | 'deploy-rejected'
    | 'accepted';
  appId?: string;
  endpoint?: string;
  deploymentId?: string;
  needsCredentials?: boolean;
}
const operationKey = (accountId: string, slug: string, kind: ImageWorkloadKind = 'http') =>
  `gregale.${kind === 'worker' ? 'worker-image-operation' : 'image-operation'}:${accountId}:${slug || 'new'}`;
export function newImageOperation(
  accountId: string,
  createRequest: ImageCreateRequest,
  deployRequest: ImageOperation['deployRequest'],
  existingSlug = '',
  workloadKind: ImageWorkloadKind = 'http'
): ImageOperation {
  return {
    version: 1,
    ...(workloadKind === 'worker' ? { workloadKind } : {}),
    accountId,
    existingSlug,
    createKey: crypto.randomUUID(),
    deployKey: crypto.randomUUID(),
    createdAt: Date.now(),
    attemptAt: Date.now(),
    createRequest: {
      cpu_millicores: 1000,
      head_wakes: false,
      crawler_policy: 'wake',
      visibility: createRequest.visibility ?? 'public',
      ...createRequest,
    },
    deployRequest,
    stage: 'create-pending',
  };
}
/** Never serialize caller-supplied objects: only this form's non-secret fields. */
function sanitized(operation: ImageOperation): ImageOperation {
  const {
    slug,
    ram_mb,
    idle_timeout_s,
    cpu_millicores,
    head_wakes,
    crawler_policy,
    visibility,
    execution_mode,
    restart_policy,
    startup_deadline_s,
    max_retries,
  } = operation.createRequest;
  const overrides = operation.deployRequest.overrides;
  const deployRequest = imageRequest(
    operation.deployRequest.image ?? '',
    operation.workloadKind === 'worker' ? '' : overrides?.port ? String(overrides.port) : '',
    operation.workloadKind === 'worker' ? '' : (overrides?.healthcheck?.path ?? ''),
    operation.deployRequest.full_rootfs_allow_auto === true
  );
  return {
    version: 1,
    ...(operation.workloadKind === 'worker' ? { workloadKind: 'worker' as const } : {}),
    accountId: operation.accountId,
    existingSlug: operation.existingSlug,
    createKey: operation.createKey,
    deployKey: operation.deployKey,
    createdAt: operation.createdAt,
    attemptAt: operation.attemptAt,
    createRequest: {
      slug,
      type: 'app',
      cpu_millicores,
      head_wakes,
      crawler_policy,
      visibility: visibility ?? 'public',
      ...(ram_mb ? { ram_mb } : {}),
      ...(idle_timeout_s !== undefined ? { idle_timeout_s } : {}),
      ...(operation.workloadKind === 'worker'
        ? { execution_mode, restart_policy, startup_deadline_s, max_retries }
        : {}),
    },
    deployRequest,
    stage: operation.stage,
    appId: operation.appId,
    endpoint: visibility === 'internal' ? undefined : operation.endpoint,
    deploymentId: operation.deploymentId,
    needsCredentials: operation.needsCredentials,
  };
}
export function saveImageOperation(operation: ImageOperation) {
  localStorage.setItem(
    operationKey(operation.accountId, operation.existingSlug, operation.workloadKind),
    JSON.stringify(sanitized(operation))
  );
}
export function readImageOperation(
  accountId: string,
  existingSlug: string,
  workloadKind: ImageWorkloadKind = 'http'
): ImageOperation | null {
  const raw = localStorage.getItem(operationKey(accountId, existingSlug, workloadKind));
  if (!raw) return null;
  try {
    const operation = JSON.parse(raw) as ImageOperation;
    if (
      operation.version !== 1 ||
      (operation.workloadKind ?? 'http') !== workloadKind ||
      operation.accountId !== accountId ||
      operation.existingSlug !== existingSlug ||
      !operation.createKey ||
      !operation.deployKey ||
      !Number.isFinite(operation.createdAt) ||
      !Number.isFinite(operation.attemptAt) ||
      ![
        'create-pending',
        'create-rejected',
        'app-created',
        'credentials',
        'deploy-submitting',
        'deploy-unknown',
        'deploy-rejected',
        'accepted',
      ].includes(operation.stage) ||
      !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(operation.createRequest.slug) ||
      (operation.createRequest.visibility !== undefined &&
        !['public', 'internal'].includes(operation.createRequest.visibility)) ||
      (workloadKind === 'worker' &&
        (operation.createRequest.execution_mode !== 'worker' ||
          operation.createRequest.visibility !== 'internal' ||
          !['always', 'on-failure', 'unless-stopped', 'no'].includes(
            operation.createRequest.restart_policy ?? ''
          ) ||
          !Number.isInteger(operation.createRequest.startup_deadline_s) ||
          !Number.isInteger(operation.createRequest.max_retries)))
    )
      throw new Error();
    if (!['create-pending', 'create-rejected'].includes(operation.stage) && !operation.appId)
      throw new Error();
    if (operation.stage === 'accepted' && !operation.deploymentId) throw new Error();
    return sanitized(operation);
  } catch {
    throw new Error(
      'The saved image recovery record cannot be read. Inspect your apps and releases before starting another attempt.'
    );
  }
}
export function creationReplayAllowed(operation: ImageOperation, now = Date.now()): boolean {
  return now >= operation.createdAt && now - operation.createdAt < 24 * 60 * 60 * 1000;
}
export function clearImageOperation(operation: ImageOperation) {
  localStorage.removeItem(
    operationKey(operation.accountId, operation.existingSlug, operation.workloadKind)
  );
}
