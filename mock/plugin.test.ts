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
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ id: older.id, status: 'live', traffic_percent: 100 });
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
