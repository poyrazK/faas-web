import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { edgeRuleListFilters } from './queries';

const {
  ruleAction,
  useCreateEdgeRuleList,
  useDeleteEdgeRuleList,
  useEdgeRuleLists,
  useEdgeRuleSetFollower,
  useEdgeRuleSuggestions,
  useEdgeRuleVersion,
  useEdgeRuleVersions,
  useEdgeWAFReview,
  useRollbackEdgeRules,
  useUpdateEdgeRuleList,
  useUpdateWAFExclusions,
} = await import('./edge-rules');

const ok = (data: unknown) => ({ data, response: new Response() }) as never;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('edge rule set versions', () => {
  it('lists versions newest first and fetches one only when asked', async () => {
    const get = spyApi('GET').mockImplementation((path: string) =>
      Promise.resolve(
        ok(path.endsWith('{version}') ? { version: 3, rules: [] } : [{ version: 4, current: true }])
      )
    );
    const { wrapper } = setup();
    const list = renderHook(() => useEdgeRuleVersions('api'), { wrapper });
    await waitFor(() => expect(list.result.current.data).toEqual([{ version: 4, current: true }]));
    const one = renderHook(({ v }) => useEdgeRuleVersion('api', v), {
      wrapper,
      initialProps: { v: null as number | null },
    });
    expect(get).toHaveBeenCalledTimes(1);
    one.rerender({ v: 3 });
    await waitFor(() => expect(one.result.current.data).toEqual({ version: 3, rules: [] }));
    expect(get).toHaveBeenLastCalledWith(
      '/v1/apps/{slug}/edge-rules/versions/{version}',
      expect.objectContaining({ params: { path: { slug: 'api', version: 3 } } })
    );
  });

  it('rolls back behind If-Match on the version it was read at, then rereads', async () => {
    const post = spyApi('POST').mockResolvedValue(ok([]));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRollbackEdgeRules('api'), { wrapper });
    await act(() => result.current.mutateAsync({ version: 2, current: 5 }));
    expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/edge-rules/rollback', {
      params: { path: { slug: 'api' } },
      body: { version: 2 },
      headers: { 'If-Match': '"5"' },
    });
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f));
    expect(keys.some((k) => k.includes('"edge-rules"'))).toBe(true);
  });
});

describe('the follower', () => {
  it('rereads versions, suggestions and the WAF review when the rule set changes', () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const view = renderHook(({ sig }) => useEdgeRuleSetFollower('api', sig), {
      wrapper,
      initialProps: { sig: 'a@1' },
    });
    expect(invalidate).not.toHaveBeenCalled();
    view.rerender({ sig: 'a@2' });
    const [filters] = invalidate.mock.calls[0];
    const matches = (queryKey: unknown[]) => filters?.predicate?.({ queryKey } as never);
    expect(filters?.queryKey).toEqual(['apps', 'api', 'edge-rules']);
    expect(matches(['apps', 'api', 'edge-rules', 'versions'])).toBe(true);
    expect(matches(['apps', 'api', 'edge-rules', 'waf-review'])).toBe(true);
    // The rules themselves are the caller's to reread.
    expect(matches(['apps', 'api', 'edge-rules'])).toBe(false);
    expect(matches(['apps', 'api', 'edge-rules', 'account', 'acct'])).toBe(false);
  });
});

