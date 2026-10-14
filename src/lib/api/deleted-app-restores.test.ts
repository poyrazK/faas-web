import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { inspectRestore } from './deleted-app-restores';

const attempt = {
  accountId: 'account-a',
  appId: '00000000-0000-4000-8000-000000000001',
  slug: 'retained-app',
  expectedDeletedAt: '2026-10-12T12:00:00Z',
  expectedDeadline: '2026-10-19T12:00:00Z',
  attemptId: '00000000-0000-4000-8000-000000000099',
  startedAt: '2026-10-12T13:00:00Z',
  phase: 'uncertain' as const,
};
const missing = {
  error: { code: 'not_found', status: 404, title: 'Not found' },
  response: new Response(null, { status: 404 }),
};
afterEach(() => vi.restoreAllMocks());

it('proves restoration only from matching current app metadata and absent retained identity', async () => {
  vi.spyOn(api, 'GET').mockImplementation(async (path) =>
    path === '/v1/deleted-apps/{id}'
      ? missing
      : ({
          data:
            path === '/v1/account'
              ? { id: 'account-a' }
              : {
                  id: attempt.appId,
                  slug: attempt.slug,
                  status: 'undeployed',
                  signing_secret: 'must-not-retain',
                },
          response: new Response(),
        } as never)
  );
  const post = vi.spyOn(api, 'POST');
  expect(await inspectRestore(attempt)).toEqual({ kind: 'restored', status: 'undeployed' });
  expect(post).not.toHaveBeenCalled();
});

it('does not claim restoration for a replacement slug or conflicting reads', async () => {
  const get = vi.spyOn(api, 'GET').mockImplementation(async (path) =>
    path === '/v1/deleted-apps/{id}'
      ? missing
      : ({
          data:
            path === '/v1/account'
              ? { id: 'account-a' }
              : { id: 'replacement', slug: attempt.slug, status: 'active' },
          response: new Response(),
        } as never)
  );
  expect((await inspectRestore(attempt)).kind).toBe('unverified');
  get.mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/account'
            ? { id: 'account-a' }
            : path === '/v1/deleted-apps/{id}'
              ? {
                  account_id: 'account-a',
                  id: attempt.appId,
                  slug: attempt.slug,
                  deleted_at: attempt.expectedDeletedAt,
                  delete_grace_until: attempt.expectedDeadline,
                  restore_eligible: true,
                  restore_blocker: '',
                  evaluated_at: '2026-10-12T13:00:00Z',
                }
              : { id: attempt.appId, slug: attempt.slug, status: 'active' },
        response: new Response(),
      }) as never
  );
  expect((await inspectRestore(attempt)).kind).toBe('unverified');
});
