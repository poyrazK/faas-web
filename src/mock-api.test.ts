import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../mock/plugin';

let server: Server;
let origin: string;
const savedPlan = process.env.MOCK_PLAN;

beforeAll(async () => {
  let middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  const configureServer = mockApi().configureServer;
  if (typeof configureServer !== 'function')
    throw new Error('mock API must register a Vite server hook');
  configureServer({
    config: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
    middlewares: { use: (handler: typeof middleware) => (middleware = handler) },
  } as never);
  server = createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedPlan === undefined) delete process.env.MOCK_PLAN;
  else process.env.MOCK_PLAN = savedPlan;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

async function get(path: string) {
  const response = await fetch(`${origin}${path}`);
  return { response, body: await response.json() };
}

describe('analytics mock contracts', () => {
  it.each([
    ['analytics', 'toString'],
    ['analytics', '__proto__'],
    ['analytics/timeseries', 'toString'],
    ['analytics/timeseries', '__proto__'],
  ])('%s rejects inherited group name %s', async (path, group) => {
    const result = await get(`/v1/apps/api-gateway/${path}?group_by=${group}`);

    expect(result.response.status, group).toBe(400);
    expect(result.body).toMatchObject({ code: 'validation_failed' });
  });

  it('returns complete deterministic account and app SLO panels for the selected window', async () => {
    const account = await get('/v1/account/slo?window=7d');
    const app = await get('/v1/apps/api-gateway/slo?window=1h');

    expect(account.response.status).toBe(200);
    expect(account.body).toEqual({
      window: '7d',
      source: 'prometheus',
      as_of: '2026-09-05T13:00:00.123Z',
      request_duration: { p50_ms: 22.1, p95_ms: 91, p99_ms: 410 },
      error_rate_pct: 0.55,
      cold_boot_rate_pct: 4.2,
      instance_hours: 12,
      gb_hours: 3,
      wake_queue_p95_ms: 14,
      requests_total: 12000,
      throttled_total: 23,
    });
    expect(app.response.status).toBe(200);
    expect(app.body).toEqual({
      app_id: expect.any(String),
      app_slug: 'api-gateway',
      window: '1h',
      source: 'prometheus',
      as_of: '2026-09-05T13:00:00.123Z',
      request_duration: { p50_ms: 14.2, p95_ms: 87, p99_ms: 312.5 },
      error_rate_pct: 0.41,
      cold_boot_rate_pct: 3.1,
      instance_hours: 0,
      gb_hours: 0,
      wake_queue_p95_ms: 12,
      requests_total: 4321,
      throttled_total: 0,
    });
  });

  it('echoes route and method filters, scales filtered points, and supplies grouped series', async () => {
    const all = await get('/v1/apps/api-gateway/analytics/timeseries?since=24h');
    const filtered = await get(
      '/v1/apps/api-gateway/analytics/timeseries?since=24h&route=%2Forders&method=GET&group_by=route'
    );

    expect(filtered.response.status).toBe(200);
    expect(filtered.body).toMatchObject({
      slug: 'api-gateway',
      route: '/orders',
      method: 'GET',
      group_by: 'route',
    });
    expect(filtered.body.points[0].requests).toBeLessThan(all.body.points[0].requests);
    expect(all.body).toMatchObject({
      from: '2026-09-04T14:00:00.000Z',
      until: '2026-09-05T13:00:00.123Z',
      as_of: '2026-09-05T13:00:00.123Z',
    });
    expect(all.body.points[0]).toEqual({
      start: '2026-09-04T14:00:00.000Z',
      requests: 224,
      error_requests: 1,
      error_rate_pct: 0.45,
      cold_boots: 0,
      p50_ms: 34,
      p95_ms: 144,
      p99_ms: 336,
    });
    expect(filtered.body.points[0]).toEqual({
      start: '2026-09-04T14:00:00.000Z',
      requests: 99,
      error_requests: 0,
      error_rate_pct: 0,
      cold_boots: 0,
      p50_ms: 34,
      p95_ms: 144,
      p99_ms: 336,
    });
    expect(filtered.body.series).toHaveLength(4);
    expect(filtered.body.series[0]).toMatchObject({ value: '/orders', method: 'GET' });
    expect(filtered.body.series[0].points).toHaveLength(24);
  });

  it('uses MOCK_PLAN=free for the documented analytics plan gate', async () => {
    process.env.MOCK_PLAN = 'free';

    const result = await get('/v1/apps/api-gateway/analytics/timeseries?since=24h');

    expect(result.response.status).toBe(402);
    expect(result.body).toMatchObject({ code: 'plan_per_app_metrics_not_allowed' });
  });

  it.each([
    ['an unsupported method', '?route=%2Forders&method=BREW'],
    ['a route without its method', '?route=%2Forders'],
    ['a method without its route', '?method=GET'],
    ['a route filter with a non-route grouping', '?route=%2Forders&method=GET&group_by=country'],
  ])('rejects %s', async (_label, query) => {
    const result = await get(`/v1/apps/api-gateway/analytics/timeseries${query}`);

    expect(result.response.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'validation_failed' });
  });
});

describe('seeded rollout timing', () => {
  it('seeds the canary twenty minutes before startup', async () => {
    const startup = Date.parse('2026-10-12T12:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(startup);
    vi.resetModules();
    const db = await import('../mock/data');
    const canary = db.deployments.find((deployment) => deployment.rollout_state === 'rolling_out');

    expect(canary?.canary_step_started_at).toBe('2026-10-12T11:40:00.000Z');
  });

  it('keeps the freshly seeded canary behind the rollout_not_stuck recovery gate', async () => {
    const response = await fetch(`${origin}/v1/apps/api-gateway/rollouts/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'advance' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'rollout_not_stuck' });
  });
});