describe('suggestions and the WAF review', () => {
  it('reads both per app, under keys the rule-list optimistic updates never touch', async () => {
    spyApi('GET').mockImplementation((path: string) =>
      Promise.resolve(ok(path.endsWith('suggestions') ? { suggestions: [] } : { groups: [] }))
    );
    const { client, wrapper } = setup();
    const s = renderHook(() => useEdgeRuleSuggestions('api'), { wrapper });
    const w = renderHook(() => useEdgeWAFReview('api', true), { wrapper });
    await waitFor(() => expect(s.result.current.data).toEqual({ suggestions: [] }));
    await waitFor(() => expect(w.result.current.data).toEqual({ groups: [] }));
    // queries.ts patches the rule-list queries as EdgeRule[] optimistically.
    for (const q of client.getQueryCache().getAll())
      expect(edgeRuleListFilters.predicate!(q)).toBe(false);
  });

  it('adds a CRS exclusion to one waf rule', async () => {
    const post = spyApi('POST').mockResolvedValue(ok({ id: 'r1' }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateWAFExclusions('api'), { wrapper });
    await act(() => result.current.mutateAsync({ id: 'r1', add: [942100] }));
    expect(post).toHaveBeenCalledWith('/v1/edge-rules/{id}/waf-exclusions', {
      params: { path: { id: 'r1' } },
      body: { add: [942100] },
    });
  });
});

describe('edge rule lists', () => {
  it('lists, creates, edits and deletes through the account routes', async () => {
    spyApi('GET').mockResolvedValue(ok({ lists: [{ name: 'office' }] }));
    const post = spyApi('POST').mockResolvedValue(ok({ name: 'office' }));
    const patch = spyApi('PATCH').mockResolvedValue(ok({ name: 'office' }));
    const del = spyApi('DELETE').mockResolvedValue(ok(undefined));
    const { wrapper } = setup();
    const lists = renderHook(() => useEdgeRuleLists('acct', true), { wrapper });
    await waitFor(() => expect(lists.result.current.data).toEqual({ lists: [{ name: 'office' }] }));
    const create = renderHook(() => useCreateEdgeRuleList(), { wrapper });
    await act(() =>
      create.result.current.mutateAsync({ name: 'office', kind: 'ip', items: ['203.0.113.7'] })
    );
    expect(post).toHaveBeenCalledWith('/v1/edge-rule-lists', {
      body: { name: 'office', kind: 'ip', items: ['203.0.113.7'] },
    });
    const update = renderHook(() => useUpdateEdgeRuleList(), { wrapper });
    await act(() => update.result.current.mutateAsync({ name: 'office', items: ['198.51.100.1'] }));
    expect(patch).toHaveBeenCalledWith('/v1/edge-rule-lists/{name}', {
      params: { path: { name: 'office' } },
      body: { items: ['198.51.100.1'] },
    });
    const remove = renderHook(() => useDeleteEdgeRuleList(), { wrapper });
    await act(() => remove.result.current.mutateAsync('office'));
    expect(del).toHaveBeenCalledWith('/v1/edge-rule-lists/{name}', {
      params: { path: { name: 'office' } },
    });
  });

  it('does not read lists until enabled', () => {
    const get = spyApi('GET');
    const { wrapper } = setup();
    renderHook(() => useEdgeRuleLists('acct', false), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('ruleAction', () => {
  it('unwraps the kind-keyed action apid returns (faas edgerules/rules.go:46)', () => {
    expect(
      ruleAction({
        kind: 'waf',
        action: { kind: 'waf', waf: { mode: 'block' }, penalty: { seconds: 60 } },
      } as never)
    ).toEqual({ mode: 'block' });
    expect(
      ruleAction({
        kind: 'circuit_breaker',
        action: { kind: 'circuit_breaker', circuit_breaker: { failure_threshold: 5 } },
      } as never)
    ).toEqual({ failure_threshold: 5 });
  });

  it('reads an empty payload as an empty action', () => {
    expect(ruleAction({ kind: 'challenge', action: { kind: 'challenge' } } as never)).toEqual({});
  });

  it('passes the flat shape the spec documents through unchanged', () => {
    const flat = { deny: ['0.0.0.0/0'] };
    expect(ruleAction({ kind: 'ip', action: flat } as never)).toBe(flat);
    expect(ruleAction({ kind: 'challenge', action: {} } as never)).toEqual({});
  });
});

describe('edgeRuleListFilters', () => {
  it('matches only the account and per-app rule lists', () => {
    const m = (queryKey: unknown[]) => edgeRuleListFilters.predicate!({ queryKey } as never);
    expect(m(['edge-rules'])).toBe(true);
    expect(m(['edge-rules', 'account', 'acct'])).toBe(true);
    expect(m(['apps', 'api', 'edge-rules'])).toBe(true);
    expect(m(['apps', 'api', 'edge-rules', 'account', 'acct'])).toBe(true);
    expect(m(['apps', 'api', 'edge-rules', 'versions'])).toBe(false);
    expect(m(['apps', 'api', 'edge-rules', 'version', 3])).toBe(false);
    expect(m(['edge-rule-lists', 'acct'])).toBe(false);
    expect(m(['apps', 'api', 'openapi'])).toBe(false);
  });
});
