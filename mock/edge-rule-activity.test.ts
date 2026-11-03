import { describe, expect, it } from 'vitest';
import type { components } from '../src/lib/api/schema';
import { events, stats } from './edge-rule-activity';

type Rule = components['schemas']['EdgeRuleResponse'];

const rule = (over: Partial<Rule>): Rule => ({
  id: 'r1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
});
const NOW = Date.parse('2026-11-03T12:30:00Z');

describe('edge rule activity mock', () => {
  it('buckets hits by the hour from the truncated window start, logged apart', () => {
    const out = stats(
      [rule({}), rule({ id: 'r2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', mode: 'log' })],
      '24h',
      true,
      NOW
    );
    if (typeof out === 'string') throw new Error(out);
    expect(out.since).toBe('2026-11-02T12:00:00.000Z');
    expect(out.rules[0].series).toHaveLength(25);
    expect(out.rules[1].matched).toBe(0);
    expect(out.rules[1].logged).toBeGreaterThan(0);
  });

  it('counts nothing for a disabled rule and refuses an unknown window', () => {
    const out = stats([rule({ enabled: false })], '1h', false, NOW);
    expect(typeof out !== 'string' && out.rules).toEqual([]);
    expect(stats([rule({})], '30d', false, NOW)).toMatch(/window/);
  });

  it("clamps since to the plan's event window and pages newest first", () => {
    const q = new URLSearchParams({ since: '7d', limit: '4' });
    const free = events([rule({})], 'api.example.com', 'free', q, NOW);
    if (typeof free === 'string') throw new Error(free);
    expect(free.since).toBe(new Date(NOW - 24 * 3_600_000).toISOString());
    const pro = events([rule({})], 'api.example.com', 'pro', q, NOW);
    if (typeof pro === 'string') throw new Error(pro);
    expect(pro.events).toHaveLength(4);
    expect(pro.next_cursor).toBe('4');
    const times = pro.events.map((e) => Date.parse(e.occurred_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filters by outcome and request id, and says the outcome is unknown', () => {
    const rules = [rule({ kind: 'waf', action: { mode: 'block' } })];
    const blocked = events(
      rules,
      'h',
      'pro',
      new URLSearchParams({ since: '7d', outcome: 'blocked' }),
      NOW
    );
    if (typeof blocked === 'string') throw new Error(blocked);
    expect(blocked.events.every((e) => e.outcome === 'blocked' && e.waf_categories)).toBe(true);
    const one = blocked.events[0];
    const found = events(
      rules,
      'h',
      'pro',
      new URLSearchParams({ since: '7d', request_id: one.request_id! }),
      NOW
    );
    expect(typeof found !== 'string' && found.events.map((e) => e.id)).toEqual([one.id]);
    expect(events(rules, 'h', 'pro', new URLSearchParams({ outcome: 'nope' }), NOW)).toMatch(
      /outcome/
    );
  });
});
