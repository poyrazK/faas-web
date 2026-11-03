import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerEventConsumerMocks } from './event-consumers';

/**
 * `src/lib/mock-spec-drift.test.ts` scans `mock/plugin.ts` only, so the
 * consumer mocks pin their own paths against the spec here, with the pause
 * and resume rules the console depends on.
 */
const SPEC = readFileSync(resolve('api/openapi.yaml'), 'utf8');
const MOCK = readFileSync(resolve('mock/event-consumers.ts'), 'utf8');

class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}
type Handler = (ctx: {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}) => unknown;
const handlers = new Map<string, Handler>();
registerEventConsumerMocks(
  (method, template, handler) => handlers.set(`${method} ${template}`, handler),
  Problem
);
const call = (key: string, params: Record<string, string>, body = {}, query = '') =>
  handlers.get(key)!({ params, query: new URLSearchParams(query), body });

const CONTROL = '/v1/apps/{slug}/event-subscriptions/{subscriptionID}/delivery-control';

describe('event consumer mocks', () => {
  it('answers only paths the OpenAPI spec defines', () => {
    const specPaths = new Set([...SPEC.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]));
    const mocked = [
      ...MOCK.matchAll(/\broute\(\s*'(?:GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)'/g),
    ].map((m) => m[1]);
    expect(mocked).toHaveLength(6);
    expect(mocked.filter((path) => !specPaths.has(path))).toEqual([]);
  });

  it('pauses and resumes at a rate, refusing one outside 0 to 100', () => {
    const { subscriptions } = call('GET /v1/apps/{slug}/event-subscriptions', {
      slug: 'billing-recon',
    }) as { subscriptions: Array<{ id: string }> };
    const params = { slug: 'billing-recon', subscriptionID: subscriptions[0].id };
    expect(call(`GET ${CONTROL}`, params)).toMatchObject({ paused: true, pending_recipients: 42 });
    expect(() => call(`POST ${CONTROL}/resume`, params, { rate_per_second: 101 })).toThrow(
      'validation_failed'
    );
    expect(call(`POST ${CONTROL}/resume`, params, { rate_per_second: 0 })).toMatchObject({
      paused: false,
      rate_per_second: 0,
    });
    expect(call(`POST ${CONTROL}/pause`, params)).toMatchObject({ paused: true });
  });

  it('refuses a subscription that belongs to another app', () => {
    expect(() =>
      call(`GET ${CONTROL}`, { slug: 'search-indexer', subscriptionID: 'nope' })
    ).toThrow('not_found');
  });
});
