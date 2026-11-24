import { describe, expect, it } from 'vitest';
import { integrationLimitRows, integrationsSummary } from './integration-limits';

const http = { id: 'h', name: 'Stripe', daily_request_limit: 10_000 } as never;
const ai = {
  id: 'a',
  name: 'OpenAI',
  ai_provider: 'openai',
  daily_request_limit: null,
  ai_daily_token_limit: 2_000_000,
  ai_daily_cost_limit_millicents: 2_000_000,
  ai_monthly_cost_limit_millicents: 30_000_000,
} as never;

describe('integrationLimitRows', () => {
  it('a request limit with today’s count', () => {
    expect(
      integrationLimitRows(http, {
        daily_request_count: 8_200,
        daily_request_limit: 10_000,
      } as never)
    ).toEqual([
      {
        key: 'requests',
        name: 'Requests a day',
        sentence: 'Requests stop at 10,000 a day; the gateway answers 429 until midnight UTC.',
        meter: { used: 8_200, limit: 10_000, label: '8,200 of 10,000 today' },
      },
    ]);
  });

  it('a limit whose use isn’t reported has no meter', () => {
    expect(integrationLimitRows(http)[0].meter).toBeUndefined();
  });

  it('no request limit says so', () => {
    expect(
      integrationLimitRows({ ...(http as object), daily_request_limit: null } as never)
    ).toEqual([{ key: 'requests', name: 'Requests a day', sentence: 'No daily request limit.' }]);
  });

  it('an AI integration adds its token and cost limits', () => {
    const rows = integrationLimitRows(ai, undefined, {
      daily_token_count: 1_000_000,
      daily_token_limit: 2_000_000,
      daily_cost_millicents: 1_900_000,
      daily_cost_limit_millicents: 2_000_000,
      monthly_cost_millicents: 9_000_000,
      monthly_cost_limit_millicents: 30_000_000,
    } as never);
    expect(rows.map((r) => [r.key, r.sentence, r.meter?.label])).toEqual([
      ['requests', 'No daily request limit.', undefined],
      ['tokens', 'Calls stop once today’s tokens reach 2,000,000.', '1,000,000 of 2,000,000 today'],
      ['cost-day', 'Calls stop at $20.00 of cost a day.', '$19.00 of $20.00 today'],
      ['cost-month', 'Calls stop at $300.00 of cost a month.', '$90.00 of $300.00 this month'],
    ]);
  });

  it('an AI integration without cost limits says nothing stops it for cost', () => {
    const rows = integrationLimitRows({
      ...(ai as object),
      ai_daily_token_limit: null,
      ai_daily_cost_limit_millicents: null,
      ai_monthly_cost_limit_millicents: null,
    } as never);
    expect(rows.map((r) => r.sentence)).toEqual([
      'No daily request limit.',
      'No AI limit: calls aren’t stopped for tokens or cost.',
    ]);
  });
});

describe('integrationsSummary', () => {
  it('counts integrations and the limits that are close or reached', () => {
    const at = {
      key: 'requests' as const,
      name: 'r',
      sentence: '',
      meter: { used: 10, limit: 10, label: '' },
    };
    const close = {
      key: 'requests' as const,
      name: 'r',
      sentence: '',
      meter: { used: 8, limit: 10, label: '' },
    };
    const fine = { key: 'requests' as const, name: 'r', sentence: '' };
    expect(integrationsSummary([[at], [close, fine], [fine]])).toBe(
      '3 integrations · 1 limit reached · 1 close'
    );
    expect(integrationsSummary([[fine]])).toBe('1 integration');
  });

  it('names two reached limits in the plural', () => {
    const at = {
      key: 'requests' as const,
      name: 'r',
      sentence: '',
      meter: { used: 10, limit: 10, label: '' },
    };
    expect(integrationsSummary([[at, at]])).toBe('1 integration · 2 limits reached');
  });
});

describe('which limit wins', () => {
  it('a null from ai-usage is a real “no limit”, not a fallback to the list', () => {
    const rows = integrationLimitRows(ai, undefined, {
      daily_token_count: 10,
      daily_token_limit: null,
      daily_cost_limit_millicents: null,
      monthly_cost_limit_millicents: null,
    } as never);
    expect(rows.map((r) => r.key)).toEqual(['requests', 'ai-none']);
  });

  it('cost limits the ai-usage answer leaves out fall back to the list', () => {
    const rows = integrationLimitRows(ai, undefined, {
      daily_token_count: 10,
      daily_token_limit: 2_000_000,
    } as never);
    expect(rows.map((r) => r.key)).toEqual(['requests', 'tokens', 'cost-day', 'cost-month']);
  });
});
