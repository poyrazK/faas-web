import type { StageQueueBindings, StageQueueSnapshot } from './api/queue-bindings';

export type StageBinding = StageQueueBindings['bindings'][number];
const namePattern = /^[a-z][a-z0-9-]{0,62}$/;

export function stageQueueFingerprint(snapshot: StageQueueSnapshot) {
  return snapshot.kind === 'ready'
    ? JSON.stringify([
        snapshot.data.environment,
        snapshot.data.workload,
        snapshot.data.workload_revision,
        snapshot.data.revision,
        snapshot.data.config_hash,
        snapshot.data.bindings,
      ])
    : JSON.stringify(['uninitialized', snapshot.workloadRevision]);
}

export function stageQueuePayload(snapshot: StageQueueSnapshot, bindings: StageBinding[]) {
  const names = new Set<string>();
  const queues = new Set<string>();
  for (const binding of bindings) {
    if (!namePattern.test(binding.name) || !namePattern.test(binding.queue_name))
      throw new Error(
        'Binding and queue names must start with a letter and use lowercase letters, digits or dashes.'
      );
    if (names.has(binding.name) || queues.has(binding.queue_name))
      throw new Error('Binding names and queue names must each be unique in this stage workload.');
    names.add(binding.name);
    queues.add(binding.queue_name);
    if (
      !['pull', 'push'].includes(binding.mode) ||
      !['worker', 'job', 'http'].includes(binding.workload_class)
    )
      throw new Error('Select a supported delivery mode and workload class.');
    if (binding.workload_class === 'http' && binding.mode !== 'push')
      throw new Error('HTTP consumers require push delivery.');
    if (
      !Number.isInteger(binding.max_concurrency) ||
      binding.max_concurrency < 1 ||
      binding.max_concurrency > 10_000
    )
      throw new Error('Max concurrency must be 1 to 10,000.');
    const retry = binding.retry_policy;
    if (
      retry &&
      ((retry.max_attempts !== undefined &&
        (!Number.isInteger(retry.max_attempts) ||
          retry.max_attempts < 0 ||
          retry.max_attempts > 25)) ||
        (retry.base_seconds !== undefined &&
          (retry.base_seconds < 0 || retry.base_seconds > 3600)) ||
        (retry.max_seconds !== undefined && (retry.max_seconds < 0 || retry.max_seconds > 86400)) ||
        (retry.jitter_seconds !== undefined &&
          (retry.jitter_seconds < 0 || retry.jitter_seconds > 1)) ||
        (retry.max_seconds !== undefined &&
          retry.base_seconds !== undefined &&
          retry.max_seconds > 0 &&
          retry.base_seconds > retry.max_seconds))
    )
      throw new Error('Retry policy is outside the supported limits.');
  }
  return {
    expected_revision:
      snapshot.kind === 'ready' ? snapshot.data.workload_revision : snapshot.workloadRevision,
    bindings: bindings.map((binding) => ({ ...binding })),
  };
}
