import type { CreateQueueBinding } from './api/queue-bindings';

export interface QueueBindingOperation {
  version: 1;
  accountId: string;
  slug: string;
  appId: string;
  idempotencyKey: string;
  createdAt: number;
  request: CreateQueueBinding;
}

const key = (accountId: string, slug: string) =>
  `gregale.queue-binding-create:${accountId}:${slug}`;

function safeRequest(input: CreateQueueBinding): CreateQueueBinding {
  const retry = input.retry_policy;
  return {
    name: input.name,
    queue_name: input.queue_name,
    mode: input.mode,
    workload_class: input.workload_class,
    enabled: input.enabled,
    max_concurrency: input.max_concurrency,
    ...(retry
      ? {
          retry_policy: {
            ...(retry.max_attempts !== undefined ? { max_attempts: retry.max_attempts } : {}),
            ...(retry.base_seconds !== undefined ? { base_seconds: retry.base_seconds } : {}),
            ...(retry.max_seconds !== undefined ? { max_seconds: retry.max_seconds } : {}),
            ...(retry.jitter_seconds !== undefined ? { jitter_seconds: retry.jitter_seconds } : {}),
          },
        }
      : {}),
  };
}

export function newQueueBindingOperation(
  accountId: string,
  slug: string,
  appId: string,
  request: CreateQueueBinding
): QueueBindingOperation {
  return {
    version: 1,
    accountId,
    slug,
    appId,
    idempotencyKey: crypto.randomUUID(),
    createdAt: Date.now(),
    request: safeRequest(request),
  };
}

export function saveQueueBindingOperation(operation: QueueBindingOperation) {
  sessionStorage.setItem(
    key(operation.accountId, operation.slug),
    JSON.stringify({
      version: 1,
      accountId: operation.accountId,
      slug: operation.slug,
      appId: operation.appId,
      idempotencyKey: operation.idempotencyKey,
      createdAt: operation.createdAt,
      request: safeRequest(operation.request),
    })
  );
}

export function readQueueBindingOperation(
  accountId: string,
  slug: string
): QueueBindingOperation | null {
  const raw = sessionStorage.getItem(key(accountId, slug));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as QueueBindingOperation;
    const request = value.request;
    if (
      value.version !== 1 ||
      value.accountId !== accountId ||
      value.slug !== slug ||
      !value.appId ||
      !value.idempotencyKey ||
      !Number.isFinite(value.createdAt) ||
      !request ||
      typeof request.name !== 'string' ||
      typeof request.queue_name !== 'string' ||
      !['pull', 'push'].includes(request.mode) ||
      !['worker', 'job', 'http'].includes(request.workload_class) ||
      typeof request.enabled !== 'boolean' ||
      !Number.isInteger(request.max_concurrency)
    )
      return null;
    return {
      version: 1,
      accountId,
      slug,
      appId: value.appId,
      idempotencyKey: value.idempotencyKey,
      createdAt: value.createdAt,
      request: safeRequest(request),
    };
  } catch {
    return null;
  }
}

export function clearQueueBindingOperation(accountId: string, slug: string) {
  sessionStorage.removeItem(key(accountId, slug));
}
