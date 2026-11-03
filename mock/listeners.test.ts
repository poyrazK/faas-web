import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apps } from './data';
import { registerListenerMocks } from './listeners';

/**
 * `src/lib/mock-spec-drift.test.ts` scans `mock/plugin.ts` only, so the same
 * guarantee for the listener mocks — every path exists in the spec — is
 * pinned here, with the handler rules the console's messages depend on.
 */
const SPEC = readFileSync(resolve('api/openapi.yaml'), 'utf8');
const MOCK = readFileSync(resolve('mock/listeners.ts'), 'utf8');

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

const NO_CONTENT = Symbol('no-content');
const handlers = new Map<string, Handler>();
registerListenerMocks(
  (method, template, handler) => handlers.set(`${method} ${template}`, handler),
  Problem,
  NO_CONTENT
);
const slug = apps[0].slug;
const call = (key: string, params: Record<string, string>, body: Record<string, unknown> = {}) =>
  handlers.get(key)!({ params: { slug, ...params }, query: new URLSearchParams(), body });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as Problem).code;
  }
  return 'ok';
};
type Created = { __status: number; body: { public_port: number; enabled: boolean } };

describe('listener mocks', () => {
  it('answers only paths the OpenAPI spec defines, each on one line', () => {
    const specPaths = new Set([...SPEC.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]));
    const mocked = [
      ...MOCK.matchAll(/^\s*route\('(?:GET|POST|PUT|PATCH|DELETE)', '([^']+)'/gm),
    ].map((m) => m[1]);
    expect(mocked).toHaveLength(9);
    expect(mocked.filter((path) => !specPaths.has(path))).toEqual([]);
  });

  it('exposes only declared, public ports and allocates the lowest free public port', () => {
    expect(
      code(() =>
        call('POST /v1/apps/{slug}/tcp-listeners', {}, { name: 'metrics', guest_port: 9100 })
      )
    ).toBe('validation_failed');
    expect(
      code(() => call('POST /v1/apps/{slug}/tcp-listeners', {}, { name: 'mqtt', guest_port: 1883 }))
    ).toBe('conflict');
    const created = call(
      'POST /v1/apps/{slug}/tcp-listeners',
      {},
      { name: 'tcp-5432', guest_port: 5432 }
    ) as Created;
    expect(created.__status).toBe(201);
    expect(created.body).toMatchObject({ public_port: 40000, enabled: true });
  });

  it('starts a terminating listener disabled, and a TLS change disables a listener', () => {
    expect(
      code(() =>
        call(
          'POST /v1/apps/{slug}/tcp-listeners',
          {},
          {
            name: 'mqtts',
            guest_port: 8883,
            tls: { mode: 'terminate', hostname: '*.tenants.acme.dev' },
          }
        )
      )
    ).toBe('validation_failed');
    const created = call(
      'POST /v1/apps/{slug}/tcp-listeners',
      {},
      { name: 'mqtts', guest_port: 8883, tls: { mode: 'terminate', hostname: 'api.acme.dev' } }
    ) as Created;
    expect(created.body.enabled).toBe(false);
    const updated = call(
      'PATCH /v1/apps/{slug}/tcp-listeners/{name}',
      { name: 'mqtt' },
      { tls: { mode: 'terminate', hostname: 'api.acme.dev' } }
    ) as { enabled: boolean };
    expect(updated.enabled).toBe(false);
    expect(
      code(() =>
        call(
          'PATCH /v1/apps/{slug}/tcp-listeners/{name}',
          { name: 'mqtt' },
          { enabled: true, tls: { mode: 'passthrough' } }
        )
      )
    ).toBe('validation_failed');
  });

  it('reserves UDP disabled and deletes with no content', () => {
    const created = call(
      'POST /v1/apps/{slug}/udp-listeners',
      {},
      { name: 'udp-5353', guest_port: 5353, public_port: 0 }
    ) as Created;
    expect(created.body.enabled).toBe(false);
    expect(call('DELETE /v1/apps/{slug}/udp-listeners/{name}', { name: 'udp-5353' })).toBe(
      NO_CONTENT
    );
    expect(
      code(() => call('DELETE /v1/apps/{slug}/udp-listeners/{name}', { name: 'udp-5353' }))
    ).toBe('not_found');
  });
});
