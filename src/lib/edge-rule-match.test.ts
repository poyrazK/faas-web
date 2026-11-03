import { describe, expect, it } from 'vitest';
import {
  conditionsFrom,
  conditionsToMatch,
  emptyCondition,
  listKindFor,
  opsFor,
  summariseMatch,
  validateConditions,
  type Conditions,
} from './edge-rule-match';

describe('opsFor', () => {
  it('offers cidr only on client_ip and in_list only where a list kind fits', () => {
    expect(opsFor('client_ip')).toContain('cidr');
    expect(opsFor('path')).not.toContain('cidr');
    expect(opsFor('method')).not.toContain('in_list');
    expect(opsFor('header:x-beta')).toContain('in_list');
  });

  it('keeps the bot and AI crawler fields to equality and presence', () => {
    expect(opsFor('ua_family')).toEqual(['eq', 'ne', 'in', 'not_in', 'exists', 'missing']);
    expect(opsFor('verified_ai_crawler')).not.toContain('regex');
  });

  it('keeps asn to equality, presence and lists', () => {
    expect(opsFor('asn')).toEqual(['eq', 'ne', 'in', 'not_in', 'exists', 'missing', 'in_list']);
  });
});

describe('listKindFor', () => {
  it("follows apid's fit table (edge_rule_list.go:228)", () => {
    expect(listKindFor('client_ip')).toBe('ip');
    expect(listKindFor('country')).toBe('country');
    expect(listKindFor('host')).toBe('host');
    expect(listKindFor('asn')).toBe('asn');
    expect(listKindFor('cookie:session')).toBe('string');
    expect(listKindFor('method')).toBeNull();
  });
});

describe('conditionsFrom / conditionsToMatch', () => {
  it('reads and writes a flat all-of with a negated list leaf', () => {
    const match = {
      all: [
        { field: 'country', op: 'in' as const, values: ['US', 'CA'] },
        { not: { field: 'client_ip', op: 'in_list' as const, list: 'office-ips' } },
        { field: 'header:x-beta', op: 'eq' as const, value: '1' },
      ],
    };
    const c = conditionsFrom(match);
    expect(c).not.toBeNull();
    expect(c!.join).toBe('all');
    expect(c!.items[1]).toMatchObject({ negate: true, field: 'client_ip', op: 'in_list' });
    expect(c!.items[2]).toMatchObject({ field: 'header', name: 'x-beta', values: ['1'] });
    expect(conditionsToMatch(c!)).toEqual(match);
  });

  it('writes one condition as a bare leaf and none as no condition', () => {
    const one: Conditions = {
      join: 'all',
      items: [{ ...emptyCondition(), field: 'verified_bot', op: 'missing' }],
    };
    expect(conditionsToMatch(one)).toEqual({ field: 'verified_bot', op: 'missing' });
    expect(conditionsToMatch({ join: 'any', items: [] })).toBeUndefined();
  });

  it('reads a bare not of a leaf, as the allow-ips recipe writes it', () => {
    const match = { not: { field: 'client_ip', op: 'cidr' as const, values: ['10.0.0.0/8'] } };
    expect(conditionsToMatch(conditionsFrom(match)!)).toEqual(match);
  });

  it('cannot draw a nested group, so the form falls back to JSON', () => {
    expect(
      conditionsFrom({
        all: [{ any: [{ field: 'path', op: 'prefix', values: ['/a'] }] }],
      })
    ).toBeNull();
  });
});

describe('validateConditions', () => {
  const one = (over: Partial<Conditions['items'][number]>): Conditions => ({
    join: 'all',
    items: [{ ...emptyCondition(), ...over }],
  });

  it('wants a name for header, cookie and query fields', () => {
    expect(validateConditions(one({ field: 'header', name: '', op: 'exists' }))).toHaveProperty(
      'match.0'
    );
  });

  it('wants one value for eq and regex, at least one for in, none for exists', () => {
    expect(validateConditions(one({ field: 'path', op: 'eq', values: [] }))).toHaveProperty(
      'match.0'
    );
    expect(validateConditions(one({ field: 'path', op: 'in', values: [] }))).toHaveProperty(
      'match.0'
    );
    expect(validateConditions(one({ field: 'path', op: 'exists', values: [] }))).toEqual({});
  });

  it('checks a regex compiles and a cidr parses', () => {
    expect(validateConditions(one({ field: 'path', op: 'regex', values: ['('] }))).toHaveProperty(
      'match.0'
    );
    expect(
      validateConditions(one({ field: 'client_ip', op: 'cidr', values: ['10.0.0.0/33'] }))
    ).toHaveProperty('match.0');
    expect(
      validateConditions(one({ field: 'client_ip', op: 'cidr', values: ['2001:db8::/32'] }))
    ).toEqual({});
  });

  it('wants a list for in_list', () => {
    expect(validateConditions(one({ field: 'country', op: 'in_list', list: '' }))).toHaveProperty(
      'match.0'
    );
  });

  it('keeps to 32 conditions and 64 values each', () => {
    const many: Conditions = {
      join: 'any',
      items: Array.from({ length: 32 }, () => ({
        ...emptyCondition(),
        field: 'path',
        op: 'prefix' as const,
        values: ['/a'],
      })),
    };
    expect(validateConditions(many).match).toMatch(/31/);
    expect(
      validateConditions(
        one({ field: 'path', op: 'in', values: Array.from({ length: 65 }, (_, i) => `/${i}`) })
      )
    ).toHaveProperty('match.0');
  });
});

describe('summariseMatch', () => {
  it('says how many conditions a rule has', () => {
    expect(summariseMatch(undefined)).toBe('');
    expect(summariseMatch({ field: 'verified_bot', op: 'missing' })).toBe('verified_bot missing');
    expect(
      summariseMatch({
        all: [
          { field: 'country', op: 'in', values: ['US'] },
          { field: 'path', op: 'prefix', values: ['/a'] },
        ],
      })
    ).toBe('2 conditions (all)');
  });
});
