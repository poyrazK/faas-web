import { expect, it } from 'vitest';
import { stageQueuePayload, stageQueueFingerprint } from './stage-queue';

const binding = {
  name: 'orders',
  queue_name: 'orders',
  mode: 'pull' as const,
  workload_class: 'worker' as const,
  enabled: true,
  max_concurrency: 2,
  retry_policy: { max_attempts: 3 },
};

it('preserves all desired definitions and the complete workload revision', () => {
  const snapshot = {
    kind: 'ready' as const,
    data: {
      environment: 'staging',
      workload: 'worker-1',
      workload_revision: 7,
      revision: 4,
      config_hash: 'a'.repeat(64),
      activation_state: 'unavailable' as const,
      bindings: [binding],
    },
  };
  expect(stageQueuePayload(snapshot, [binding])).toEqual({
    expected_revision: 7,
    bindings: [binding],
  });
  expect(stageQueueFingerprint(snapshot)).toContain('7');
  expect(stageQueueFingerprint({ kind: 'uninitialized', workloadRevision: 0 })).not.toBe(
    stageQueueFingerprint(snapshot)
  );
  expect(stageQueuePayload(snapshot, []).bindings).toEqual([]);
});

it('rejects duplicate names or queues, invalid classes and unsupported HTTP pull before review', () => {
  const snapshot = { kind: 'uninitialized' as const, workloadRevision: 0 };
  expect(() => stageQueuePayload(snapshot, [binding, { ...binding, name: 'other' }])).toThrow(
    /queue/i
  );
  expect(() =>
    stageQueuePayload(snapshot, [{ ...binding, mode: 'pull', workload_class: 'http' }])
  ).toThrow(/HTTP/i);
  expect(() => stageQueuePayload(snapshot, [{ ...binding, max_concurrency: 0 }])).toThrow(
    /concurrency/i
  );
});
