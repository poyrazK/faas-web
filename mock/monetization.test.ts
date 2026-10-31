import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monetizationMockPaths } from './monetization';
import { mockApi } from './plugin';

/**
 * `src/lib/mock-spec-drift.test.ts` reads `mock/plugin.ts` only, so the
 * monetization routes registered from this module are pinned here instead.
 */
it('answers only paths the OpenAPI spec contains', () => {
  const spec = readFileSync(resolve('api/openapi.yaml'), 'utf8');
  const specPaths = new Set([...spec.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]));
  const paths = monetizationMockPaths();
  expect(paths.length).toBeGreaterThan(20);
  expect(paths.filter((p) => !specPaths.has(p))).toEqual([]);
});

describe('through the dev mock', () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    let middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
    const configureServer = mockApi().configureServer;
    if (typeof configureServer !== 'function') throw new Error('no server hook');
    configureServer({
      config: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
      middlewares: { use: (handler: typeof middleware) => (middleware = handler) },
    } as never);
    process.env.MOCK_LATENCY = '0';
    server = createServer((req, res) => middleware(req, res, () => res.end()));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  it('issues a key whose plaintext appears once and never in the list', async () => {
    const { body } = await call('GET', '/v1/apps/api-gateway/consumers');
    const acme = body.consumers.find((c: { name: string }) => c.name === 'Acme');
    const issued = await call('POST', `/v1/apps/api-gateway/consumers/${acme.id}/keys`, {
      name: 'ci',
      scopes: ['read'],
    });
    expect(issued.status).toBe(201);
    expect(issued.body.key).toMatch(/^gcs_/);
    const list = await call('GET', `/v1/apps/api-gateway/consumers/${acme.id}/keys`);
    expect(JSON.stringify(list.body)).not.toContain(issued.body.key);
  });

  it('rejects a duplicate external reference with conflict', async () => {
    const dup = await call('POST', '/v1/apps/api-gateway/consumers', {
      external_ref: 'crm-1001',
      name: 'Acme again',
    });
    expect(dup).toMatchObject({ status: 409, body: { code: 'conflict' } });
  });

  it('replays an unchanged statement snapshot and finalizes once', async () => {
    const { body } = await call('GET', '/v1/apps/api-gateway/consumers');
    const globex = body.consumers.find((c: { name: string }) => c.name === 'Globex');
    const now = new Date();
    const period = {
      period_start: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
      ).toISOString(),
      period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    };
    const path = `/v1/apps/api-gateway/consumers/${globex.id}/usage-statements`;
    const first = await call('POST', path, period);
    expect(first.status).toBe(201);
    const again = await call('POST', path, period);
    expect(again).toMatchObject({ status: 200, body: { id: first.body.id } });
    const done = await call('POST', `${path}/${first.body.id}/finalize`);
    expect(done.body.status).toBe('finalized');
    const handoff = await call('GET', `${path}/${first.body.id}/handoff`);
    expect(handoff).toMatchObject({ status: 404, body: { code: 'not_found' } });
  });

  it('registers customers idempotently by external reference', async () => {
    const created = await call('POST', '/v1/account/platform-tenants', {
      external_ref: 'crm-9000',
      name: 'Hooli',
    });
    expect(created.status).toBe(201);
    const replay = await call('POST', '/v1/account/platform-tenants', {
      external_ref: 'crm-9000',
      name: 'Hooli',
    });
    expect(replay).toMatchObject({ status: 200, body: { id: created.body.id } });
    const clash = await call('POST', '/v1/account/platform-tenants', {
      external_ref: 'crm-9000',
      name: 'Not Hooli',
    });
    expect(clash).toMatchObject({ status: 409, body: { code: 'conflict' } });
  });
});
