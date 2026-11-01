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
    expect(res.body.code).toBe('validation_failed');
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
  // A fresh job has no runs; the seeded ones all have a queued and a running run.
  const freshJob = async (name: string) => {
    const created = await json('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({
        name,
        kind: 'batch',
        image_ref: 'registry.gregale.dev/acme/x:v1',
        command: ['true'],
      }),
    });
    expect(created.status).toBe(201);
  };
  const start = (name: string) =>
    json(`/v1/jobs/${name}/runs`, { method: 'POST', body: JSON.stringify({ tasks: 1 }) });

  it('pauses and resumes a job, and a paused job refuses a run with 409', async () => {
    await freshJob('pause-a');
    expect((await patch('pause-a', { status: 'paused' })).body.status).toBe('paused');
    expect((await start('pause-a')).status).toBe(409);
    expect((await patch('pause-a', { status: 'active' })).body.status).toBe('active');
    expect((await json('/v1/jobs/pause-a')).body.status).toBe('active');
  });

  it('refuses with 409 validation_failed "Job has active runs" while tasks are queued, then allows it', async () => {
    await freshJob('pause-b');
    const run = await start('pause-b');
    expect(run.status).toBe(201);
    const refused = await patch('pause-b', { status: 'paused' });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: 'validation_failed',
      detail: 'Job has active runs',
    });
    expect((await json('/v1/jobs/pause-b')).body.status).toBe('active');
    const cancelled = await json(`/v1/jobs/pause-b/runs/${run.body.id}/cancel`, { method: 'POST' });
    expect(cancelled.status).toBeLessThan(300);
    expect((await patch('pause-b', { status: 'paused' })).status).toBe(200);
  });

  it('refuses a status other than active or paused, and an unknown job', async () => {
    const bad = await patch('nightly-export', { status: 'deleted' });
    expect(bad.status).toBe(400);
    expect((await patch('no-such-job', { status: 'paused' })).status).toBe(404);
  });
});

describe('POST /v1/jobs/{name}/runs above the plan cap', () => {
  const start = (tasks: number) =>
    json('/v1/jobs/nightly-export/runs', { method: 'POST', body: JSON.stringify({ tasks }) });

  it('refuses with 403 job_quota_exceeded carrying limit and observed, instead of clamping', async () => {
    vi.stubEnv('MOCK_PLAN', 'hobby');
    const refused = await start(101);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'job_quota_exceeded', limit: 100, observed: 101 });
    const runs = (await json('/v1/jobs/nightly-export/runs')).body.runs as { tasks: number }[];
    expect(runs.some((r) => r.tasks === 100 || r.tasks === 101)).toBe(false);
  });

  it('accepts exactly the cap and refuses fewer than one task with 400', async () => {
    vi.stubEnv('MOCK_PLAN', 'hobby');
    const ok = await start(100);
    expect(ok.status).toBe(201);
    expect(ok.body.tasks).toBe(100);
    expect((await start(0)).status).toBe(400);
  });
});

