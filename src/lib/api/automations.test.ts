import { beforeEach, expect, it, vi } from 'vitest';
import { startAutomationRun, writeAutomation } from './automations';
import { newDefinition } from '@/components/dashboard/automation-definition';
const calls = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock('./client', () => ({
  api: { POST: calls.post, PUT: calls.put },
  unwrap: async (value: unknown) => value,
}));
beforeEach(() => vi.clearAllMocks());
it('sends exact saved and publication versions on separate endpoints', async () => {
  const definition = { ...newDefinition(), name: 'orders' };
  await writeAutomation('alpha', {
    kind: 'save',
    name: 'orders',
    body: { expected_version: 42, definition },
  });
  expect(calls.put).toHaveBeenCalledWith('/v1/apps/{slug}/automations/{name}', {
    params: { path: { slug: 'alpha', name: 'orders' } },
    body: { expected_version: 42, definition },
  });
  await writeAutomation('alpha', {
    kind: 'publish',
    name: 'orders',
    body: { expected_version: 47, take_over_manifest: true },
  });
  expect(calls.post).toHaveBeenCalledWith('/v1/apps/{slug}/automations/{name}/publish', {
    params: { path: { slug: 'alpha', name: 'orders' } },
    body: { expected_version: 47, take_over_manifest: true },
  });
});
it('reuses the caller idempotency key when starting the same run after a lost response', async () => {
  for (let attempt = 0; attempt < 2; attempt++)
    await startAutomationRun('alpha', 'orders', { id: 1 }, 'same-key');
  expect(calls.post).toHaveBeenNthCalledWith(1, '/v1/apps/{slug}/workflows/{name}/runs', {
    params: { path: { slug: 'alpha', name: 'orders' }, header: { 'Idempotency-Key': 'same-key' } },
    body: { id: 1 },
  });
  expect(calls.post.mock.calls[1]).toEqual(calls.post.mock.calls[0]);
});
