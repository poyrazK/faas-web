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