describe('custom domain verification retry and re-add', () => {
  const add = async (domain: string, slug: string) => {
    const app = await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug, type: 'app', runtime: 'node24' }),
    });
    const created = await json('/v1/domains', {
      method: 'POST',
      body: JSON.stringify({ domain, app_id: app.body.id }),
    });
    return { appId: app.body.id as string, created };
  };
  const retry = (domain: string) => fetch(`${base}/v1/domains/${domain}/retry`, { method: 'POST' });

  it('binds by app_id, as the spec says, and returns a TXT record', async () => {
    const { appId, created } = await add('retry-a.example.com', 'retry-app-a');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ domain: 'retry-a.example.com', app_id: appId });
    expect(created.body.txt_record).toContain('retry-a.example.com');
  });

  it('answers 202 with no body while the challenge is live, 404 for an unknown domain', async () => {
    await add('retry-b.example.com', 'retry-app-b');
    const ok = await retry('retry-b.example.com');
    expect(ok.status).toBe(202);
    expect(await ok.text()).toBe('');
    expect((await retry('nobody.example.com')).status).toBe(404);
  });

  it('answers 409 once the seven-day challenge has expired, and never extends it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now();
    await add('retry-c.example.com', 'retry-app-c');
    vi.setSystemTime(t0 + 6 * 86_400_000);
    expect((await retry('retry-c.example.com')).status).toBe(202);
    vi.setSystemTime(t0 + 8 * 86_400_000);
    expect((await retry('retry-c.example.com')).status).toBe(409);
  });

  it('re-adding an expired unverified domain re-arms it with a new token and window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now();
    const { appId, created } = await add('retry-d.example.com', 'retry-app-d');
    vi.setSystemTime(t0 + 8 * 86_400_000);
    const again = await json('/v1/domains', {
      method: 'POST',
      body: JSON.stringify({ domain: 'retry-d.example.com', app_id: appId }),
    });
    expect(again.status).toBe(201);
    expect(again.body.txt_record).not.toBe(created.body.txt_record);
    expect((await retry('retry-d.example.com')).status).toBe(202);
  });

  it('refuses to re-add a domain whose challenge is still live, or already verified, with 409', async () => {
    const { appId } = await add('retry-e.example.com', 'retry-app-e');
    const dup = await json('/v1/domains', {
      method: 'POST',
      body: JSON.stringify({ domain: 'retry-e.example.com', app_id: appId }),
    });
    expect(dup.status).toBe(409);
    // Verify flips the row on the second press.
    await json('/v1/domains/retry-e.example.com/verify', { method: 'POST' });
    await json('/v1/domains/retry-e.example.com/verify', { method: 'POST' });
    expect((await retry('retry-e.example.com')).status).toBe(409);
  });
});

