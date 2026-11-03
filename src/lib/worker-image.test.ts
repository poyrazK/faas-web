import { expect, it } from 'vitest';
import { workerCreateRequest } from './worker-image';

it('creates an internal worker without HTTP lifecycle fields', () => {
  expect(
    workerCreateRequest({
      slug: 'batch-worker',
      memory: 256,
      maxMemory: 512,
      plan: 'hobby',
      restartPolicy: 'always',
      startupDeadline: 30,
      maxRetries: 5,
    })
  ).toMatchObject({
    slug: 'batch-worker',
    type: 'app',
    visibility: 'internal',
    execution_mode: 'worker',
    restart_policy: 'always',
    startup_deadline_s: 30,
    max_retries: 5,
  });
});

it('rejects Free and lifecycle values beyond the plan limit', () => {
  const settings = {
    slug: 'batch-worker',
    memory: 256,
    maxMemory: 512,
    restartPolicy: 'always' as const,
    startupDeadline: 30,
    maxRetries: 5,
  };
  expect(() => workerCreateRequest({ ...settings, plan: 'free' })).toThrow(/Hobby/i);
  expect(() => workerCreateRequest({ ...settings, plan: 'hobby', startupDeadline: 31 })).toThrow(
    /30/
  );
  expect(() => workerCreateRequest({ ...settings, plan: 'hobby', maxRetries: 6 })).toThrow(/5/);
});

it.each(['pro', 'scale'] as const)('enforces the backend cold-boot startup cap on %s', (plan) => {
  expect(() =>
    workerCreateRequest({
      slug: 'worker',
      memory: 128,
      maxMemory: 512,
      plan,
      restartPolicy: 'always',
      startupDeadline: 31,
      maxRetries: 0,
    })
  ).toThrow('Startup deadline must be 0 to 30 seconds for this plan.');
});
