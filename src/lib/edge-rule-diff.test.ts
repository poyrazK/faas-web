import { describe, expect, it } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';
import { diffRuleSets, rollbackSummary } from './edge-rule-diff';

const rule = (id: string, over: Partial<EdgeRule> = {}): EdgeRule => ({
  id,
  account_id: 'acct',
  app_id: 'app',
  match_host: '@app',
  match_path: '/**',
  match_methods: [],
  match_headers: {},
  priority: 100,
  enabled: true,
  kind: 'ip',
  action: { deny: ['0.0.0.0/0'] },
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
});

describe('diffRuleSets', () => {
  it('pairs rules by id: what comes back, what goes, what changes', () => {
    const current = [rule('a'), rule('b', { priority: 20 }), rule('c')];
    const target = [rule('a'), rule('b', { priority: 10, enabled: false }), rule('d')];
    const diff = diffRuleSets(current, target);
    expect(diff.map((d) => [d.id, d.change, d.fields])).toEqual([
      ['b', 'changed', ['priority', 'enabled']],
      ['d', 'added', []],
      ['c', 'removed', []],
      ['a', 'same', []],
    ]);
  });

  it('ignores timestamps and the read-only fields the server derives', () => {
    const before = rule('a', {
      updated_at: '2026-10-02T00:00:00Z',
      unreleased_features: ['challenge'],
    });
    expect(diffRuleSets([before], [rule('a')])[0].change).toBe('same');
  });

  it('compares actions and conditions by value, not key order', () => {
    const a = rule('a', { action: { requests_per_second: 1, burst: 2 } as EdgeRule['action'] });
    const b = rule('a', { action: { burst: 2, requests_per_second: 1 } as EdgeRule['action'] });
    expect(diffRuleSets([a], [b])[0].change).toBe('same');
    const c = rule('a', { action: { burst: 3, requests_per_second: 1 } as EdgeRule['action'] });
    expect(diffRuleSets([a], [c])[0].fields).toEqual(['action']);
  });

  it('leaves the attack-mode rule out: a rollback keeps the current one', () => {
    const managed = rule('m', { kind: 'challenge', managed_by: 'attack_mode', action: {} });
    expect(diffRuleSets([managed], [])).toEqual([]);
    expect(diffRuleSets([], [managed])).toEqual([]);
  });
});

describe('rollbackSummary', () => {
  it('counts the changes in words', () => {
    const diff = diffRuleSets([rule('a'), rule('c')], [rule('a', { priority: 1 }), rule('d')]);
    expect(rollbackSummary(diff)).toBe('1 rule comes back, 1 is deleted and 1 changes.');
  });

  it('says when nothing changes', () => {
    expect(rollbackSummary(diffRuleSets([rule('a')], [rule('a')]))).toBe(
      'The rules are the same as now.'
    );
  });
});

describe('diffRuleSets across action shapes', () => {
  it('compares the kind payload whether apid sent it wrapped or flat', () => {
    const flat = rule('a', { action: { deny: ['0.0.0.0/0'] } });
    const wrapped = rule('a', {
      action: { kind: 'ip', ip: { deny: ['0.0.0.0/0'] } } as unknown as EdgeRule['action'],
    });
    expect(diffRuleSets([flat], [wrapped])[0].change).toBe('same');
  });
});