describe('object storage buckets in the mock', () => {
  it('binds a bucket to its app under the default prefix, and counts the credential once', async () => {
    expect(
      (
        await json('/v1/apps', {
          method: 'POST',
          body: JSON.stringify({ slug: 'media-api', type: 'app', runtime: 'node24' }),
        })
      ).status
    ).toBe(201);
    const bucket = await json('/v1/apps/media-api/buckets', {
      method: 'POST',
      body: JSON.stringify({ name: 'user-uploads', scope: 'default', region: 'us-east-1' }),
    });
    expect(bucket.status).toBe(201);
    const id = bucket.body.id as string;

    const bound = await json(`/v1/apps/media-api/buckets/${id}/compute-bindings`, {
      method: 'POST',
      body: JSON.stringify({ permission: 'read_write' }),
    });
    expect(bound.status).toBe(201);
    expect(bound.body.prefix).toBe('GREGALE_S3_USER_UPLOADS');
    expect(bound.body.secret_keys.secret_access_key).toBe(
      'GREGALE_S3_USER_UPLOADS_SECRET_ACCESS_KEY'
    );

    const keys = await json(`/v1/apps/media-api/buckets/${id}/s3-credentials`);
    expect(keys.body.items.map((c: { id: string }) => c.id)).toContain(bound.body.credential.id);

    const revoked = await fetch(
      `${base}/v1/apps/media-api/buckets/${id}/compute-bindings/${bound.body.id}`,
      { method: 'DELETE' }
    );
    expect(revoked.status).toBe(204);
    expect((await json(`/v1/apps/media-api/buckets/${id}/compute-bindings`)).body.items).toEqual(
      []
    );
  });

  it('refuses to delete a bucket that still holds objects', async () => {
    await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug: 'full-bucket', type: 'app', runtime: 'node24' }),
    });
    const { body } = await json('/v1/apps/full-bucket/buckets', {
      method: 'POST',
      body: JSON.stringify({ name: 'docs' }),
    });
    const signed = await json(`/v1/apps/full-bucket/buckets/${body.id}/signed-url`, {
      method: 'POST',
      body: JSON.stringify({ method: 'PUT', key: 'a.txt', size_bytes: 3 }),
    });
    await fetch(signed.body.url, { method: 'PUT', body: 'abc' });
    const res = await fetch(`${base}/v1/apps/full-bucket/buckets/${body.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(409);
  });

  it('answers a signed upload on the dev origin, and only records what was sent', async () => {
    await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug: 'upload-app', type: 'app', runtime: 'node24' }),
    });
    const { body } = await json('/v1/apps/upload-app/buckets', {
      method: 'POST',
      body: JSON.stringify({ name: 'media' }),
    });
    const objects = async () =>
      (await json(`/v1/apps/upload-app/buckets/${body.id}/objects`)).body.items as {
        key: string;
        size_bytes: number;
      }[];
    const sign = async (method: string, key: string) =>
      (
        await json(`/v1/apps/upload-app/buckets/${body.id}/signed-url`, {
          method: 'POST',
          body: JSON.stringify({ method, key, size_bytes: 11, content_type: 'text/plain' }),
        })
      ).body.url as string;

    const put = await sign('PUT', 'notes/hello world.txt');
    // Same origin as the console, so the browser can PUT without CORS.
    expect(new URL(put).origin).toBe(base);
    // Signing is a promise to accept bytes, not an upload.
    expect(await objects()).toEqual([]);

    const sent = await fetch(put, { method: 'PUT', body: 'hello there' });
    expect(sent.status).toBe(200);
    expect(await objects()).toMatchObject([{ key: 'notes/hello world.txt', size_bytes: 11 }]);

    const got = await fetch(await sign('GET', 'notes/hello world.txt'));
    expect(got.status).toBe(200);
    expect(await got.text()).toBe('hello there');

    // A URL signed for reading does not take writes, and a forged one takes nothing.
    const read = await sign('GET', 'other.txt');
    expect((await fetch(read, { method: 'PUT', body: 'x' })).status).toBe(403);
    const forged = new URL(put);
    forged.searchParams.set('X-Amz-Signature', 'forged');
    expect((await fetch(forged, { method: 'PUT', body: 'x' })).status).toBe(403);
    expect((await objects()).map((o) => o.key)).toEqual(['notes/hello world.txt']);
  });
});

describe('app release settings through PATCH /v1/apps/{slug}', () => {
  const patch = (slug: string, body: unknown) =>
    json(`/v1/apps/${slug}`, { method: 'PATCH', body: JSON.stringify(body) });

  it('stores the release policy, probe paths and function concurrency it accepts', async () => {
    expect(
      (
        await json('/v1/apps', {
          method: 'POST',
          body: JSON.stringify({ slug: 'rel-fn', type: 'function', runtime: 'node24' }),
        })
      ).status
    ).toBe(201);
    expect((await json('/v1/apps/rel-fn')).body.release_policy).toBe('safe');
    const saved = await patch('rel-fn', {
      release_policy: 'fast',
      release_probe_paths: ['/healthz', '/api/orders'],
      function_concurrency: 4,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      release_policy: 'fast',
      release_probe_paths: ['/healthz', '/api/orders'],
      function_concurrency: 4,
    });
    // An empty list restores "/", and 0 restores one request per worker.
    const reset = await patch('rel-fn', { release_probe_paths: [], function_concurrency: 0 });
    expect(reset.body.release_probe_paths).toBeUndefined();
    expect(reset.body.function_concurrency).toBeUndefined();
  });

  it('answers validation_failed for values apid refuses', async () => {
    await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug: 'rel-bad', type: 'function', runtime: 'python313' }),
    });
    for (const body of [
      { release_policy: 'slow' },
      { release_probe_paths: ['/a', '/b', '/c', '/d'] },
      { release_probe_paths: ['/users/{id}'] },
      { release_probe_paths: ['/a', '/a'] },
      { function_concurrency: 999 },
    ]) {
      const res = await patch('rel-bad', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    }
  });

  it('refuses safe and probe paths while progressive rollouts are not released', async () => {
    vi.stubEnv('MOCK_UNAVAILABLE_CAPABILITIES', 'progressive-rollouts');
    await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug: 'rel-off', type: 'app', runtime: 'node24' }),
    });
    expect((await patch('rel-off', { release_policy: 'immediate' })).status).toBe(200);
    const safe = await patch('rel-off', { release_policy: 'safe' });
    expect(safe.status).toBe(403);
    expect(safe.body.code).toBe('capability_not_released');
    const probes = await patch('rel-off', { release_probe_paths: ['/healthz'] });
    expect(probes.body.code).toBe('capability_not_released');
  });
});

describe('GET /v1/auth/csrf', () => {
  it('issues a bind_app_to_repo token, which the spec allows and install/bind needs', async () => {
    const res = await json('/v1/auth/csrf?action=bind_app_to_repo');
    expect(res.status).toBe(200);
    expect(res.body.csrf_token).toEqual(expect.any(String));
  });
});

describe('POST /v1/apps/{slug}/rollback', () => {
  // The seeded fixture is off under MOCK_EMPTY=1; seed the rows apid would
  // have after two deploys: the older one superseded, the newer one live.
  function seed(slug: string) {
    const a = db.apps.find((x) => x.slug === slug) ?? db.apps[0];
    const base = db.deployments.find((d) => d.app_id === a.id);
    const row = (id: string, status: string, traffic: number, ageMin: number) =>
      ({
        ...(base ?? {}),
        id,
        app_id: a.id,
        status,
        traffic_percent: traffic,
        scope: 'prod',
        created_at: new Date(Date.now() - ageMin * 60_000).toISOString(),
      }) as (typeof db.deployments)[number];
    const live = row('d'.repeat(32), 'live', 100, 5);
    const older = row('e'.repeat(32), 'superseded', 0, 60);
    const oldest = row('f'.repeat(32), 'superseded', 0, 120);
    db.deployments.unshift(live, older, oldest);
    return { live, older, oldest };
  }

  async function app(slug: string) {
    const created = await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug, type: 'app', runtime: 'node24' }),
    });
    expect(created.status).toBe(201);
    return seed(slug);
  }

  it('rolls back to the newest superseded deployment, as apid does', async () => {
    const { live, older } = await app('roll-default');
    const res = await json('/v1/apps/roll-default/rollback', { method: 'POST' });
    // apid accepts the intent (202) and reports a rollback_operation; the
    // target serves only once its readiness check passes.
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      id: older.id,
      rollback_operation: {
        target_deployment_id: older.id,
        current_deployment_id: live.id,
        status: 'preparing',
      },
    });
    expect(live).toMatchObject({ status: 'live', traffic_percent: 100 });
    const operation = (res.body.rollback_operation as { id: string }).id;

    // Past the mock's readiness and routing windows, the operation completes
    // and the target serves in place of the release it replaced.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
    const done = await json(`/v1/apps/roll-default/rollbacks/${operation}`).finally(() =>
      clock.mockRestore()
    );
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ id: operation, status: 'complete' });
    expect(older).toMatchObject({ status: 'live', traffic_percent: 100 });
    expect(live).toMatchObject({ status: 'superseded', traffic_percent: 0 });
  });

  it('rolls back to an explicit superseded target', async () => {
    const { oldest } = await app('roll-explicit');
    const res = await json('/v1/apps/roll-explicit/rollback', {
      method: 'POST',
      body: JSON.stringify({ target_deployment_id: oldest.id }),
    });
    expect(res.status).toBe(202);
    expect(res.body.id).toBe(oldest.id);
  });

  it('refuses the live deployment as a target', async () => {
    const { live } = await app('roll-live');
    const res = await json('/v1/apps/roll-live/rollback', {
      method: 'POST',
      body: JSON.stringify({ target_deployment_id: live.id }),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('rollback_target_already_live');
  });

  it('answers no_rollback_target when nothing was superseded', async () => {
    const created = await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug: 'roll-none', type: 'app', runtime: 'node24' }),
    });
    expect(created.status).toBe(201);
    const res = await json('/v1/apps/roll-none/rollback', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('no_rollback_target');
  });
});

describe('edge rules answer with the action wrapped by kind, as apid does', () => {
  // apid marshals state.EdgeRuleAction: {"kind":"cors","cors":{…}}
  // (faas pkg/apid/edgerules/rules.go:46-47, pkg/state/types.go:8638-8648).
  it('takes a flat create body and answers wrapped, and clears a deleted preset from it', async () => {
    await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug: 'edge-wire', type: 'function', runtime: 'node24' }),
    });
    const preset = await json('/v1/cors-presets', {
      method: 'POST',
      body: JSON.stringify({
        name: 'wire',
        allow_origins: ['https://a.example'],
        allow_methods: ['GET'],
        max_age_seconds: 60,
      }),
    });
    const created = await json('/v1/apps/edge-wire/edge-rules', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'cors',
        match_host: 'edge-wire.example',
        match_path: '/*',
        priority: 10,
        action: { cors_preset_id: preset.body.id, allow_origins: [], allow_methods: [] },
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body.action).toEqual({
      kind: 'cors',
      cors: { cors_preset_id: preset.body.id, allow_origins: [], allow_methods: [] },
    });
    const listed = await json('/v1/edge-rules');
    const rule = (listed.body as { id: string; action: unknown }[]).find(
      (r) => r.id === created.body.id
    );
    expect(rule?.action).toMatchObject({ kind: 'cors', cors: { cors_preset_id: preset.body.id } });
    await fetch(`${base}/v1/cors-presets/${preset.body.id}`, { method: 'DELETE' });
    const after = (await json('/v1/apps/edge-wire/edge-rules')).body as { action: unknown }[];
    expect(after[0].action).toMatchObject({ kind: 'cors', cors: { cors_preset_id: null } });
  });
});

describe('log drains', () => {
  const intake = 'https://http-intake.logs.datadoghq.eu/api/v2/logs';
  async function app(slug: string) {
    const created = await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug, type: 'app', runtime: 'node24' }),
    });
    expect(created.status).toBe(201);
  }
  const post = (slug: string, body: object) =>
    json(`/v1/apps/${slug}/log-drains`, { method: 'POST', body: JSON.stringify(body) });

  it('takes a datadog drain only at a Datadog intake with a DD-API-KEY, as apid does', async () => {
    await app('drain-dd');
    const elsewhere = await post('drain-dd', {
      kind: 'datadog',
      target_url: 'https://logs.example.com',
      auth_header: 'DD-API-KEY: k',
    });
    expect(elsewhere).toMatchObject({ status: 400, body: { code: 'app_log_drain_invalid' } });
    const keyless = await post('drain-dd', { kind: 'datadog', target_url: intake });
    expect(keyless).toMatchObject({ status: 400, body: { code: 'app_log_drain_invalid' } });
    const ok = await post('drain-dd', {
      kind: 'datadog',
      target_url: intake,
      auth_header: 'DD-API-KEY: k',
    });
    expect(ok).toMatchObject({ status: 201, body: { kind: 'datadog', auth_header_masked: '***' } });
    expect(JSON.stringify(ok.body)).not.toContain('DD-API-KEY');
  });

  it('switches a drain to datadog only with a key', async () => {
    await app('drain-switch');
    const { body: drain } = await post('drain-switch', {
      kind: 'http_json',
      target_url: 'https://logs.example.com/ingest',
    });
    const path = `/v1/apps/drain-switch/log-drains/${drain.id}`;
    const keyless = await json(path, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'datadog', target_url: intake }),
    });
    expect(keyless).toMatchObject({ status: 400, body: { code: 'app_log_drain_invalid' } });
    const ok = await json(path, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'datadog', target_url: intake, auth_header: 'DD-API-KEY: k' }),
    });
    expect(ok).toMatchObject({ status: 200, body: { kind: 'datadog', target_url: intake } });
  });

  it('refuses a drain past the plan cap per app with plan_log_drain_quota', async () => {
    await app('drain-quota');
    for (let i = 0; i < 10; i++)
      expect(
        (await post('drain-quota', { kind: 'otlp', target_url: `https://o${i}.example.com` }))
          .status
      ).toBe(201);
    const over = await post('drain-quota', { kind: 'otlp', target_url: 'https://o10.example.com' });
    expect(over).toMatchObject({ status: 403, body: { code: 'plan_log_drain_quota' } });
  });
});

