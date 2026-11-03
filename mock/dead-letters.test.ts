import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apps } from './data';
import { registerDeadLetterMocks } from './dead-letters';

/**
 * `src/lib/mock-spec-drift.test.ts` scans `mock/plugin.ts` only, so the same
 * guarantee for the dead-letter mocks — every path exists in the spec — is
 * pinned here, with the replay rules the console's messages depend on.
 */
const SPEC = readFileSync(resolve('api/openapi.yaml'), 'utf8');
const MOCK = readFileSync(resolve('mock/dead-letters.ts'), 'utf8');

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
registerDeadLetterMocks(
  (method, template, handler) => handlers.set(`${method} ${template}`, handler),
  Problem,
  Symbol('no-content')
);
const call = (key: string, params: Record<string, string>, query = '') =>
  handlers.get(key)!({ params, query: new URLSearchParams(query), body: {} });
const slug = apps[0].slug;
type Page = { events: Array<{ id: string; source: string; replayed_at?: string | null }> };

describe('dead-letter mocks', () => {
  it('answers only paths the OpenAPI spec defines', () => {
    const specPaths = new Set([...SPEC.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]));
    const mocked = [
      ...MOCK.matchAll(/\broute\(\s*'(?:GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)'/g),
    ].map((m) => m[1]);
    expect(mocked).toHaveLength(6);
    expect(mocked.filter((path) => !specPaths.has(path))).toEqual([]);
  });

  it('replays an entry once and refuses a routing failure', () => {
    const { events } = call('GET /v1/apps/{slug}/dlq', { slug }) as Page;
    const open = events.find((event) => event.source !== 'event_route' && !event.replayed_at)!;
    const route = events.find((event) => event.source === 'event_route')!;
    const replay = 'POST /v1/apps/{slug}/dlq/{id}/replay';
    expect(call(replay, { slug, id: open.id })).toMatchObject({ __status: 202 });
    expect(() => call(replay, { slug, id: open.id })).toThrow('not_found');
    expect(() => call(replay, { slug, id: route.id })).toThrow('dead_letter_not_replayable');
  });

  it('purges ledger entries and reports the count', () => {
    const before = (call('GET /v1/apps/{slug}/dlq', { slug }) as Page).events.length;
    expect(call('DELETE /v1/apps/{slug}/dlq', { slug }, 'limit=2')).toEqual({
      app_slug: slug,
      purged: 2,
    });
    expect((call('GET /v1/apps/{slug}/dlq', { slug }) as Page).events).toHaveLength(before - 2);
  });
});
