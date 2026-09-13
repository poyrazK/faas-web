import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connect } from 'vite';
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

it('reads back the saved spend cap, preserving zero and null', async () => {
  for (const cap of [1250, 0, null]) {
    const saved = await fetch(`${origin}/v1/account/overage-cap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overage_cap_cents: cap }),
    });
    expect(saved.status).toBe(200);
    const { response, body } = await get('/v1/account/overage-cap');
    expect(response.status).toBe(200);
    expect(body).toEqual({ overage_cap_cents: cap });
  }
});

describe('workload creation mock contract', () => {
  const definition = {
    name: 'console-backup',
    kind: 'batch',
    image_ref: 'ghcr.io/acme/backup:v1',
    command: ['/bin/sh', '-c', 'echo "backup done"'],
  };
  const create = (name = definition.name) =>
    fetch(`${origin}/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...definition, name }),
    });
  it('creates a readable definition with no fabricated past runs', async () => {
    const response = await create();
    expect(response.status).toBe(201);
    const job = await response.json();
    expect(job).toMatchObject({ ...definition, id: expect.any(String), status: 'active' });
    expect((await get(`/v1/jobs/${definition.name}`)).body).toEqual(job);
    expect((await get(`/v1/jobs/${definition.name}/runs`)).body.runs).toEqual([]);
    expect((await get('/v1/jobs')).body.jobs).toContainEqual(job);
  });
  it('rejects duplicate names', async () => {
    expect((await create('duplicate-backup')).status).toBe(201);
    expect((await create('duplicate-backup')).status).toBe(409);
  });
  it('preserves the free-plan gate for creation', async () => {
    process.env.MOCK_PLAN = 'free';
    const response = await create();
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: 'jobs_not_allowed' });
  });
});

describe('app release history mock contract', () => {
  it('pages newest-first within the selected app without repeating the cursor row', async () => {
    const first = await get('/v1/apps/api-gateway/deployments?limit=1');
    expect(first.response.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.next_before).toEqual(expect.any(String));
    const second = await get(
      `/v1/apps/api-gateway/deployments?limit=1&before=${encodeURIComponent(first.body.next_before)}`
    );
    expect(second.response.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].app_id).toBe(first.body.items[0].app_id);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    expect(Date.parse(second.body.items[0].created_at)).toBeLessThanOrEqual(
      Date.parse(first.body.items[0].created_at)
    );
    const other = await get('/v1/apps/image-resize/deployments?limit=1');
    expect(other.body.items[0].app_id).not.toBe(first.body.items[0].app_id);
  });

  it('does not present an unknown app as an empty release history', async () => {
    const result = await get('/v1/apps/unknown-overview-app/deployments');
    expect(result.response.status).toBe(404);
    expect(result.body.code).toBe('app_not_found');
  });
});

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

describe('deployment mock contracts', () => {
  it('serves the latest deployment for each app before the dynamic deployment route', async () => {
    const result = await get('/v1/deployments/latest-by-app');

    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({
      items: expect.arrayContaining([
        expect.objectContaining({ app_id: expect.any(String), created_at: expect.any(String) }),
      ]),
    });
    const appIDs = result.body.items.map((deployment: { app_id: string }) => deployment.app_id);
    expect(new Set(appIDs).size).toBe(appIDs.length);
  });
});