describe('/v1/apps/{slug}/deployment-aliases', () => {
  async function app(slug: string) {
    const created = await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug, type: 'app', runtime: 'node24' }),
    });
    expect(created.status).toBe(201);
    const a = db.apps.find((x) => x.slug === slug)!;
    const row = (id: string, status: string, ageMin: number, revision: number) =>
      ({
        id,
        app_id: a.id,
        image_digest: 'sha256:aa',
        kind: 'github',
        status,
        revision,
        created_at: new Date(Date.now() - ageMin * 60_000).toISOString(),
      }) as (typeof db.deployments)[number];
    const live = row(`${slug}-live`, 'live', 5, 2);
    const old = row(`${slug}-old`, 'superseded', 60, 1);
    db.deployments.unshift(live, old);
    return { a, live, old };
  }
  const put = (slug: string, name: string, deployment_id: string) =>
    json(`/v1/apps/${slug}/deployment-aliases/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ deployment_id }),
    });

  it('points, lists and removes an alias on its stable host', async () => {
    const { a, live } = await app('alias-crud');
    expect((await json('/v1/apps/alias-crud/deployment-aliases')).body).toEqual({ items: [] });
    const set = await put('alias-crud', 'canary', live.id);
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({
      name: 'canary',
      deployment_id: live.id,
      revision: 2,
      host: `tag-canary-${a.id}.gregale.app`,
      url: `https://tag-canary-${a.id}.gregale.app`,
    });
    const listed = await json('/v1/apps/alias-crud/deployment-aliases');
    expect(listed.body.items).toEqual([
      expect.objectContaining({ name: 'canary', deployment_status: 'live' }),
    ]);
    const res = await fetch(`${base}/v1/apps/alias-crud/deployment-aliases/canary`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    const again = await fetch(`${base}/v1/apps/alias-crud/deployment-aliases/canary`, {
      method: 'DELETE',
    });
    expect(again.status).toBe(404);
  });

  it('refuses a superseded target with apid’s reason', async () => {
    const { old } = await app('alias-old');
    const res = await put('alias-old', 'canary', old.id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(res.body.detail).toMatch(/v1 is superseded/);
  });

  it('refuses a name that does not fit the host label', async () => {
    const { live } = await app('alias-long');
    const res = await put('alias-long', 'a'.repeat(27), live.id);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect((await put('alias-long', 'a'.repeat(26), live.id)).status).toBe(200);
  });
});

