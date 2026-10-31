import { describe, expect, it } from 'vitest';
import { wireRule } from './edge-rules';
import type { components } from '../src/lib/api/schema';

type Rule = components['schemas']['EdgeRuleResponse'];

const rule = (over: Partial<Rule>): Rule =>
  ({
    id: 'r1',
    account_id: 'a',
    app_id: 'app',
    match_host: '@app',
    match_path: '/**',
    match_methods: [],
    match_headers: {},
    priority: 10,
    enabled: true,
    kind: 'ip',
    action: { deny: ['0.0.0.0/0'] },
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  }) as Rule;

describe('wireRule', () => {
  it('wraps the action by kind, with the penalty beside it, as apid does (edgerules/rules.go:46)', () => {
    const out = wireRule(rule({ penalty: { seconds: 600, after: 1, within_seconds: 60 } }));
    expect(out.action).toEqual({
      kind: 'ip',
      ip: { deny: ['0.0.0.0/0'] },
      penalty: { seconds: 600, after: 1, within_seconds: 60 },
    });
    expect(out.penalty).toEqual({ seconds: 600, after: 1, within_seconds: 60 });
  });

  it('keys circuit breakers by their snake-case kind', () => {
    const out = wireRule(rule({ kind: 'circuit_breaker', action: {} as Rule['action'] }));
    expect(out.action).toEqual({ kind: 'circuit_breaker', circuit_breaker: {} });
  });

  it('leaves the stored rule flat', () => {
    const stored = rule({});
    wireRule(stored);
    expect(stored.action).toEqual({ deny: ['0.0.0.0/0'] });
  });
});
