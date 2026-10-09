import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { createImageApp, deployImage } from './image-deployments';
afterEach(() => vi.restoreAllMocks());
it('replays the exact app creation with its explicit original key', async () => {
  const post = vi
    .spyOn(api, 'POST')
    .mockResolvedValue({ data: { id: 'app' }, response: new Response() } as never);
  const body = { slug: 'api', type: 'app' as const };
  await createImageApp(body, 'create-key');
  await createImageApp(body, 'create-key');
  expect(post).toHaveBeenNthCalledWith(1, '/v1/apps', {
    body: { cpu_millicores: 1000, head_wakes: false, crawler_policy: 'wake', ...body },
    headers: { 'Idempotency-Key': 'create-key' },
  });
  expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
});
it('never automatically repeats an ambiguous image POST', async () => {
  const post = vi.spyOn(api, 'POST').mockRejectedValue(new TypeError('Connection lost'));
  await expect(
    deployImage('api', { image: `r/x@sha256:${'a'.repeat(64)}` }, 'deploy-key')
  ).rejects.toThrow('Connection lost');
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0]?.[1]).toMatchObject({ headers: { 'Idempotency-Key': 'deploy-key' } });
});
