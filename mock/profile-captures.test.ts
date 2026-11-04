import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apps } from './data';
import { registerProfileCaptureMocks } from './profile-captures';

/**
 * `src/lib/mock-spec-drift.test.ts` scans `mock/plugin.ts` only, so the same
 * guarantee for the profile capture mocks — every path exists in the spec —
 * is pinned here, with the rules the console's messages depend on.
 */
const SPEC = readFileSync(resolve('api/openapi.yaml'), 'utf8');
const MOCK = readFileSync(resolve('mock/profile-captures.ts'), 'utf8');

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
  res: unknown;
}) => unknown;

let hidden = false;
let plan = 'pro';
const handlers = new Map<string, Handler>();
registerProfileCaptureMocks(
  (method, template, handler) => handlers.set(`${method} ${template}`, handler as Handler),
  Problem,
  Symbol('no-content'),
  { hidden: () => hidden, plan: () => plan }
);
const call = (
  key: string,
  params: Record<string, string>,
  { query = '', body = {}, res = {} }: { query?: string; body?: object; res?: unknown } = {}
) =>
  handlers.get(key)!({
    params,
    query: new URLSearchParams(query),
    body: body as Record<string, unknown>,
    res,
  });
const [first, second] = apps;
type Capture = { id: string; status: string; trigger: string; kinds: string[]; processes: number };

beforeEach(() => {
  hidden = false;
  plan = 'pro';
});
afterEach(() => vi.useRealTimers());

describe('profile capture mocks', () => {
  it('answers only paths the OpenAPI spec defines', () => {
    const specPaths = new Set([...SPEC.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]));
    const mocked = [
      ...MOCK.matchAll(/\broute\(\s*'(?:GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)'/g),
    ].map((m) => m[1]);
    expect(mocked).toHaveLength(7);
    expect(mocked.filter((path) => !specPaths.has(path))).toEqual([]);
  });

  it('seeds a capture of every trigger, and hides or plan-gates like apid', () => {
    const { captures } = call('GET /v1/apps/{slug}/profiles/captures', { slug: first.slug }) as {
      captures: Capture[];
    };
    expect(new Set(captures.map((c) => c.trigger))).toEqual(
      new Set(['manual', 'slow_request', 'memory_pressure', 'cpu_saturation'])
    );
    plan = 'free';
    expect(() => call('GET /v1/apps/{slug}/profiles/captures', { slug: first.slug })).toThrow(
      'plan_feature_gated'
    );
    plan = 'pro';
    hidden = true;
    expect(() => call('GET /v1/apps/{slug}/profiles/captures', { slug: first.slug })).toThrow(
      'not_found'
    );
  });

  it('runs one capture per app at a time, refuses views until ready, then serves them', () => {
    vi.useFakeTimers({ now: Date.now() });
    const created = call(
      'POST /v1/apps/{slug}/profiles/captures',
      { slug: second.slug },
      { body: { kinds: ['cpu', 'mutex'], duration_seconds: 2 } }
    ) as { __status: number; body: Capture };
    expect(created.__status).toBe(202);
    expect(() =>
      call('POST /v1/apps/{slug}/profiles/captures', { slug: second.slug }, { body: {} })
    ).toThrow('conflict');
    const params = { slug: second.slug, id: created.body.id };
    expect(() => call('GET /v1/apps/{slug}/profiles/captures/{id}/view', params)).toThrow(
      'conflict'
    );
    vi.advanceTimersByTime(4_000);
    const view = call('GET /v1/apps/{slug}/profiles/captures/{id}/view', params) as {
      unit: string;
      total: number;
      empty: boolean;
    };
    expect(view).toMatchObject({ unit: 'nanoseconds', empty: false });
    // A Python app reports no Go contention: ready, and empty.
    const mutex = call('GET /v1/apps/{slug}/profiles/captures/{id}/view', params, {
      query: 'kind=mutex',
    }) as { empty: boolean };
    expect(mutex.empty).toBe(true);
    expect(() =>
      call('GET /v1/apps/{slug}/profiles/captures/{id}/view', params, { query: 'kind=heap' })
    ).toThrow('validation_failed');
  });

  it('downloads a gzip body under apid’s filename', () => {
    const { captures } = call('GET /v1/apps/{slug}/profiles/captures', { slug: first.slug }) as {
      captures: Capture[];
    };
    const ready = captures.find((c) => c.trigger === 'manual' && c.processes > 0)!;
    const headers: Record<string, string> = {};
    let sent: Buffer | undefined;
    const res = {
      statusCode: 0,
      setHeader: (k: string, v: string) => (headers[k] = v),
      end: (b: Buffer) => (sent = b),
    };
    call(
      'GET /v1/apps/{slug}/profiles/captures/{id}/pprof',
      { slug: first.slug, id: ready.id },
      { query: 'kind=heap', res }
    );
    expect(headers['Content-Disposition']).toBe(
      `attachment; filename="profile-${ready.id}-heap.pb.gz"`
    );
    expect(gunzipSync(sent!).toString()).toContain('heap');
  });

  it('compares two captures on a kind both collected, with the growth and its warnings', () => {
    const { captures } = call('GET /v1/apps/{slug}/profiles/captures', { slug: first.slug }) as {
      captures: Capture[];
    };
    const newest = captures.find((c) => c.trigger === 'manual' && c.processes > 0)!;
    const oom = captures.find((c) => c.trigger === 'memory_pressure')!;
    const diff = call(
      'GET /v1/apps/{slug}/profiles/captures/{id}/diff',
      { slug: first.slug, id: newest.id },
      { query: `base=${oom.id}` }
    ) as { kind: string; delta: number; functions: { name: string; delta: number }[] };
    expect(diff.kind).toBe('heap');
    expect(diff.delta).toBeGreaterThan(0);
    expect(diff.functions[0].name).toBe('main.(*cache).put');
    expect(() =>
      call(
        'GET /v1/apps/{slug}/profiles/captures/{id}/diff',
        { slug: first.slug, id: newest.id },
        { query: `base=${oom.id}&kind=cpu` }
      )
    ).toThrow('validation_failed');
  });
});