describe('/v1/account/release-webhooks', () => {
  const ROOT = '/v1/account/release-webhooks';
  const post = (body: object) => json(ROOT, { method: 'POST', body: JSON.stringify(body) });
  const valid = {
    target_url: 'https://releases.example.com/hook',
    webhook_secret: 's3cret',
    event_filter: ['deployment.live', 'rollout.aborted'],
  };

  it('creates, lists, edits, rotates and deletes a receiver without echoing the secret', async () => {
    const created = await post(valid);
    expect(created).toMatchObject({
      status: 201,
      body: {
        scope: 'account',
        target_url: valid.target_url,
        webhook_secret_sealed_masked: '***',
        retry_policy: 'default',
        delivery_format: 'json',
        enabled: true,
      },
    });
    expect(JSON.stringify(created.body)).not.toContain('s3cret');
    const id = created.body.id as string;
    expect((await json(ROOT)).body.map((w: { id: string }) => w.id)).toContain(id);

    const patched = await json(`${ROOT}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false, delivery_format: 'cloudevents' }),
    });
    expect(patched).toMatchObject({
      status: 200,
      body: { enabled: false, delivery_format: 'cloudevents' },
    });

    const rotated = await json(`${ROOT}/${id}/rotate-secret`, {
      method: 'POST',
      body: JSON.stringify({ webhook_secret: 'next' }),
    });
    expect(rotated).toMatchObject({ status: 200, body: { webhook_secret_sealed_masked: '***' } });

    const removed = await fetch(`${base}${ROOT}/${id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(204);
    expect((await json(`${ROOT}/${id}`)).body.code).toBe('not_found');
  });

  it('refuses an empty filter, a non-release event and a duplicate target as app_webhook_invalid', async () => {
    expect(await post({ ...valid, event_filter: [] })).toMatchObject({
      status: 400,
      body: { code: 'app_webhook_invalid' },
    });
    expect(await post({ ...valid, event_filter: ['cron.fired'] })).toMatchObject({
      status: 400,
      body: { code: 'app_webhook_invalid' },
    });
    const target = { ...valid, target_url: 'https://dupe.example.com/hook' };
    expect((await post(target)).status).toBe(201);
    expect(await post(target)).toMatchObject({
      status: 400,
      body: { code: 'app_webhook_invalid' },
    });
  });

  it('answers 402 plan_webhooks_not_allowed on Free', async () => {
    vi.stubEnv('MOCK_PLAN', 'free');
    expect(await json(ROOT)).toMatchObject({
      status: 402,
      body: { code: 'plan_webhooks_not_allowed' },
    });
  });

  it('shares the per-account quota with app webhooks', async () => {
    vi.stubEnv('MOCK_PLAN', 'hobby');
    const listed = (await json(ROOT)).body as unknown[];
    const room = 10 - listed.length;
    for (let i = 0; i < room; i++)
      expect((await post({ ...valid, target_url: `https://q${i}.example.com/hook` })).status).toBe(
        201
      );
    expect(await post({ ...valid, target_url: 'https://over.example.com/hook' })).toMatchObject({
      status: 403,
      body: { code: 'plan_webhook_quota' },
    });
  });

  it('reads health and attempts, and re-sends only a dead delivery', async () => {
    const { body: hook } = await post({
      ...valid,
      target_url: 'https://deliveries.example.com/hook',
    });
    const mock = await import('./release-webhooks');
    const [dead, done] = mock.seedDeliveries(hook.id, [
      { status: 'dead', attempt: 7 },
      { status: 'succeeded', attempt: 1 },
    ]);
    const page = await json(`${ROOT}/${hook.id}/deliveries`);
    expect(page.body.deliveries.map((d: { id: string }) => d.id)).toEqual([dead.id, done.id]);

    const health = await json(`${ROOT}/${hook.id}/health`);
    expect(health).toMatchObject({
      status: 200,
      body: { webhook_id: hook.id, dead_count: 1, receiver_state: 'ready' },
    });

    const attempts = await json(`${ROOT}/${hook.id}/deliveries/${dead.id}/attempts`);
    expect(attempts.body.attempts).toHaveLength(7);
    expect(attempts.body.attempts[0]).toMatchObject({ attempt_number: 7, outcome: 'dead' });

    const refused = await json(`${ROOT}/${hook.id}/deliveries/${done.id}/retry`, {
      method: 'POST',
    });
    expect(refused).toMatchObject({ status: 400, body: { code: 'app_webhook_invalid' } });
    const resent = await json(`${ROOT}/${hook.id}/deliveries/${dead.id}/retry`, {
      method: 'POST',
    });
    expect(resent).toMatchObject({ status: 200, body: { delivery: { status: 'pending' } } });
  });
});

describe('/v1/apps/{slug}/webhooks/{id} health and attempts', () => {
  it('reads one webhook health and a delivery attempt history', async () => {
    await json('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ slug: 'hook-health', type: 'app', runtime: 'node24' }),
    });
    const { body: hook } = await json('/v1/apps/hook-health/webhooks', {
      method: 'POST',
      body: JSON.stringify({ target_url: 'https://ops.example.com/h', webhook_secret: 'x' }),
    });
    const mock = await import('./release-webhooks');
    const [failing] = mock.seedDeliveries(hook.id, [{ status: 'pending', attempt: 3 }]);
    const health = await json(`/v1/apps/hook-health/webhooks/${hook.id}/health`);
    expect(health).toMatchObject({ status: 200, body: { webhook_id: hook.id, pending_count: 1 } });
    const attempts = await json(
      `/v1/apps/hook-health/webhooks/${hook.id}/deliveries/${failing.id}/attempts`
    );
    expect(attempts.body.attempts.map((a: { outcome: string }) => a.outcome)).toEqual([
      'retrying',
      'retrying',
      'retrying',
    ]);
    const refused = await json(
      `/v1/apps/hook-health/webhooks/${hook.id}/deliveries/${failing.id}/retry`,
      { method: 'POST' }
    );
    expect(refused).toMatchObject({ status: 400, body: { code: 'app_webhook_invalid' } });
  });
});
