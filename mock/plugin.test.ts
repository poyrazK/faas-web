import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Drives the mock through its real Vite middleware over HTTP, in the empty
 * workspace (`MOCK_EMPTY=1`): a fresh account with GitHub not connected.
 * Only `Date` is faked, so the lifecycle clock is controlled while the
 * server, its latency, and fetch keep running on real timers.
 */

let server: Server;
let base: string;
let db: typeof import('./data');

beforeAll(async () => {
  vi.stubEnv('MOCK_EMPTY', '1');
  vi.stubEnv('MOCK_LATENCY', '0');
  vi.resetModules();
  const { mockApi } = await import('./plugin');
  db = await import('./data');
  type Middleware = (req: unknown, res: unknown, next: () => void) => void;
  let middleware: Middleware | undefined;
  const plugin = mockApi() as unknown as {
    configureServer: (server: unknown) => void;
  };
  plugin.configureServer({
    config: { logger: { info() {}, warn() {}, error() {} } },
    middlewares: { use: (fn: Middleware) => (middleware = fn) },
  });
  server = createServer((req, res) =>
    middleware!(req, res, () => {
      res.statusCode = 404;
      res.end();
    })
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.stubEnv('MOCK_EMPTY', '1');
  vi.stubEnv('MOCK_LATENCY', '0');
});

const json = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  return { status: res.status, body: await res.json() };
};

const connect = (form: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(`${base}/dashboard/install/connect`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form).toString(),
  });

const listRepos = () =>
  json('/v1/install/repos/list', {
    method: 'POST',
    body: JSON.stringify({ installation_id: 48213377, repo_full_name: '' }),
  });

