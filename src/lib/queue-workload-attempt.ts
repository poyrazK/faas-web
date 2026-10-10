import type { QueueWorkloadProfile } from './api/queue-bindings';

export interface QueueWorkloadAttempt {
  version: 1;
  accountId: string;
  slug: string;
  appId: string;
  beforeFingerprint: string;
  request: QueueWorkloadProfile;
  createdAt: number;
}

const key = (accountId: string, slug: string) =>
  `gregale.queue-workload-profile:${accountId}:${slug}`;

function safeRequest(request: QueueWorkloadProfile): QueueWorkloadProfile {
  return {
    queue_name: request.queue_name,
    workload_class: request.workload_class,
    max_concurrency: request.max_concurrency,
    target_depth: request.target_depth,
    force: request.force,
  };
}

export function saveQueueWorkloadAttempt(attempt: QueueWorkloadAttempt) {
  sessionStorage.setItem(
    key(attempt.accountId, attempt.slug),
    JSON.stringify({
      version: 1,
      accountId: attempt.accountId,
      slug: attempt.slug,
      appId: attempt.appId,
      beforeFingerprint: attempt.beforeFingerprint,
      request: safeRequest(attempt.request),
      createdAt: attempt.createdAt,
    })
  );
}

export function readQueueWorkloadAttempt(
  accountId: string,
  slug: string
): QueueWorkloadAttempt | null {
  const raw = sessionStorage.getItem(key(accountId, slug));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as QueueWorkloadAttempt;
    const request = value.request;
    if (
      value.version !== 1 ||
      value.accountId !== accountId ||
      value.slug !== slug ||
      typeof value.appId !== 'string' ||
      typeof value.beforeFingerprint !== 'string' ||
      !Number.isFinite(value.createdAt) ||
      !request ||
      typeof request.queue_name !== 'string' ||
      !['worker', 'job'].includes(request.workload_class ?? '') ||
      !Number.isFinite(request.max_concurrency) ||
      !Number.isFinite(request.target_depth) ||
      typeof request.force !== 'boolean'
    )
      return null;
    return {
      version: 1,
      accountId,
      slug,
      appId: value.appId,
      beforeFingerprint: value.beforeFingerprint,
      request: safeRequest(request),
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}

export function clearQueueWorkloadAttempt(accountId: string, slug: string) {
  sessionStorage.removeItem(key(accountId, slug));
}