describe('mock API', () => {
  it('keeps deleted apps hidden but restorable during their grace window', async () => {
    const plugin = mockApi();
    let middleware: Connect.NextHandleFunction | undefined;
    if (typeof plugin.configureServer !== 'function') throw new Error('Missing server hook');
    plugin.configureServer({
      config: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      middlewares: {
        use(handler: Connect.NextHandleFunction) {
          middleware = handler;
        },
      },
    } as never);
    const server = createServer((req, res) =>
      middleware!(req, res, () => {
        res.statusCode = 599;
        res.end();
      })
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const slug = 'delete-grace-contract';
      const created = await fetch(`${base}/v1/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      expect(created.status).toBe(201);
      const original = (await created.json()) as { id: string };
      expect((await fetch(`${base}/v1/apps/${slug}`, { method: 'DELETE' })).status).toBe(204);
      expect((await fetch(`${base}/v1/apps/${slug}`)).status).toBe(404);
      const active = (await fetch(`${base}/v1/apps`).then((r) => r.json())) as Array<{
        slug: string;
      }>;
      expect(active.some((app) => app.slug === slug)).toBe(false);
      const restored = await fetch(`${base}/v1/apps/${slug}/restore`, { method: 'POST' });
      expect(restored.status).toBe(200);
      expect(await restored.json()).toMatchObject({ id: original.id, slug, status: 'active' });
      expect((await fetch(`${base}/v1/apps/${slug}/restore`, { method: 'POST' })).status).toBe(409);
      expect((await fetch(`${base}/v1/apps/${slug}`, { method: 'DELETE' })).status).toBe(204);
      clock.mockReturnValue(now + 8 * 86400e3);
      const expired = await fetch(`${base}/v1/apps/${slug}/restore`, { method: 'POST' });
      expect(expired.status).toBe(409);
      expect(await expired.json()).toMatchObject({ code: 'app_not_restorable' });
    } finally {
      clock.mockRestore();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
  it('requires the one-time token for invitation revocation and never returns it in lists', async () => {
    const plugin = mockApi();
    let middleware: Connect.NextHandleFunction | undefined;
    if (typeof plugin.configureServer !== 'function') throw new Error('Missing server hook');
    plugin.configureServer({
      config: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      middlewares: {
        use(handler: Connect.NextHandleFunction) {
          middleware = handler;
        },
      },
    } as never);
    const server = createServer((req, res) =>
      middleware!(req, res, () => {
        res.statusCode = 599;
        res.end();
      })
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const organizations = (await fetch(`${base}/v1/orgs`).then((r) => r.json())) as {
        orgs: Array<{ slug: string; personal: boolean }>;
      };
      const org = organizations.orgs.find((o) => !o.personal)!;
      const created = await fetch(`${base}/v1/orgs/${org.slug}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'token-contract@example.com', role: 'viewer' }),
      });
      expect(created.status).toBe(201);
      const invitation = (await created.json()) as { id: string; token: string };
      const invalid = await fetch(`${base}/v1/orgs/${org.slug}/invitations/${invitation.id}`, {
        method: 'DELETE',
      });
      expect(invalid.status).toBe(410);
      expect(await invalid.json()).toMatchObject({ code: 'org_invitation_invalid' });
      const listed = (await fetch(`${base}/v1/orgs/${org.slug}/invitations`).then((r) =>
        r.json()
      )) as { invitations: Array<{ id: string; status: string; token?: string }> };
      expect(listed.invitations.find((i) => i.id === invitation.id)).toMatchObject({
        status: 'pending',
      });
      expect(JSON.stringify(listed)).not.toContain(invitation.token);
      expect(listed.invitations.every((i) => i.token === undefined)).toBe(true);
      const revoked = await fetch(`${base}/v1/orgs/${org.slug}/invitations/${invitation.token}`, {
        method: 'DELETE',
      });
      expect(revoked.status).toBe(204);
      expect(
        (
          await fetch(`${base}/v1/orgs/${org.slug}/invitations/${invitation.token}`, {
            method: 'DELETE',
          })
        ).status
      ).toBe(410);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
  it('serves the latest-by-app collection instead of treating it as a deployment id', async () => {
    const plugin = mockApi();
    let middleware: Connect.NextHandleFunction | undefined;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    if (typeof plugin.configureServer !== 'function') {
      throw new Error('mock API plugin has no development-server hook');
    }

    plugin.configureServer({
      config: { logger },
      middlewares: {
        use(handler: Connect.NextHandleFunction) {
          middleware = handler;
        },
      },
    } as never);

    if (!middleware) throw new Error('mock API middleware was not registered');

    const server = createServer((req, res) => {
      middleware!(req, res, () => {
        res.statusCode = 599;
        res.end('request fell through');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/v1/deployments/latest-by-app`);
      const body = (await response.json()) as {
        code?: string;
        items?: Array<{ app_id: string }>;
      };

      expect(response.status).toBe(200);
      expect(body.code).toBeUndefined();
      expect(body.items?.length).toBeGreaterThan(0);
      expect(new Set(body.items?.map((deployment) => deployment.app_id)).size).toBe(
        body.items?.length
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('stages account deletion and restores the account during the recovery window', async () => {
    const plugin = mockApi();
    let middleware: Connect.NextHandleFunction | undefined;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    if (typeof plugin.configureServer !== 'function') {
      throw new Error('mock API plugin has no development-server hook');
    }
    plugin.configureServer({
      config: { logger },
      middlewares: {
        use(handler: Connect.NextHandleFunction) {
          middleware = handler;
        },
      },
    } as never);
    if (!middleware) throw new Error('mock API middleware was not registered');

    const server = createServer((req, res) => {
      middleware!(req, res, () => {
        res.statusCode = 599;
        res.end('request fell through');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const { port } = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}`;
      const deleted = await fetch(`${base}/v1/account`, { method: 'DELETE' });
      const staged = (await deleted.json()) as { status?: string; restore_until?: string };
      expect(deleted.status).toBe(200);
      expect(staged.status).toBe('deleted_pending');
      expect(staged.restore_until).toBeTruthy();

      const pending = await fetch(`${base}/v1/account`).then((response) => response.json());
      expect(pending).toEqual(expect.objectContaining({ status: 'deleted_pending' }));

      const restored = await fetch(`${base}/v1/account/restore`, { method: 'POST' });
      expect(restored.status).toBe(200);
      expect(await restored.json()).toEqual(expect.objectContaining({ status: 'active' }));
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
