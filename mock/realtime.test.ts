import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockApi } from './plugin';

/** The realtime mock keeps apid's rules where the console's states depend on them. */
describe('realtime through the dev mock', () => {
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

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };
  const chat = async () => {
    const { body } = await call('GET', '/v1/apps/api-gateway/realtime/endpoints');
    return (body as { id: string; slug?: string }[]).find((e) => e.slug === 'chat')!;
  };

  it('masks tokens and never returns one it was given', async () => {
    const created = await call('POST', '/v1/apps/billing-recon/realtime/endpoints', {
      callback_url: 'https://billing-recon.example.com',
      callback_auth_token: 'callback-secret',
      auth_mode: 'static_bearer',
      auth_token: 'client-secret',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      callback_auth_token_masked: '***',
      auth_mode: 'static_bearer',
    });
    const list = await call('GET', '/v1/apps/billing-recon/realtime/endpoints');
    expect(JSON.stringify(list.body)).not.toMatch(/callback-secret|client-secret/);
  });

  it('issues a ticket once and keeps only its ID', async () => {
    const ep = await chat();
    const issued = await call('POST', `/v1/apps/api-gateway/realtime/endpoints/${ep.id}/tickets`, {
      principal: 'customer-42',
      channels: ['orders'],
      ttl_seconds: 60,
    });
    expect(issued.status).toBe(201);
    expect(issued.body.ticket).toMatch(/^grt_/);
    const all = await call(
      'DELETE',
      `/v1/apps/api-gateway/realtime/endpoints/${ep.id}/tickets?principal=customer-42`
    );
    expect(all.body).toEqual({ revoked: 1 });
    const again = await call(
      'DELETE',
      `/v1/apps/api-gateway/realtime/endpoints/${ep.id}/tickets/${issued.body.ticket_id}`
    );
    expect(again).toMatchObject({ status: 404, body: { code: 'not_found' } });
  });

  it('answers a closed connection with 410 not_found, and reports a partial fleet', async () => {
    const ep = await chat();
    const list = await call('GET', `/v1/apps/api-gateway/realtime/endpoints/${ep.id}/connections`);
    expect(list.body).toMatchObject({ partial: true, nodes_unavailable: 1 });
    const id = list.body.connections[0].id;
    const path = `/v1/apps/api-gateway/realtime/endpoints/${ep.id}/connections/${id}/close`;
    expect((await call('POST', path, {})).status).toBe(204);
    expect(await call('POST', path, {})).toMatchObject({
      status: 410,
      body: { code: 'not_found' },
    });
  });

  it('replays a publish with the same idempotency key and retains on request', async () => {
    const ep = await chat();
    const path = `/v1/apps/api-gateway/realtime/endpoints/${ep.id}/channels/orders/publish?delivery=retained`;
    const message = { data_base64: Buffer.from('hi').toString('base64') };
    const first = await call('POST', path, message, { 'Idempotency-Key': 'k-1' });
    const second = await call('POST', path, message, { 'Idempotency-Key': 'k-1' });
    expect(first.body.durable).toBe(true);
    expect(second.body).toEqual(first.body);
    const history = await call(
      'GET',
      `/v1/apps/api-gateway/realtime/endpoints/${ep.id}/channels/orders/retained-messages?after=0`
    );
    const sequences = history.body.messages.map((m: { sequence: number }) => m.sequence);
    expect(sequences).toContain(first.body.sequence);
    expect(sequences.filter((s: number) => s === first.body.sequence)).toHaveLength(1);
  });
});
