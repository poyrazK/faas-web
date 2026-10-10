import { beforeEach, expect, it } from 'vitest';
import {
  clearQueueBindingOperation,
  newQueueBindingOperation,
  readQueueBindingOperation,
  saveQueueBindingOperation,
} from './queue-binding-operation';

beforeEach(() => sessionStorage.clear());

it('persists only frozen non-secret production creation intent per account and app', () => {
  const operation = newQueueBindingOperation('account-1', 'worker-1', 'app-id', {
    name: 'orders',
    queue_name: 'orders',
    mode: 'pull',
    workload_class: 'worker',
    enabled: true,
    max_concurrency: 2,
    environment: 'stage',
    secret: 'must-not-persist',
  } as never);
  saveQueueBindingOperation(operation);
  expect(readQueueBindingOperation('account-1', 'worker-1')).toMatchObject({
    appId: 'app-id',
    request: { name: 'orders', queue_name: 'orders', mode: 'pull' },
  });
  expect(readQueueBindingOperation('account-2', 'worker-1')).toBeNull();
  expect(readQueueBindingOperation('account-1', 'worker-2')).toBeNull();
  expect(JSON.stringify(sessionStorage)).not.toMatch(/secret|must-not-persist|environment|stage/);
  clearQueueBindingOperation('account-1', 'worker-1');
  expect(readQueueBindingOperation('account-1', 'worker-1')).toBeNull();
});
