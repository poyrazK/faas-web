import { beforeEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { readWorkerCreateContext } from './worker-create';

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
beforeEach(() => vi.restoreAllMocks());

it('requires fresh same-account worker, image and private-app availability', async () => {
  const get = vi.spyOn(api, 'GET').mockImplementation(async (path) =>
    path === '/v1/account'
      ? ok({ id: 'account-1', plan: 'hobby' })
      : ok({
          plan: 'hobby',
          capabilities: ['worker-pools', 'container-deployments', 'private-apps'].map((key) => ({
            key,
            enabled: true,
            plans: ['hobby'],
          })),
        })
  );
  const controller = new AbortController();
  await readWorkerCreateContext('account-1', 'hobby', controller.signal);
  expect(get).toHaveBeenCalledWith('/v1/account', { signal: controller.signal });
  await expect(readWorkerCreateContext('other-account', 'hobby')).rejects.toThrow(
    /no longer available/i
  );
});

it('rejects missing image availability before a worker write', async () => {
  vi.spyOn(api, 'GET').mockImplementation(async (path) =>
    path === '/v1/account'
      ? ok({ id: 'account-1', plan: 'hobby' })
      : ok({
          plan: 'hobby',
          capabilities: ['worker-pools', 'private-apps'].map((key) => ({
            key,
            enabled: true,
            plans: ['hobby'],
          })),
        })
  );
  await expect(readWorkerCreateContext('account-1', 'hobby')).rejects.toThrow(
    /no longer available/i
  );
});
