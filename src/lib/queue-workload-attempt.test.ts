import { expect, it } from 'vitest';
import { readQueueWorkloadAttempt, saveQueueWorkloadAttempt } from './queue-workload-attempt';

it('persists only nonsecret profile fields under account and app identity', () => {
  sessionStorage.clear();
  saveQueueWorkloadAttempt({
    version: 1,
    accountId: 'account-1',
    slug: 'worker-1',
    appId: 'app-1',
    beforeFingerprint: 'before',
    request: {
      queue_name: 'orders',
      workload_class: 'worker',
      max_concurrency: 1,
      target_depth: 10,
      force: false,
      secret: 'hidden',
    } as never,
    createdAt: 1,
  });
  expect(JSON.stringify(readQueueWorkloadAttempt('account-1', 'worker-1'))).not.toContain('hidden');
  expect(readQueueWorkloadAttempt('account-2', 'worker-1')).toBeNull();
});
