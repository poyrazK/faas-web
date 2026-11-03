import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { StalePromotionPreview, usePromoteEnvironment } from './environments';

afterEach(() => vi.restoreAllMocks());
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const hash = 'c'.repeat(64);
const scope = { accountId: 'a', slug: 'shop', org: null };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => usePromoteEnvironment(scope, 'production'), { wrapper });
  return { client, hook };
}
const preview = (overrides: Record<string, unknown> = {}) =>
  ok({
    project_slug: 'shop',
    from_environment: 'staging',
    to_environment: 'production',
    promotion_hash: hash,
    promotion_token: 'fresh-token',
    approval_required: true,
    ...overrides,
  });

it('reads the token fresh, approves that token, then promotes with one key', async () => {
  spyApi('GET').mockResolvedValue(preview());
  const post = spyApi('POST').mockImplementation(async (path) =>
    path.endsWith('/approvals')
      ? ok({ approval_token: 'once' })
      : ok({ promotion_id: 'op', status: 'succeeded' })
  );
  const { client, hook } = setup();
  await act(() =>
    hook.result.current.mutateAsync({ source: 'staging', promotionHash: hash, key: 'k1' })
  );
  expect(post).toHaveBeenNthCalledWith(
    1,
    '/v1/projects/{slug}/environments/{environment}/approvals',
    expect.objectContaining({ body: { promotion_token: 'fresh-token' } })
  );
  expect(post).toHaveBeenNthCalledWith(
    2,
    '/v1/projects/{slug}/environments/{environment}/promote',
    expect.objectContaining({
      params: {
        path: { slug: 'shop', environment: 'production' },
        header: { 'Idempotency-Key': 'k1' },
      },
      body: { from_environment: 'staging', promotion_token: 'fresh-token', approval_token: 'once' },
    })
  );
  // Neither credential is left in a cache once the promotion settles.
  const cached = JSON.stringify([
    ...client
      .getQueryCache()
      .getAll()
      .map((q) => q.state.data),
    ...client
      .getMutationCache()
      .getAll()
      .map((m) => m.state),
  ]);
  expect(cached).not.toMatch(/fresh-token|"once"/);
});

it('skips the approval for an unprotected target', async () => {
  spyApi('GET').mockResolvedValue(preview({ approval_required: false }));
  const post = spyApi('POST').mockResolvedValue(ok({ promotion_id: 'op', status: 'running' }));
  const { hook } = setup();
  await act(() =>
    hook.result.current.mutateAsync({ source: 'staging', promotionHash: hash, key: 'k1' })
  );
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][0]).toBe('/v1/projects/{slug}/environments/{environment}/promote');
});

it('sends nothing when the preview moved since it was reviewed', async () => {
  spyApi('GET').mockResolvedValue(preview({ promotion_hash: 'd'.repeat(64) }));
  const post = spyApi('POST');
  const { hook } = setup();
  await expect(
    act(() => hook.result.current.mutateAsync({ source: 'staging', promotionHash: hash, key: 'k' }))
  ).rejects.toBeInstanceOf(StalePromotionPreview);
  expect(post).not.toHaveBeenCalled();
});