describe('POST /dashboard/install/connect', () => {
  it('refuses a post without the connect token and leaves GitHub disconnected', async () => {
    const res = await connect({ csrf_token: '' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/dashboard/account?github=connect-forbidden');
    expect((await json('/v1/account')).body.github_install_id).toBeNull();
    expect((await listRepos()).status).toBe(403);
  });

  it('marks GitHub connected and redirects to the form’s return target', async () => {
    expect((await json('/v1/account')).body.github_install_id).toBeNull();
    const res = await connect({
      csrf_token: 'mock-csrf',
      return_to: '/dashboard/settings?section=integrations',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      '/dashboard/settings?section=integrations&github=connected&default_branch=main'
    );
    expect((await json('/v1/account')).body.github_install_id).toBe('48213377');
    const repos = await listRepos();
    expect(repos.status).toBe(200);
    expect(repos.body.length).toBeGreaterThan(0);
  });

  it('falls back to the Referer, then to the Git wizard, never off-origin', async () => {
    const viaReferer = await connect(
      { csrf_token: 'mock-csrf', return_to: '//evil.example/steal' },
      { Referer: `${base}/onboarding?step=2` }
    );
    expect(viaReferer.headers.get('location')).toBe(
      '/onboarding?step=2&github=connected&default_branch=main'
    );
    const foreign = await connect(
      { csrf_token: 'mock-csrf' },
      { Referer: 'https://elsewhere.example/x' }
    );
    expect(foreign.headers.get('location')).toBe(
      '/dashboard/apps/new?source=git&github=connected&default_branch=main'
    );
  });
});

describe('a deployment created through the mock', () => {
  async function createAndDeploy(slug: string) {
    const created = await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug, type: 'app', runtime: 'node24' }),
    });
    expect(created.status).toBe(201);
    const deployed = await json(`/v1/apps/${slug}/deployments/source-ref`, {
      method: 'POST',
      body: JSON.stringify({ repo: 'acme-corp/storefront', ref: 'main' }),
    });
    expect(deployed.status).toBe(202);
    return deployed.body as { id: string; build_id: string; status: string };
  }

  it('reads as building early and live once the window has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-10-17T12:00:00Z');
    vi.setSystemTime(t0);
    const dep = await createAndDeploy('first-live');
    expect(dep.status).toBe('pending');

    vi.setSystemTime(t0 + 3_000);
    expect((await json(`/v1/deployments/${dep.id}`)).body.status).toBe('building');
    expect((await json(`/v1/builds/${dep.build_id}`)).body.status).toBe('running');
    // The API reports the app as active while it deploys; the mock's scenario carries it.
    expect(db.scenarioOf({ slug: 'first-live' })).toBe('deploying');

    vi.setSystemTime(t0 + 12_000);
    expect((await json(`/v1/deployments/${dep.id}`)).body).toMatchObject({
      status: 'live',
      traffic_percent: 100,
    });
    expect((await json(`/v1/builds/${dep.build_id}`)).body.status).toBe('succeeded');
    expect((await json('/v1/apps/first-live')).body).toMatchObject({
      status: 'active',
      url: 'https://first-live.gregale.dev',
    });
    const latest = (await json('/v1/deployments/latest-by-app')).body.items;
    expect(latest.find((row: { id: string }) => row.id === dep.id)?.status).toBe('live');
  });

  it('fails at the build stage under MOCK_BUILD_FAIL=1', async () => {
    vi.stubEnv('MOCK_BUILD_FAIL', '1');
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-10-17T13:00:00Z');
    vi.setSystemTime(t0);
    const dep = await createAndDeploy('first-fail');

    vi.setSystemTime(t0 + 12_000);
    expect((await json(`/v1/deployments/${dep.id}`)).body).toMatchObject({
      status: 'failed',
      error_code: 'dep_install_failed',
    });
    expect((await json(`/v1/builds/${dep.build_id}`)).body).toMatchObject({
      status: 'failed',
      failure_class: 'user_error',
    });
    expect(db.scenarioOf({ slug: 'first-fail' })).toBe('failing');
    const stages = (await json(`/v1/deployments/${dep.id}/stages`)).body;
    expect(stages.history.at(-1)).toMatchObject({ name: 'dependency_restore', status: 'failed' });

    // Recovery: a retry is a new deployment on the same lifecycle.
    vi.stubEnv('MOCK_BUILD_FAIL', '');
    const retry = await json(`/v1/deployments/${dep.id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ from_stage: 'dependency_restore' }),
    });
    expect(retry.status).toBe(200);
    expect(retry.body.id).not.toBe(dep.id);
    vi.setSystemTime(t0 + 30_000);
    expect((await json(`/v1/deployments/${retry.body.id}`)).body.status).toBe('live');
  });
});

describe('PATCH /v1/crons/{id}', () => {
  async function createCron(slug: string) {
    const app = await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug, type: 'app', runtime: 'node24' }),
    });
    expect(app.status).toBe(201);
    const cron = await json('/v1/crons', {
      method: 'POST',
      body: JSON.stringify({ app_id: app.body.id, schedule: '0 2 * * *', path: '/run' }),
    });
    expect(cron.status).toBe(201);
    return cron.body as { id: string; timezone: string; skip_if_running: boolean };
  }
  const patch = (id: string, body: unknown) =>
    json(`/v1/crons/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

  it('applies timezone, overlap skipping and the other editable fields', async () => {
    const cron = await createCron('cron-edit-a');
    const res = await patch(cron.id, {
      schedule: '30 6 * * *',
      path: '/nightly',
      timezone: 'Europe/Istanbul',
      skip_if_running: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      schedule: '30 6 * * *',
      path: '/nightly',
      timezone: 'Europe/Istanbul',
      skip_if_running: true,
    });
    const listed = (await json('/v1/crons')).body.find((c: { id: string }) => c.id === cron.id);
    expect(listed).toMatchObject({ timezone: 'Europe/Istanbul', skip_if_running: true });
  });

  it('stores a schedule_policy on create and replaces the whole object on PATCH', async () => {
    const cron = await createCron('cron-policy-a');
    const full = {
      version: 1,
      overlap: 'skip',
      missed_runs: 'coalesce_latest',
      start_deadline_seconds: 900,
    };
    const first = await patch(cron.id, { schedule_policy: full });
    expect(first.body.schedule_policy).toEqual(full);
    // Omitted fields are not preserved: the object is replaced, not merged.
    const second = await patch(cron.id, {
      schedule_policy: { version: 1, overlap: 'replace', missed_runs: 'skip' },
    });
    expect(second.body.schedule_policy).toEqual({
      version: 1,
      overlap: 'replace',
      missed_runs: 'skip',
    });
    // null is a no-op.
    const third = await patch(cron.id, { schedule_policy: null });
    expect(third.body.schedule_policy).toEqual(second.body.schedule_policy);
  });

  it('refuses an invalid schedule_policy with 400 and changes nothing', async () => {
    const cron = await createCron('cron-policy-b');
    const res = await patch(cron.id, {
      schedule: '30 6 * * *',
      schedule_policy: { version: 1, overlap: 'queue', missed_runs: 'skip' },
    });
    expect(res.status).toBe(400);
    const listed = (await json('/v1/crons')).body.find((c: { id: string }) => c.id === cron.id);
    expect(listed.schedule).toBe('0 2 * * *');
  });

  it('resets an empty timezone to UTC and leaves unsent fields alone', async () => {
    const cron = await createCron('cron-edit-b');
    await patch(cron.id, { timezone: 'Europe/Istanbul', skip_if_running: true });
    const res = await patch(cron.id, { timezone: '' });
    expect(res.body).toMatchObject({
      timezone: 'UTC',
      skip_if_running: true,
      schedule: '0 2 * * *',
      path: '/run',
    });
  });

  it('refuses a bad schedule or timezone with a stable code and changes nothing', async () => {
    const cron = await createCron('cron-edit-c');
    const badSchedule = await patch(cron.id, { schedule: 'nope' });
    expect(badSchedule.status).toBe(400);
    expect(badSchedule.body.code).toBe('invalid_schedule');
    const badZone = await patch(cron.id, { timezone: 'Mars/Olympus' });
    expect(badZone.status).toBe(400);
    expect(badZone.body.code).toBe('invalid_timezone');
    const listed = (await json('/v1/crons')).body.find((c: { id: string }) => c.id === cron.id);
    expect(listed).toMatchObject({ schedule: '0 2 * * *', timezone: 'UTC' });
  });
});

describe('POST /v1/postgres/bindings/{id}/rotate', () => {
  async function boundBinding(slug: string) {
    const app = await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug, type: 'app', runtime: 'node24' }),
    });
    const database = await json('/v1/postgres/databases', {
      method: 'POST',
      body: JSON.stringify({
        name: `${slug}-db`,
        region: 'fra',
        postgres_major: 17,
        service_class: 'development',
        availability: 'single_zone',
        scale_to_zero: true,
      }),
    });
    expect(database.status).toBe(201);
    vi.setSystemTime(Date.now() + 5000);
    const binding = await json(`/v1/postgres/databases/${database.body.id}/bindings`, {
      method: 'POST',
      body: JSON.stringify({
        app_id: app.body.id,
        scope: 'default',
        environment_key: 'DATABASE_URL',
        access: 'read_write',
      }),
    });
    expect(binding.status).toBe(201);
    return binding.body as { id: string; credential_generation: number; rotation_pending: boolean };
  }
  const rotate = (id: string, key: string) =>
    json(`/v1/postgres/bindings/${id}/rotate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
    });

  it('starts at generation 1 with no rotation pending', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const binding = await boundBinding('rotate-a');
    expect(binding).toMatchObject({ credential_generation: 1, rotation_pending: false });
  });

  it('answers 200 with the next generation pending, then settles', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const binding = await boundBinding('rotate-b');
    vi.setSystemTime(Date.now() + 5000);
    const res = await rotate(binding.id, 'k1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ credential_generation: 2, rotation_pending: true });
    vi.setSystemTime(Date.now() + 5000);
    const settled = await json(`/v1/postgres/bindings/${binding.id}`);
    expect(settled.body).toMatchObject({ credential_generation: 2, rotation_pending: false });
  });

  it('joins a rotation already in progress and replays a repeated key', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const binding = await boundBinding('rotate-c');
    vi.setSystemTime(Date.now() + 5000);
    await rotate(binding.id, 'k1');
    const joined = await rotate(binding.id, 'k2');
    expect(joined.body.credential_generation).toBe(2);
    const replay = await rotate(binding.id, 'k1');
    expect(replay.body.credential_generation).toBe(2);
  });

  it('refuses an unknown binding with the Postgres not-found code', async () => {
    const res = await rotate('nope', 'k1');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('managed_postgres_not_found');
  });
});

describe('outbound bindings through the mock', () => {
  const BASE = '/v1/outbound/integrations';
  const bindingsOf = (slug: string) => `/v1/apps/${slug}/outbound-bindings`;
  async function setup(slug: string, name: string) {
    const app = await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug, type: 'app', runtime: 'node24' }),
    });
    const integration = await json(BASE, {
      method: 'POST',
      body: JSON.stringify({
        name,
        origin: 'https://api.example.com',
        allowed_methods: ['GET', 'POST'],
        allowed_path_prefixes: ['/v1/'],
      }),
    });
    expect(app.status).toBe(201);
    expect(integration.status).toBe(201);
    return { app: app.body as { id: string }, integration: integration.body as { id: string } };
  }
  const put = (slug: string, id: string) => json(`${bindingsOf(slug)}/${id}`, { method: 'PUT' });
  const unbind = (slug: string, id: string) =>
    fetch(`${base}${bindingsOf(slug)}/${id}`, { method: 'DELETE' });

  it('starts empty, binds with the schema’s shape, and stores a repeat bind once', async () => {
    const { app, integration } = await setup('bind-a', 'bind-a-api');
    expect((await json(bindingsOf('bind-a'))).body).toEqual({ items: [] });

    const bound = await put('bind-a', integration.id);
    expect(bound.status).toBe(200);
    expect(bound.body).toMatchObject({
      app_id: app.id,
      integration: { id: integration.id, name: 'bind-a-api' },
      allowed_methods: ['GET', 'POST'],
      allowed_path_prefixes: ['/v1/'],
      daily_request_limit: null,
    });
    expect(typeof bound.body.created_at).toBe('string');

    expect((await put('bind-a', integration.id)).status).toBe(200);
    expect((await json(bindingsOf('bind-a'))).body.items).toHaveLength(1);
  });

  it('keeps bindings per app', async () => {
    const { integration } = await setup('bind-b', 'bind-b-api');
    await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug: 'bind-b-other', type: 'app', runtime: 'node24' }),
    });
    await put('bind-b', integration.id);
    expect((await json(bindingsOf('bind-b-other'))).body.items).toEqual([]);
  });

  it('unbinds, answering 204 again when it is already absent', async () => {
    const { integration } = await setup('bind-c', 'bind-c-api');
    await put('bind-c', integration.id);
    expect((await unbind('bind-c', integration.id)).status).toBe(204);
    expect((await unbind('bind-c', integration.id)).status).toBe(204);
    expect((await json(bindingsOf('bind-c'))).body.items).toEqual([]);
  });

  it('refuses an unknown integration or app with not_found', async () => {
    await setup('bind-d', 'bind-d-api');
    const missing = '00000000-0000-4000-8000-00000000dead';
    const noIntegration = await put('bind-d', missing);
    expect(noIntegration.status).toBe(404);
    expect(noIntegration.body.code).toBe('not_found');
    const noApp = await put('no-such-app-anywhere', missing);
    expect(noApp.status).toBe(404);
    expect(noApp.body.code).toBe('not_found');
    expect((await json(bindingsOf('no-such-app-anywhere'))).status).toBe(404);
  });

  it('drops an app’s binding when its integration is deleted', async () => {
    const { integration } = await setup('bind-e', 'bind-e-api');
    await put('bind-e', integration.id);
    const deleted = await fetch(`${base}${BASE}/${integration.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    expect((await json(bindingsOf('bind-e'))).body.items).toEqual([]);
  });
});

describe('PATCH /v1/jobs/{name}', () => {
  const patch = (name: string, body: unknown) =>
    json(`/v1/jobs/${name}`, { method: 'PATCH', body: JSON.stringify(body) });

  it('pauses and resumes a job, and a paused job refuses a run with 409', async () => {
    expect((await patch('reindex-search', { status: 'paused' })).body.status).toBe('paused');
    const refused = await json('/v1/jobs/reindex-search/runs', {
      method: 'POST',
      body: JSON.stringify({ tasks: 1 }),
    });
    expect(refused.status).toBe(409);
    expect((await patch('reindex-search', { status: 'active' })).body.status).toBe('active');
    expect((await json('/v1/jobs/reindex-search')).body.status).toBe('active');
  });

  it('refuses a status other than active or paused, and an unknown job', async () => {
    const bad = await patch('nightly-export', { status: 'deleted' });
    expect(bad.status).toBe(400);
    expect((await patch('no-such-job', { status: 'paused' })).status).toBe(404);
  });
});
