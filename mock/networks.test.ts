import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apps } from './data';
import { registerNetworkMocks } from './networks';

/**
 * `src/lib/mock-spec-drift.test.ts` scans `mock/plugin.ts` only, so the same
 * guarantee for the private-network mocks — every path exists in the spec —
 * is pinned here, with the handler rules the console's messages depend on.
 */
const SPEC = readFileSync(resolve('api/openapi.yaml'), 'utf8');
const MOCK = readFileSync(resolve('mock/networks.ts'), 'utf8');

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
registerNetworkMocks(
  (method, template, handler) => handlers.set(`${method} ${template}`, handler),
  Problem,
  NO_CONTENT
);
const call = (
  key: string,
  params: Record<string, string> = {},
  body: Record<string, unknown> = {}
) => handlers.get(key)!({ params, query: new URLSearchParams(), body });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as Problem).code;
  }
  return 'ok';
};
const slug = apps[0].slug;

afterEach(() => {
  delete process.env.MOCK_PLAN;
  delete process.env.MOCK_PRIVATE_NETWORKS;
});

describe('private network mocks', () => {
  it('answers only paths the OpenAPI spec defines, each on one line', () => {
    const specPaths = new Set([...SPEC.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]));
    const mocked = [
      ...MOCK.matchAll(/^\s*route\('(?:GET|POST|PUT|PATCH|DELETE)', '([^']+)'/gm),
    ].map((m) => m[1]);
    expect(mocked).toHaveLength(13);
    expect(mocked.filter((path) => !specPaths.has(path))).toEqual([]);
  });

  it('refuses an overlapping range, then peers two networks as pending', () => {
    expect(
      code(() =>
        call('POST /v1/networks', {}, { name: 'dup', region: 'fra1', cidr: '10.42.128.0/17' })
      )
    ).toBe('conflict');
    expect(
      code(() => call('POST /v1/networks', {}, { name: 'big', region: 'fra1', cidr: '10.0.0.0/8' }))
    ).toBe('private_network_invalid');
    const created = call(
      'POST /v1/networks',
      {},
      { name: 'edge-net', region: 'fra1', cidr: '10.70.0.0/24' }
    ) as { __status: number };
    expect(created.__status).toBe(201);
    const peering = call(
      'POST /v1/networks/{id}/peerings',
      { id: 'edge-net' },
      { peer_network_id: 'prod-net' }
    ) as { __status: number; body: { status: string; peer_network_id: string } };
    expect(peering.__status).toBe(202);
    expect(peering.body).toMatchObject({ status: 'pending', peer_network_id: 'prod-net' });
    expect(
      code(() =>
        call('POST /v1/networks/{id}/peerings', { id: 'prod-net' }, { peer_network_id: 'edge-net' })
      )
    ).toBe('conflict');
  });

  it('refuses to delete a network an app is attached to', () => {
    expect(code(() => call('DELETE /v1/networks/{id}', { id: 'prod-net' }))).toBe('conflict');
  });

  it('attaches as pending with a member address, and detaches', () => {
    const attached = call(
      'PUT /v1/apps/{slug}/network/private',
      { slug },
      { network_id: 'data-net' }
    ) as { __status: number; body: { attachment: { status: string; address: string } } };
    expect(attached.__status).toBe(202);
    expect(attached.body.attachment).toMatchObject({ status: 'pending', address: '10.43.0.2' });
    expect(call('DELETE /v1/apps/{slug}/network/private', { slug })).toBe(NO_CONTENT);
    expect(
      (call('GET /v1/apps/{slug}/network/private', { slug }) as { attachment: unknown }).attachment
    ).toBeNull();
  });

  it('answers the plan refusal and the disabled installation by their codes', () => {
    process.env.MOCK_PLAN = 'hobby';
    expect(
      code(() =>
        call('POST /v1/networks', {}, { name: 'x-net', region: 'fra1', cidr: '10.80.0.0/24' })
      )
    ).toBe('plan_private_network_not_allowed');
    expect(
      (call('GET /v1/apps/{slug}/network/private', { slug }) as { plan_allowed: boolean })
        .plan_allowed
    ).toBe(false);
    process.env.MOCK_PRIVATE_NETWORKS = 'off';
    expect(code(() => call('GET /v1/networks'))).toBe('private_network_not_enabled');
  });
});
