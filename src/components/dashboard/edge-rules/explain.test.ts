import { expect, it } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';
import { explainRule, ruleScope, explainCondition } from './explain';

const rule = (
  kind: EdgeRule['kind'],
  action: unknown,
  patch: Partial<EdgeRule> = {}
): EdgeRule => ({
  id: 'rule-1',
  account_id: 'account-1',
  app_id: 'app-1',
  kind,
  action: action as EdgeRule['action'],
  match_host: '@app',
  match_path: '/**',
  match_methods: [],
  match_headers: {},
  priority: 10,
  enabled: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...patch,
});

it('describes the actual source and destination, including a kind-wrapped action', () => {
  const value = rule(
    'route',
    { kind: 'route', route: { target_app_slug: 'api-canary' } },
    { match_host: 'api.example.test', match_path: '/v1/*', match_methods: ['POST'] }
  );
  expect(explainRule(value, 'api')).toBe(
    'Sends POST requests for /v1/* on api.example.test to api-canary.'
  );
  expect(ruleScope(value, 'api')).toBe('');
});

it('names the countries and retains both allow and deny restrictions', () => {
  expect(explainRule(rule('geo', { deny: ['TR'] }), 'api')).toBe('Blocks requests from Turkey.');
  expect(explainRule(rule('geo', { allow: ['TR', 'DE'], deny: ['DE'] }), 'api')).toBe(
    'Allows requests only from Turkey and Germany, excluding Germany.'
  );
  expect(explainRule(rule('geo', { deny: ['KP'] }), 'api')).toBe(
    'Blocks requests from North Korea.'
  );
});

it('uses the actual maintenance interval and body limit', () => {
  expect(explainRule(rule('maintenance', { retry_after_seconds: 0 }), 'api')).toContain(
    'retry after 1 minute'
  );
  expect(explainRule(rule('maintenance', { retry_after_seconds: 300 }), 'api')).toBe(
    'Returns a maintenance response (503); callers can retry after 5 minutes.'
  );
  expect(explainRule(rule('limit', { max_body_bytes: 10485760 }), 'api')).toBe(
    'Rejects request bodies larger than 10 MiB.'
  );
});

it('keeps paused, expired and log-only behavior hypothetical', () => {
  expect(explainRule(rule('geo', { deny: ['TR'] }, { enabled: false }), 'api')).toBe(
    'Paused. Would block requests from Turkey.'
  );
  expect(explainRule(rule('geo', { deny: ['TR'] }, { mode: 'log' }), 'api')).toBe(
    'Log only. Would block requests from Turkey.'
  );
  expect(
    explainRule(rule('geo', { deny: ['TR'] }, { expires_at: '2026-01-02T00:00:00Z' }), 'api', {
      now: Date.parse('2026-01-03T00:00:00Z'),
    })
  ).toBe('Expired. Would block requests from Turkey.');
});

it('preserves nested conditions and app scope instead of claiming an unconditional block', () => {
  const value = rule(
    'ip',
    { deny: ['0.0.0.0/0', '::/0'] },
    {
      match_path: '/admin/*',
      match: { not: { field: 'client_ip', op: 'in_list', list: 'office-ips' } },
    }
  );
  expect(explainRule(value, 'api')).toBe('Blocks matching requests from any IP address.');
  expect(ruleScope(value, 'api')).toBe(
    'Applies to requests for /admin/* on api when the client IP is not in the office-ips list.'
  );
  expect(
    explainCondition({
      all: [
        { field: 'country', op: 'eq', value: 'TR' },
        {
          any: [
            { field: 'method', op: 'eq', value: 'GET' },
            { field: 'path', op: 'prefix', values: ['/public'] },
          ],
        },
      ],
    })
  ).toBe('(the country is Turkey and (the method is GET or the path starts with /public))');
});

it('keeps sensitive matching values inside the rule, and makes unknown enforcement explicit', () => {
  const value = rule(
    'route',
    { target_app_slug: 'billing' },
    {
      match_headers: { Authorization: 'secret-token' },
      match: { field: 'cookie:session', op: 'eq', value: 'secret-session' },
    }
  );
  expect(ruleScope(value, 'api')).toContain('Authorization matches its saved header value');
  expect(ruleScope(value, 'api')).not.toContain('secret');
  const waf = rule('waf', { mode: 'block', anomaly_threshold: 8 });
  expect(explainRule(waf, 'api', { wafBlocking: true })).toBe(
    'Blocks requests with an attack score of 8 or higher.'
  );
  expect(explainRule(waf, 'api', { wafBlocking: false })).toContain('without blocking');
  expect(explainRule(waf, 'api')).toContain('could not be confirmed');
});

it('names header changes without leaking values and identifies rate-limit scope', () => {
  expect(
    explainRule(
      rule('headers', {
        request_headers: [{ name: 'X-Tenant', action: 'set', value: 'private' }],
        response_headers: [{ name: 'X-Powered-By', action: 'remove' }],
      }),
      'api'
    )
  ).toBe('Sets X-Tenant on requests and removes X-Powered-By on responses.');
  expect(
    explainRule(rule('throttle', { requests_per_second: 50, burst: 100, key_by: 'ip' }), 'api')
  ).toBe('Limits traffic to 50 requests per second per IP address, with bursts of 100.');
});

it('resolves a linked browser policy only for the matching account and app', () => {
  const value = rule('cors', { cors_preset_id: 'preset-1' });
  const preset = {
    id: 'preset-1',
    account_id: 'account-1',
    app_id: null,
    name: 'Web frontend',
    allow_origins: ['https://app.example.test'],
    allow_methods: ['GET', 'POST'],
  };
  expect(explainRule(value, 'api', { corsPreset: preset })).toBe(
    'Allows browser calls from https://app.example.test using GET and POST (Web frontend).'
  );
  expect(
    explainRule(
      rule('cors', {
        cors_preset_id: 'preset-1',
        allow_origins: ['https://override.example.test'],
        allow_methods: ['PUT'],
      }),
      'api',
      { corsPreset: preset }
    )
  ).toBe('Allows browser calls from https://override.example.test using PUT (Web frontend).');
  expect(
    explainRule(value, 'api', { corsPreset: { ...preset, account_id: 'another-account' } })
  ).not.toContain('app.example.test');
  expect(
    explainRule(value, 'api', { corsPreset: { ...preset, app_id: 'another-app' } })
  ).not.toContain('app.example.test');
});
