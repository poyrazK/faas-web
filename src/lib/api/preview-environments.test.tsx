import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { usePreviewSet } from './preview-environments';
const state = (phase = 'live', commit = 'old') => ({
  root_slug: 'preview-api',
  repo_full_name: 'acme/shop',
  pr_number: 7,
  commit_sha: commit,
  phase,
  ready: phase === 'live',
  summary: phase,
  live_workloads: phase === 'live' ? 1 : 0,
  total_workloads: 1,
  members: [
    {
      app_id: 'app1',
      slug: 'preview-api',
      workload_name: 'api',
      app_status: 'active',
      preview_state: 'open',
      deployment_id: phase === 'live' ? `dep-${commit}` : '',
      deployment_status: phase === 'live' ? 'live' : 'building',
    },
  ],
});
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
function wrapper() {
  const client = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});
async function tick(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
it.each(['live', 'failed'])(
  'refreshes open %s outcomes to the new head without navigation',
  async (phase) => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    const get = vi
      .spyOn(api, 'GET')
      .mockResolvedValueOnce(ok(state(phase)))
      .mockResolvedValue(ok(state('building', 'new')));
    const hook = renderHook(() => usePreviewSet('a', 'preview-api', 7), { wrapper: wrapper() });
    await tick();
    expect(hook.result.current.data?.commit_sha).toBe('old');
    await tick(30_000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(hook.result.current.data?.commit_sha).toBe('new');
    expect(hook.result.current.data?.ready).toBe(false);
    expect(hook.result.current.data?.members[0].deployment_id).toBe('');
    await tick(10_000);
    expect(get).toHaveBeenCalledTimes(3);
  }
);
it('stops routine closed polling, but manual reads detect reopening and resume', async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const get = vi
    .spyOn(api, 'GET')
    .mockResolvedValueOnce(ok(state('closed')))
    .mockResolvedValue(ok(state('building', 'reopened')));
  const hook = renderHook(
    () => {
      const query = usePreviewSet('a', 'preview-api', 7);
      void query.data;
      return query;
    },
    { wrapper: wrapper() }
  );
  await tick();
  expect(hook.result.current.data?.phase).toBe('closed');
  await tick(120_000);
  expect(get).toHaveBeenCalledTimes(1);
  await act(async () => {
    const result = await hook.result.current.refetch();
    expect(result.data?.commit_sha).toBe('reopened');
  });
  await tick();
  expect(get).toHaveBeenCalledTimes(2);
  expect(hook.result.current.data?.commit_sha).toBe('reopened');
  await tick(10_000);
  expect(get).toHaveBeenCalledTimes(3);
});
it('pauses hidden intervals and refetches on focus', async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const get = vi.spyOn(api, 'GET').mockResolvedValue(ok(state('building')));
  renderHook(() => usePreviewSet('a', 'preview-api', 7), { wrapper: wrapper() });
  await tick();
  await act(async () => focusManager.setFocused(false));
  await tick(50_000);
  expect(get).toHaveBeenCalledTimes(1);
  await act(async () => focusManager.setFocused(true));
  await tick();
  expect(get).toHaveBeenCalledTimes(2);
});
it('detects a reopened closed set on focus and resumes head polling', async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const get = vi
    .spyOn(api, 'GET')
    .mockResolvedValueOnce(ok(state('closed')))
    .mockResolvedValue(ok(state('building', 'reopened')));
  const hook = renderHook(
    () => {
      const query = usePreviewSet('a', 'preview-api', 7);
      void query.data;
      return query;
    },
    { wrapper: wrapper() }
  );
  await tick();
  expect(hook.result.current.data?.phase).toBe('closed');
  await act(async () => focusManager.setFocused(false));
  await tick(60_000);
  expect(get).toHaveBeenCalledTimes(1);
  await act(async () => focusManager.setFocused(true));
  await tick();
  expect(hook.result.current.data?.commit_sha).toBe('reopened');
  await tick(10_000);
  expect(get).toHaveBeenCalledTimes(3);
});
it('honors Retry-After before retrying a rate-limited read', async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const get = vi
    .spyOn(api, 'GET')
    .mockResolvedValueOnce({
      error: { status: 429, code: 'rate_limited', title: 'Wait' },
      response: new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }),
    } as never)
    .mockResolvedValue(ok(state()));
  const hook = renderHook(() => usePreviewSet('a', 'preview-api', 7), { wrapper: wrapper() });
  await tick();
  await tick(30_000);
  expect(get).toHaveBeenCalledTimes(1);
  await tick(30_000);
  expect(get).toHaveBeenCalledTimes(2);
  expect(hook.result.current.data?.ready).toBe(true);
});
it('does not retry an authoritative unrecorded-set 404', async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const get = vi.spyOn(api, 'GET').mockResolvedValue({
    error: { status: 404, code: 'preview_environment_not_found', title: 'No set' },
    response: new Response('{}', { status: 404 }),
  } as never);
  const hook = renderHook(() => usePreviewSet('a', 'preview-api', 7), { wrapper: wrapper() });
  await tick();
  await tick(120_000);
  expect(get).toHaveBeenCalledTimes(1);
  expect(hook.result.current.error).toMatchObject({ status: 404 });
});
it('stops routine polling after every recorded member reports teardown', async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const torn = {
    ...state('failed'),
    members: [{ ...state('failed').members[0], preview_state: 'torn_down' }],
  };
  const get = vi.spyOn(api, 'GET').mockResolvedValue(ok(torn));
  renderHook(() => usePreviewSet('a', 'preview-api', 7), { wrapper: wrapper() });
  await tick();
  await tick(120_000);
  expect(get).toHaveBeenCalledTimes(1);
});
it('cannot accept a delayed response after account/root selection changes', async () => {
  vi.useFakeTimers();
  let finish!: (data: never) => void;
  vi.spyOn(api, 'GET')
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue(
      ok({ ...state('building', 'same-sha'), root_slug: 'other-root', pr_number: 8 })
    );
  const hook = renderHook(({ account, root, pr }) => usePreviewSet(account, root, pr), {
    wrapper: wrapper(),
    initialProps: { account: 'old', root: 'preview-api', pr: 7 },
  });
  await tick();
  hook.rerender({ account: 'new', root: 'other-root', pr: 8 });
  await tick();
  expect(hook.result.current.data?.root_slug).toBe('other-root');
  await act(async () => finish(ok(state('live', 'same-sha'))));
  await tick();
  expect(hook.result.current.data?.pr_number).toBe(8);
});
