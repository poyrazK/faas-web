import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { status } from '@/test/runtime-policy';
import { usePolicyOperation } from './policy-operation';
afterEach(() => vi.restoreAllMocks());
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
it('retains an accepted save after an optional baseline read fails, without inventing revision evidence', async () => {
  vi.spyOn(api, 'GET').mockRejectedValue(new Error('Offline'));
  const write = vi.fn().mockResolvedValue('accepted');
  const hook = renderHook(() => usePolicyOperation('account', 'api', 'app-1', 'configuration'));
  await act(async () => {
    expect(await hook.result.current.run(['request_policy'], write)).toBe('accepted');
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(hook.result.current.receipt?.baseline).toBeUndefined();
  expect(hook.result.current.receipt?.appId).toBe('app-1');
});
it('never starts a write for an old account when its pre-save read resolves after a switch', async () => {
  let finish!: (value: never) => void;
  vi.spyOn(api, 'GET').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const write = vi.fn();
  const hook = renderHook(
    ({ account }) => usePolicyOperation(account, 'api', 'app-1', 'configuration'),
    { initialProps: { account: 'old' } }
  );
  let operation!: Promise<unknown>;
  act(() => {
    operation = hook.result.current.run(['request_policy'], write);
  });
  hook.rerender({ account: 'new' });
  await act(async () => {
    finish(ok(status));
    await operation;
  });
  expect(write).not.toHaveBeenCalled();
  expect(hook.result.current.receipt).toBeUndefined();
});
it('keeps an accepted purge pending until a post-request read advances beyond its baseline', async () => {
  vi.spyOn(api, 'GET').mockResolvedValue(ok(status));
  const hook = renderHook(() => usePolicyOperation('account', 'api', 'app-1', 'purge'));
  await act(async () => {
    await hook.result.current.run(['response_cache'], vi.fn().mockResolvedValue(undefined));
  });
  expect(hook.result.current.receipt).toMatchObject({
    action: 'purge',
    baseline: { response_cache: 5 },
  });
});
it('refuses to write when the read positively identifies a different app under the slug', async () => {
  vi.spyOn(api, 'GET').mockResolvedValue(ok({ ...status, app_id: 'replacement-app' }));
  const write = vi.fn();
  const hook = renderHook(() => usePolicyOperation('account', 'api', 'app-1', 'configuration'));
  await act(async () => {
    await expect(hook.result.current.run(['request_policy'], write)).rejects.toThrow(
      /different app/i
    );
  });
  expect(write).not.toHaveBeenCalled();
});
