import { expect, it } from 'vitest';
import { getStageQueueRecord, putStageQueueRecord } from './stage-queues';

it('isolates stage desired settings, preserves complete replacement and rejects stale workload revisions', () => {
  const key = { project: 'shop', environment: 'staging', workload: 'worker-1' };
  expect(getStageQueueRecord(key)).toBeNull();
  const binding = {
    name: 'orders',
    queue_name: 'orders',
    mode: 'pull' as const,
    workload_class: 'worker' as const,
    enabled: true,
    max_concurrency: 2,
  };
  const first = putStageQueueRecord(key, { expected_revision: 0, bindings: [binding] });
  expect(first).toMatchObject({
    activation_state: 'unavailable',
    workload_revision: 1,
    revision: 1,
    bindings: [binding],
  });
  expect(getStageQueueRecord({ ...key, environment: 'other' })).toBeNull();
  expect(() => putStageQueueRecord(key, { expected_revision: 0, bindings: [] })).toThrow(
    /revision/i
  );
  const empty = putStageQueueRecord(key, { expected_revision: 1, bindings: [] });
  expect(empty.bindings).toEqual([]);
  expect(empty.workload_revision).toBe(2);
});
