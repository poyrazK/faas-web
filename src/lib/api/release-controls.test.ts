import { describe, expect, it } from 'vitest';
import { postDeployWindowAllowed, rollbackAllowedFor } from './alert-rollbacks';
import { hasUnsafe, parseReplayCorpus } from './mirror-replay';
import { routeProblem } from './route-health';

describe('parseReplayCorpus', () => {
  it('takes an array or { requests }, upper-casing methods', () => {
    const a = parseReplayCorpus('[{"method":"get","path":"/orders?limit=5"}]');
    expect(a).toEqual({ items: [{ method: 'GET', path: '/orders?limit=5' }] });
    const b = parseReplayCorpus('{"requests":[{"method":"POST","path":"/orders","body":{"n":1}}]}');
    expect('items' in b && hasUnsafe(b.items)).toBe(true);
  });

  it('refuses what apid refuses, naming the request', () => {
    expect(parseReplayCorpus('nope')).toEqual({ error: 'Paste a JSON array of requests.' });
    expect(parseReplayCorpus('[]')).toMatchObject({ error: /Between 1 and 100/ });
    expect(parseReplayCorpus('[{"method":"TRACE","path":"/"}]')).toMatchObject({
      error: /Request 1: method TRACE/,
    });
    expect(parseReplayCorpus('[{"method":"GET","path":"https://x.test/"}]')).toMatchObject({
      error: /absolute request path/,
    });
    expect(parseReplayCorpus('[{"method":"GET","path":"//x"}]')).toMatchObject({
      error: /absolute request path/,
    });
    expect(
      parseReplayCorpus('[{"method":"GET","path":"/","expected_body_sha256":"abc"}]')
    ).toMatchObject({ error: /64 hexadecimal/ });
    expect(parseReplayCorpus('[{"method":"GET","path":"/","expected_status":700}]')).toMatchObject({
      error: /100 to 599/,
    });
    const big = JSON.stringify([{ method: 'POST', path: '/', body: 'x'.repeat(70_000) }]);
    expect(parseReplayCorpus(big)).toMatchObject({ error: /64 KiB/ });
  });
});

describe('route health selectors', () => {
  it('accepts an exact normalized path, a budget and a probe on GET', () => {
    expect(
      routeProblem({
        method: 'GET',
        path: '/profiles/{id}',
        max_p95_ms: 500,
        probe: { path: '/profiles/42' },
      })
    ).toBeUndefined();
  });
  it('refuses queries, wildcards, probes on writes and templated probe paths', () => {
    expect(routeProblem({ method: 'GET', path: '/orders?x=1' })).toMatch(/No query/);
    expect(routeProblem({ method: 'GET', path: '/orders/*' })).toMatch(/wildcard/);
    expect(routeProblem({ method: 'POST', path: '/orders', probe: { path: '/orders' } })).toMatch(
      /GET and HEAD/
    );
    expect(routeProblem({ method: 'GET', path: '/u/{id}', probe: { path: '/u/{id}' } })).toMatch(
      /concrete/
    );
    expect(routeProblem({ method: 'GET', path: 'orders' })).toMatch(/starting with \//);
  });
});

describe('alert rollback eligibility', () => {
  it('lets platform signals roll back and keeps notification-only metrics to webhooks', () => {
    expect(rollbackAllowedFor('error_rate_pct')).toBe(true);
    expect(rollbackAllowedFor('latency_p95_ms')).toBe(true);
    for (const m of [
      'custom_metric',
      'queue_backlog',
      'event_pending_recipients',
      'mcp_tasks_metrics_stale',
      'edge_rule_hits',
      'pre_auth_pressure',
      'route_health_holds',
    ])
      expect(rollbackAllowedFor(m)).toBe(false);
  });
  it('rolls a completed release back only on its own error rate, above a threshold', () => {
    expect(postDeployWindowAllowed('error_rate_pct', 'gt')).toBe(true);
    expect(postDeployWindowAllowed('error_rate_pct', 'gte')).toBe(true);
    expect(postDeployWindowAllowed('error_rate_pct', 'lt')).toBe(false);
    expect(postDeployWindowAllowed('latency_p95_ms', 'gt')).toBe(false);
  });
});
