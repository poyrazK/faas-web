import type { components } from './api/schema';
import { imageRequest } from './oci-image';
type CreateRequest = components['schemas']['CreateAppRequest'];
export type ImageCreateRequest = Pick<CreateRequest, 'slug' | 'type' | 'ram_mb' | 'idle_timeout_s'>;
export interface ImageOperation {
  version: 1;
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
    | 'app-created'
    | 'credentials'
    | 'deploy-submitting'
    | 'deploy-unknown'
    | 'accepted';
  appId?: string;
  endpoint?: string;
  deploymentId?: string;
  needsCredentials?: boolean;
}
const operationKey = (accountId: string, slug: string) =>
  `gregale.image-operation:${accountId}:${slug || 'new'}`;
export function newImageOperation(
  accountId: string,
  createRequest: ImageCreateRequest,
  deployRequest: ImageOperation['deployRequest'],
  existingSlug = ''
): ImageOperation {
  return {
    version: 1,
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
      ...createRequest,
    },
    deployRequest,
    stage: 'create-pending',
  };
}
/** Never serialize caller-supplied objects: only this form's non-secret fields. */
function sanitized(operation: ImageOperation): ImageOperation {
  const { slug, ram_mb, idle_timeout_s, cpu_millicores, head_wakes, crawler_policy } =
    operation.createRequest;
  const overrides = operation.deployRequest.overrides;
  const deployRequest = imageRequest(
    operation.deployRequest.image ?? '',
    overrides?.port ? String(overrides.port) : '',
    overrides?.healthcheck?.path ?? '',
    operation.deployRequest.full_rootfs_allow_auto === true
  );
  return {
    version: 1,
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
      ...(ram_mb ? { ram_mb } : {}),
      ...(idle_timeout_s !== undefined ? { idle_timeout_s } : {}),
    },
    deployRequest,
    stage: operation.stage,
    appId: operation.appId,
    endpoint: operation.endpoint,
    deploymentId: operation.deploymentId,
    needsCredentials: operation.needsCredentials,
  };
}
export function saveImageOperation(operation: ImageOperation) {
  localStorage.setItem(
    operationKey(operation.accountId, operation.existingSlug),
    JSON.stringify(sanitized(operation))
  );
}
export function readImageOperation(accountId: string, existingSlug: string): ImageOperation | null {
  const raw = localStorage.getItem(operationKey(accountId, existingSlug));
  if (!raw) return null;
  try {
    const operation = JSON.parse(raw) as ImageOperation;
    if (
      operation.version !== 1 ||
      operation.accountId !== accountId ||
      operation.existingSlug !== existingSlug ||
      !operation.createKey ||
      !operation.deployKey ||
      !Number.isFinite(operation.createdAt) ||
      !Number.isFinite(operation.attemptAt) ||
      ![
        'create-pending',
        'app-created',
        'credentials',
        'deploy-submitting',
        'deploy-unknown',
        'accepted',
      ].includes(operation.stage) ||
      !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(operation.createRequest.slug)
    )
      throw new Error();
    if (operation.stage !== 'create-pending' && !operation.appId) throw new Error();
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
  localStorage.removeItem(operationKey(operation.accountId, operation.existingSlug));
}
