import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { ApiError } from './errors';
import {
  asyncInvokeExtras,
  parseWorkKey,
  replayErrorDescription,
  replayPath,
  useAppWorkPolicies,
  useReplayKeyedInvocation,
} from './async-invocations';

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('replayPath', () => {
  it('sends failed or dead-lettered unkeyed work through plain replay', () => {
    expect(replayPath({ state: 'failed' })).toEqual({ kind: 'plain' });
    expect(replayPath({ state: 'dead_letter' })).toEqual({ kind: 'plain' });
  });

  it('sends failed keyed work through keyed replay, in its policy lane', () => {
    expect(replayPath({ state: 'failed', work_policy_name: 'document-index' })).toEqual({
      kind: 'keyed',
      policy: 'document-index',
    });
  });

  it('refuses dead-lettered keyed work and points at the dead-letter queue', () => {
    const path = replayPath({ state: 'dead_letter', work_policy_name: 'document-index' });
    expect(path.kind).toBe('none');
    expect(path.kind === 'none' && path.reason).toMatch(/dead-letter queue/);
  });

  it('refuses named-queue work, which keeps its binding only through the queue', () => {
    const path = replayPath({ state: 'failed', queue_name: 'emails' });
    expect(path.kind).toBe('none');
    expect(path.kind === 'none' && path.reason).toMatch(/queue/);
  });

  it('refuses work that did not fail', () => {
    for (const state of ['completed', 'pending', 'dispatching', 'cancelled'] as const) {
      expect(replayPath({ state }).kind).toBe('none');
      expect(replayPath({ state, work_policy_name: 'p' }).kind).toBe('none');
    }
  });
});

describe('parseWorkKey', () => {
  it('reads JSON scalars with their type, since "1" and 1 are different lanes', () => {
    expect(parseWorkKey('"d1"', 'Work key')).toBe('d1');
    expect(parseWorkKey('42', 'Work key')).toBe(42);
    expect(parseWorkKey('true', 'Work key')).toBe(true);
  });

  it('sends text that is not JSON as a string', () => {
    expect(parseWorkKey('doc-7', 'Work key')).toBe('doc-7');
  });

  it('rejects empty, null, objects and arrays', () => {
    for (const text of ['', '  ', '""', 'null', '{}', '[1]']) {
      expect(() => parseWorkKey(text, 'Work key')).toThrow(/Work key/);
    }
  });
});

describe('asyncInvokeExtras', () => {
  const empty = {
    policy: '',
    key: '',
    fairnessKey: '',
    deadline: '',
    onSuccess: '',
    onFailure: '',
  };

  it('adds nothing when no option is set', () => {
    expect(asyncInvokeExtras(empty)).toEqual({});
  });

  it('builds work, deadline_at and destinations', () => {
    const deadline = new Date(Date.now() + 3_600_000);
    const local = new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    const body = asyncInvokeExtras({
      policy: 'document-index',
      key: '"d1"',
      fairnessKey: 'tenant-42',
      deadline: local,
      onSuccess: 'hook-ok',
      onFailure: 'hook-fail',
    });
    expect(body.work).toEqual({ policy: 'document-index', key: 'd1', fairness_key: 'tenant-42' });
    expect(body.destinations).toEqual({ on_success: 'hook-ok', on_failure: 'hook-fail' });
    expect(Math.abs(Date.parse(body.deadline_at!) - deadline.getTime())).toBeLessThan(60_000);
  });

  it('requires a key once a policy is chosen', () => {
    expect(() => asyncInvokeExtras({ ...empty, policy: 'document-index' })).toThrow(/Work key/);
  });

  it('refuses a deadline in the past', () => {
    expect(() => asyncInvokeExtras({ ...empty, deadline: '2001-01-01T00:00' })).toThrow(/future/);
  });

  it('sends only the destination that was chosen', () => {
    expect(asyncInvokeExtras({ ...empty, onFailure: 'hook-fail' })).toEqual({
      destinations: { on_failure: 'hook-fail' },
    });
  });
});

describe('replayErrorDescription', () => {
  const err = (code: string) =>
    new ApiError({ status: 409, code, title: code, detail: `server detail for ${code}` });

  it('explains an expired keyed lane', () => {
    expect(replayErrorDescription(err('keyed_replay_expired'))).toMatch(/pending lifetime/);
  });

  it('explains a replay that is no longer retained', () => {
    expect(replayErrorDescription(err('keyed_replay_unavailable'))).toMatch(/no longer retained/);
    expect(replayErrorDescription(err('invocation_replay_unavailable'))).toMatch(
      /no longer retained/
    );
  });

  it('explains a full event delivery budget', () => {
    expect(replayErrorDescription(err('event_delivery_capacity_exhausted'))).toMatch(/drain/);
  });

  it('adds nothing for other codes, so the toast shows the server prose and its help', () => {
    expect(replayErrorDescription(err('invocation_not_replayable'))).toBeUndefined();
    expect(replayErrorDescription(new Error('offline'))).toBeUndefined();
  });
});

describe('useReplayKeyedInvocation', () => {
  it('posts to replay-keyed and refreshes the invocation list', async () => {
    const post = spyApi('POST').mockImplementation(() =>
      ok({ id: 'child', status_url: '/v1/invocations/child' })
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useReplayKeyedInvocation(), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current.mutateAsync('parent');
    });
    expect(post).toHaveBeenCalledWith('/v1/invocations/{id}/replay-keyed', {
      params: { path: { id: 'parent' } },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invocations'] });
  });
});

describe('useAppWorkPolicies', () => {
  it("reads the app's named work policies", async () => {
    const get = spyApi('GET').mockImplementation(() =>
      ok({ policies: [{ name: 'document-index', revision: 3 }] })
    );
    const { result } = renderHook(() => useAppWorkPolicies('docs'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(get).toHaveBeenCalledWith(
      '/v1/apps/{slug}/work-policies',
      expect.objectContaining({ params: { path: { slug: 'docs' } } })
    );
  });

  it('does not read without an app', () => {
    const get = spyApi('GET');
    renderHook(() => useAppWorkPolicies(''), { wrapper: wrapper() });
    expect(get).not.toHaveBeenCalled();
  });
});
