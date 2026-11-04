import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apps } from './data';
import { registerForkMocks } from './forks';

/**
 * `src/lib/mock-spec-drift.test.ts` scans `mock/plugin.ts` only, so the same
 * guarantee for the fork and crash snapshot mocks — every path exists in the
 * spec — is pinned here, with the rules the console's messages depend on.
 */
const SPEC = readFileSync(resolve('api/openapi.yaml'), 'utf8');
const MOCK = readFileSync(resolve('mock/forks.ts'), 'utf8');

class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
    readonly extra?: Record<string, unknown>
  ) {
    super(code);
  }
}
type Handler = (ctx: {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}) => unknown;

let hidden = new Set<string>();
let plan = 'pro';
const handlers = new Map<string, Handler>();
registerForkMocks(
  (method, template, handler) => handlers.set(`${method} ${template}`, handler),
  Problem,
  Symbol('no-content'),
  { hidden: (c) => hidden.has(c), plan: () => plan }
);
const call = (key: string, params: Record<string, string>, body: Record<string, unknown> = {}) =>
  handlers.get(key)!({ params, query: new URLSearchParams(), body });
const [first, second, third] = apps;
type Created = { __status: number; body: { id: string; status: string; access_token?: string } };
type List<T> = { items: T[] };

beforeEach(() => {
  hidden = new Set();
  plan = 'pro';
});
afterEach(() => vi.useRealTimers());

describe('fork mocks', () => {
  it('answers only paths the OpenAPI spec defines', () => {
    const specPaths = new Set([...SPEC.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]));
    const mocked = [
      ...MOCK.matchAll(/\broute\(\s*'(?:GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)'/g),
    ].map((m) => m[1]);
    expect(mocked).toHaveLength(13);
    expect(mocked.filter((path) => !specPaths.has(path))).toEqual([]);
  });

  it('refuses below Pro and hides a gated capability like a missing route', () => {
    plan = 'hobby';
    expect(() => call('POST /v1/apps/{slug}/forks', { slug: first.slug })).toThrow(
      'plan_app_forks_not_allowed'
    );
    plan = 'pro';
    hidden.add('production-forks');
    expect(() => call('GET /v1/apps/{slug}/forks', { slug: first.slug })).toThrow('not_found');
  });

  it('returns the token once, then holds one active fork per app and two per account', () => {
    const created = call(
      'POST /v1/apps/{slug}/forks',
      { slug: first.slug },
      {
        ttl_seconds: 900,
      }
    ) as Created;
    expect(created.__status).toBe(202);
    expect(created.body.access_token).toMatch(/^gfk_/);
    const listed = call('GET /v1/apps/{slug}/forks', { slug: first.slug }) as List<{
      id: string;
      access_token?: string;
    }>;
    expect(listed.items[0].id).toBe(created.body.id);
    expect(listed.items[0].access_token).toBeUndefined();
    expect(() => call('POST /v1/apps/{slug}/forks', { slug: first.slug })).toThrow(
      'app_fork_limit'
    );
    // The second app already has a running fork, so the account is at two.
    expect(() => call('POST /v1/apps/{slug}/forks', { slug: third.slug })).toThrow(
      'app_fork_limit'
    );
    const cancelled = call('DELETE /v1/apps/{slug}/forks/{id}', {
      slug: first.slug,
      id: created.body.id,
    }) as Created;
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('rejects a lifetime outside 60–14400 seconds', () => {
    expect(() =>
      call('POST /v1/apps/{slug}/forks', { slug: third.slug }, { ttl_seconds: 30 })
    ).toThrow('validation_failed');
  });

  it('runs a command only in a running fork and walks it to its exit code', () => {
    const { items } = call('GET /v1/apps/{slug}/forks', { slug: second.slug }) as List<{
      id: string;
      status: string;
    }>;
    const running = items.find((f) => f.status === 'running')!;
    vi.useFakeTimers({ now: Date.now() });
    const queued = call(
      'POST /v1/apps/{slug}/forks/{id}/execs',
      { slug: second.slug, id: running.id },
      { command: ['echo hi'], shell: true }
    ) as Created;
    expect(queued.body.status).toBe('queued');
    vi.advanceTimersByTime(3_000);
    const done = call('GET /v1/apps/{slug}/forks/{id}/execs/{exec_id}', {
      slug: second.slug,
      id: running.id,
      exec_id: queued.body.id,
    }) as { status: string; exit_code: number };
    expect(done).toMatchObject({ status: 'succeeded', exit_code: 0 });
  });
});

describe('crash snapshot mocks', () => {
  it('opens only a ready snapshot as a fork', () => {
    const { items } = call('GET /v1/apps/{slug}/crash-snapshots', { slug: first.slug }) as List<{
      id: string;
      status: string;
    }>;
    const failed = items.find((c) => c.status === 'failed')!;
    expect(() =>
      call('POST /v1/apps/{slug}/crash-snapshots/{id}/fork', { slug: first.slug, id: failed.id })
    ).toThrow('crash_capture_not_ready');
  });

  it('refuses a second manual capture within ten minutes', () => {
    const slug = third.slug;
    const taken = call('POST /v1/apps/{slug}/crash-snapshots', { slug }) as Created;
    expect(taken.__status).toBe(202);
    expect(() => call('POST /v1/apps/{slug}/crash-snapshots', { slug })).toThrow(
      'crash_capture_refused'
    );
  });

  it('saves the 5xx setting and is gated with production forks below Pro', () => {
    expect(
      call('PUT /v1/apps/{slug}/crash-snapshots/settings', { slug: third.slug }, { enabled: true })
    ).toMatchObject({ enabled: true });
    plan = 'free';
    expect(() =>
      call('GET /v1/apps/{slug}/crash-snapshots/settings', { slug: third.slug })
    ).toThrow('plan_app_forks_not_allowed');
  });
});
