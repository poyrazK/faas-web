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
it('serves worker consumer state and reviewed default push replacement without stage selectors', async () => {
  const slug = 'search-indexer';
  const list = await get(`/v1/apps/${slug}/queue-bindings`);
  expect(list.response.status).toBe(200);
  expect(list.body).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'default', mode: 'push' })])
  );
  const defaultBinding = list.body.find((row: { name: string }) => row.name === 'default');
  const status = await get(`/v1/apps/${slug}/queue-bindings/${defaultBinding.id}/status`);
  expect(status.body).toMatchObject({ consumer_state: 'active', consumer_liveness: 'stale' });
  const conflict = await fetch(`${origin}/v1/apps/${slug}/queue-workload`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queue_name: 'replacement',
      workload_class: 'worker',
      max_concurrency: 2,
      target_depth: 10,
      force: false,
    }),
  });
  expect(conflict.status).toBe(409);
  const replace = await fetch(`${origin}/v1/apps/${slug}/queue-workload`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queue_name: 'replacement',
      workload_class: 'worker',
      max_concurrency: 2,
      target_depth: 10,
      force: true,
    }),
  });
  expect(replace.status).toBe(200);
  expect(await replace.json()).toMatchObject({
    binding: { name: 'default', queue_name: 'replacement', mode: 'push' },
  });
  process.env.MOCK_PLAN = 'free';
  const denied = await fetch(`${origin}/v1/apps/${slug}/queue-bindings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'denied',
      queue_name: 'denied',
      mode: 'pull',
      workload_class: 'worker',
      enabled: true,
      max_concurrency: 1,
    }),
  });
  expect(denied.status).toBe(403);
});
it('serves internal app visibility and binding policy with distinct null and empty meanings', async () => {
  const slug = `private-${Date.now()}`;
  const target = (await get('/v1/apps')).body[0].slug;
  const create = await fetch(`${origin}/v1/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, type: 'app', visibility: 'internal', ram_mb: 128 }),
  });
  expect(create.status).toBe(201);
  expect(await create.json()).toMatchObject({ visibility: 'internal', url: '' });
  const empty = await get(`/v1/apps/${slug}/bindings`);
  expect(empty.response.status).toBe(200);
  expect(empty.body).toMatchObject({ app: slug, complete: true, bindings: [] });
  const policy = await fetch(`${origin}/v1/apps/${slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      allowed_service_callers: [],
      allowed_service_call_scopes: {},
      service_binding_targets: [target],
      service_binding_policy: 'declared',
    }),
  });
  expect(policy.status).toBe(200);
  expect(await policy.json()).toMatchObject({
    allowed_service_callers: [],
    allowed_service_call_scopes: {},
    service_binding_policy: 'declared',
  });
  const inventory = await get(`/v1/apps/${slug}/bindings`);
  expect(inventory.body.bindings).toEqual([
    expect.objectContaining({ type: 'service', name: target, verification_status: 'unknown' }),
  ]);
  const inherit = await fetch(`${origin}/v1/apps/${slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_service_callers: null, allowed_service_call_scopes: null }),
  });
  const inherited = await inherit.json();
  expect(inherited).not.toHaveProperty('allowed_service_callers');
  expect(inherited).not.toHaveProperty('allowed_service_call_scopes');
  const sourceManaged = await fetch(`${origin}/v1/apps/${target}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_service_callers: [] }),
  });
  expect(sourceManaged.status).toBe(409);
});
it('serves bounded instrumented Issues and one-time deployment-bound reporting credentials', async () => {
  const apps = await get('/v1/apps');
  const slug = apps.body[0].slug;
  const deployments = await get(`/v1/apps/${slug}/deployments`);
  const deploymentId = deployments.body.items[0].id;
  const list = await get(`/v1/apps/${slug}/issues?state=open&sort=impact&min_customers=1`);
  expect(list.response.status).toBe(200);
  expect(list.body.items[0]).toMatchObject({ state: 'open', impact_24h: expect.any(Object) });
  const id = list.body.items[0].id;
  const detail = await get(`/v1/apps/${slug}/issues/${id}`);
  expect(detail.body).toMatchObject({ issue: { id }, impact: expect.any(Object) });
  expect(detail.body.next_event_cursor).toBeTruthy();
  const older = await get(
    `/v1/apps/${slug}/issues/${id}?event_cursor=${encodeURIComponent(detail.body.next_event_cursor)}`
  );
  expect(older.body.events[0].id).not.toBe(detail.body.events[0].id);
  const created = await fetch(`${origin}/v1/apps/${slug}/issue-ingest-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deployment_id: deploymentId,
      environment: 'application',
      name: `test-${Date.now()}`,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
  expect(created.status).toBe(201);
  const credential = await created.json();
  expect(credential.token).toMatch(/^g_issue_/);
  const metadata = await get(`/v1/apps/${slug}/issue-ingest-tokens`);
  expect(
    metadata.body.items.find((item: { id: string }) => item.id === credential.id)
  ).not.toHaveProperty('token');
  const invalid = await fetch(`${origin}/v1/apps/${slug}/issue-ingest-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deployment_id: 'wrong-deployment',
      environment: 'application',
      name: 'invalid',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
  expect(invalid.status).toBe(422);
});
it('separates one-time Stripe URL from metadata and looks up only a known receipt', async () => {
  const apps = await get('/v1/apps');
  const slug = apps.body[0].slug;
  const name = `stripe-${Date.now()}`;
  const createdResponse = await fetch(`${origin}/v1/apps/${slug}/inbound-webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, provider: 'stripe', signing_secret: 'whsec_private' }),
  });
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json();
  expect(created.endpoint_url).toMatch(/^https:\/\//);
  const list = await get(`/v1/apps/${slug}/inbound-webhooks`);
  expect(list.body.find((item: { id: string }) => item.id === created.id)).not.toHaveProperty(
    'endpoint_url'
  );
  const metadata = await get(`/v1/apps/${slug}/inbound-webhooks/${created.id}`);
  expect(metadata.body).not.toHaveProperty('endpoint_url');
  const duplicate = await fetch(`${origin}/v1/apps/${slug}/inbound-webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, provider: 'stripe', signing_secret: 'whsec_private' }),
  });
  expect(duplicate.status).toBe(409);
  const binding = await fetch(
    `${origin}/v1/apps/${slug}/inbound-webhooks/${created.id}/automation-binding`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `bind-${name}` },
      body: JSON.stringify({
        expected_version: 0,
        workflow_name: 'process-request',
        event_type: '*',
        take_over_delivery: true,
      }),
    }
  );
  expect(binding.status).toBe(200);
  expect(
    (await get(`/v1/apps/${slug}/inbound-webhooks/${created.id}/automation-receipts/evt_unknown`))
      .response.status
  ).toBe(404);
  const known = await get(
    `/v1/apps/${slug}/inbound-webhooks/${created.id}/automation-receipts/evt_mock_pending`
  );
  expect(known.body).toMatchObject({
    provider_event_id: 'evt_mock_pending',
    routing_status: 'pending',
  });
});
it('separates purge acceptance from the cache revision applying in the mock runtime', async () => {
  const apps = await get('/v1/apps');
  const slug = apps.body[0].slug;
  const before = await get(`/v1/apps/${slug}/policy/status`);
  expect(before.response.status).toBe(200);
  const accepted = await fetch(`${origin}/v1/apps/${slug}/cache`, { method: 'DELETE' });
  expect(accepted.status).toBe(204);
  const pending = await get(`/v1/apps/${slug}/policy/status`);
  expect(pending.body.response_cache.desired_revision).toBeGreaterThan(
    before.body.response_cache.desired_revision
  );
  expect(pending.body.response_cache.state).toBe('pending');
  expect((await get(`/v1/apps/${slug}/policy/status`)).body.response_cache.state).toBe('active');
});
it('keeps mock cache purges exclusive and validates cache tags', async () => {
  const apps = await get('/v1/apps');
  const slug = apps.body[0].slug;
  const send = (query: string) =>
    fetch(`${origin}/v1/apps/${slug}/cache${query}`, { method: 'DELETE' });
  expect((await send('?tag=Product%3A42')).status).toBe(204);
  expect((await send('?path=%2Fproducts%2F*&tag=Product%3A42')).status).toBe(422);
  expect((await send('?tag=bad%20tag')).status).toBe(422);
});
it('serves durable project inventory/detail and hides unknown project identities', async () => {
  const inventory = await get('/v1/projects');
  expect(inventory.response.status).toBe(200);
  expect(inventory.body).toHaveLength(2);
  const detail = await get(`/v1/projects/${inventory.body[0].slug}`);
  expect(detail.body.id).toBe(inventory.body[0].id);
  expect(detail.body.workloads.length).toBe(inventory.body[0].workload_count);
  expect((await get('/v1/projects/not-owned')).response.status).toBe(404);
});
it('serves only registered environment reads and current-head preview evidence', async () => {
  const envs = await get('/v1/projects/acme-shop/environments');
  expect(envs.response.status).toBe(200);
  expect(envs.body.map((env: { slug: string }) => env.slug)).toEqual(['production', 'staging']);
  const state = await get('/v1/projects/acme-shop/environments/staging/state');
  expect(state.body.environment).toBe('staging');
  expect(state.body.active_release_set).toBeNull();
  const diff = await get('/v1/projects/acme-shop/environments/staging/diff?from=production');
  expect(diff.body.from_environment).toBe('production');
  expect(diff.body.to_environment).toBe('staging');
  expect((await get('/v1/projects/acme-shop/environments/default/state')).response.status).toBe(
    404
  );
  const apps = await get('/v1/apps');
  const preview = apps.body.find(
    (app: { preview_pr_number?: number }) => app.preview_pr_number === 42
  );
  expect(preview).toBeDefined();
  const set = await get(`/v1/preview/${preview.slug}/environment`);
  expect(set.body.root_slug).toBe(preview.slug);
  expect(set.body.pr_number).toBe(42);
  expect(set.body.members[0].links.url).toBe(preview.url);
});
it('replays app creation and accepts a digest-pinned image without a build ID', async () => {
  const slug = `image-${Date.now()}`;
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `create-${slug}` },
    body: JSON.stringify({ slug, type: 'app', ram_mb: 128 }),
  };
  const first = await fetch(`${origin}/v1/apps`, options);
  const created = await first.json();
  const replay = await fetch(`${origin}/v1/apps`, options);
  expect(replay.status).toBe(201);
  expect((await replay.json()).id).toBe(created.id);
  const accepted = await fetch(`${origin}/v1/apps/${slug}/deployments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `deploy-${slug}` },
    body: JSON.stringify({ image: `ghcr.io/team/api@sha256:${'a'.repeat(64)}` }),
  });
  expect(accepted.status).toBe(202);
  expect(await accepted.json()).toMatchObject({
    app_id: created.id,
    kind: 'image',
    status: 'imaging',
    build_id: null,
  });
});

it('admits a reviewed internal OCI worker on Hobby without HTTP settings', async () => {
  const slug = `worker-${Date.now()}`;
  process.env.MOCK_PLAN = 'free';
  const payload = {
    slug,
    type: 'app',
    ram_mb: 256,
    visibility: 'internal',
    execution_mode: 'worker',
    restart_policy: 'always',
    startup_deadline_s: 30,
    max_retries: 5,
  };
  const create = () =>
    fetch(`${origin}/v1/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `create-${slug}` },
      body: JSON.stringify(payload),
    });
  try {
    expect((await create()).status).toBe(403);
    process.env.MOCK_PLAN = 'hobby';
    const accepted = await create();
    expect(accepted.status).toBe(201);
    const worker = await accepted.json();
    expect(worker).toMatchObject({
      slug,
      visibility: 'internal',
      manifest: { execution_mode: 'worker', restart_policy: 'always' },
    });
    expect(worker.manifest.port).toBeUndefined();
    expect(worker.url).toBe('');
  } finally {
    delete process.env.MOCK_PLAN;
  }
});

it('reports registry plan denial separately from installation availability', async () => {
  process.env.MOCK_PLAN = 'free';
  const free = await get('/v1/capabilities');
  expect(free.response.status).toBe(200);
  expect(free.body.capabilities).toContainEqual(
    expect.objectContaining({
      key: 'object-storage',
      enabled: false,
      unavailable_reason: 'plan_not_entitled',
    })
  );
  process.env.MOCK_PLAN = 'scale';
  process.env.MOCK_UNAVAILABLE_CAPABILITIES = 'object-storage';
  try {
    const scale = await get('/v1/capabilities');
    expect(scale.body.capabilities).toContainEqual(
      expect.objectContaining({
        key: 'object-storage',
        enabled: false,
        unavailable_reason: 'runtime_unavailable',
      })
    );
    expect(scale.body.capabilities).toContainEqual(
      expect.objectContaining({ key: 'container-deployments', enabled: true, maturity: 'beta' })
    );
    expect(
      scale.body.capabilities.some((item: { maturity: string }) => item.maturity === 'internal')
    ).toBe(false);
  } finally {
    delete process.env.MOCK_UNAVAILABLE_CAPABILITIES;
  }
});

it('issues GitHub connect proof with the dedicated cookie', async () => {
  const { response, body } = await get('/v1/auth/csrf?action=connect_github');
  expect(response.status).toBe(200);
  expect(body).toEqual({ csrf_token: 'mock-csrf' });
  expect(response.headers.get('set-cookie')).toContain('faas_csrf_github_connect=mock-csrf');
  expect(response.headers.get('set-cookie')).not.toContain('faas_csrf=');
});

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
      wake_queue_p95_ms: null,
      wake_queue_sample_status: 'unavailable',
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
      wake_queue_p95_ms: null,
      wake_queue_sample_status: 'unavailable',
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
      // The fixture has no deployment. Restored metadata alone is not execution evidence.
      expect(await restored.json()).toMatchObject({ id: original.id, slug, status: 'undeployed' });
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
  it('revokes invitations by row ID, not by token, and never returns the token in lists', async () => {
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
      // Revocation is keyed by the stable row ID; the one-time token is not an ID.
      const invalid = await fetch(`${base}/v1/orgs/${org.slug}/invitations/${invitation.token}`, {
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
      const revoked = await fetch(`${base}/v1/orgs/${org.slug}/invitations/${invitation.id}`, {
        method: 'DELETE',
      });
      expect(revoked.status).toBe(204);
      expect(
        (
          await fetch(`${base}/v1/orgs/${org.slug}/invitations/${invitation.id}`, {
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

describe('logout CSRF contract', () => {
  it('refuses a logout without the auth.logout token, like apid', async () => {
    const response = await fetch(`${origin}/v1/auth/logout`, { method: 'POST' });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('csrf_mismatch');
  });

  it('ends the session when the minted token is posted back', async () => {
    const { body } = await get('/v1/auth/csrf?action=auth.logout');
    const response = await fetch(`${origin}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrf_token: body.csrf_token }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('faas_sid=;');
  });
});

describe('automation deletion mock contract', () => {
  const remove = (slug: string, name: string, query: string) =>
    fetch(`${origin}/v1/apps/${slug}/automations/${name}?${query}`, { method: 'DELETE' });

  it('deletes a draft at the observed revision and refuses a stale one', async () => {
    const [app] = (await get('/v1/apps')).body as Array<{ slug: string }>;
    const stale = await remove(app.slug, 'daily-summary', 'expected_version=99');
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('automation_version_conflict');
    expect((await remove(app.slug, 'daily-summary', 'expected_version=1')).status).toBe(204);
    const { body } = await get(`/v1/apps/${app.slug}/automations`);
    expect(body.automations.map((row: { name: string }) => row.name)).not.toContain(
      'daily-summary'
    );
  });

  it('returns a taken-over definition to the manifest only when asked', async () => {
    const [, app] = (await get('/v1/apps')).body as Array<{ slug: string }>;
    const refused = await remove(app.slug, 'process-request', 'expected_version=3');
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe('automation_ownership_conflict');
    expect(
      (await remove(app.slug, 'process-request', 'expected_version=3&restore_manifest=true')).status
    ).toBe(204);
    const { body } = await get(`/v1/apps/${app.slug}/automations`);
    expect(
      body.automations.find((row: { name: string }) => row.name === 'process-request')
    ).toMatchObject({ source: 'manifest' });
  });
});

describe('workspace app mock contract', () => {
  it('attributes an app created through the workspace URL to that workspace only', async () => {
    const created = await fetch(`${origin}/v1/orgs/acme-corp/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'workspace-contract', type: 'function', runtime: 'node22' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ slug: 'workspace-contract' });
    const shared = (await get('/v1/orgs/acme-corp/apps')).body.apps as Array<{ slug: string }>;
    expect(shared[0]).toMatchObject({ slug: 'workspace-contract', type: 'function' });
    expect(Object.keys(shared[0]).sort()).toEqual(
      ['created_at', 'id', 'runtime', 'slug', 'status', 'type'].sort()
    );
    const personal = (await get('/v1/orgs/design/apps')).body.apps as Array<{ slug: string }>;
    expect(personal.map((app) => app.slug)).not.toContain('workspace-contract');
    // The creator still sees it in their own list.
    const own = (await get('/v1/apps')).body as Array<{ slug: string }>;
    expect(own.map((app) => app.slug)).toContain('workspace-contract');
    const unknown = await fetch(`${origin}/v1/orgs/no-such-org/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'nowhere-app' }),
    });
    expect(unknown.status).toBe(404);
  });
});
describe('PR preview create and read (B27)', () => {
  const post = (path: string, body: unknown) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('creates pr-{N}-{parent} undeployed, then renews it on a repeat', async () => {
    const apps = (await get('/v1/apps')).body as { slug: string; preview_of_slug?: string }[];
    const parent = apps.find((app) => !app.preview_of_slug)!.slug;
    const first = await post(`/v1/apps/${parent}/previews`, { pr_number: 77, ttl_hours: 24 });
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created).toMatchObject({
      slug: `pr-77-${parent}`,
      preview_of_slug: parent,
      preview_pr_number: 77,
      preview_pr_state: 'open',
      status: 'undeployed',
    });
    const lease = Date.parse(created.preview_expires_at) - Date.now();
    expect(lease).toBeGreaterThan(23 * 3_600_000);
    expect(lease).toBeLessThanOrEqual(24 * 3_600_000);
    const again = await post(`/v1/apps/${parent}/previews`, { pr_number: 77 });
    expect(again.status).toBe(200);
    expect(Date.parse((await again.json()).preview_expires_at) - Date.now()).toBeGreaterThan(
      6 * 86_400_000
    );
    const read = await get(`/v1/preview/pr-77-${parent}`);
    expect(read.response.status).toBe(200);
    expect(read.body).toMatchObject({
      app: { slug: `pr-77-${parent}` },
      parent: { slug: parent },
      links: { url: created.url },
      changes_from_production: { configuration_changed_groups: [] },
    });
    expect(read.body.latest_deployment).toBeUndefined();
  });

  it('refuses a preview parent, a bad PR number and a bad lease', async () => {
    const apps = (await get('/v1/apps')).body as { slug: string; preview_of_slug?: string }[];
    const preview = apps.find((app) => app.preview_of_slug)!.slug;
    const parent = apps.find((app) => !app.preview_of_slug)!.slug;
    for (const [slug, body] of [
      [preview, { pr_number: 5 }],
      [parent, { pr_number: 0 }],
      [parent, { pr_number: 5, ttl_hours: 721 }],
    ] as const) {
      const response = await post(`/v1/apps/${slug}/previews`, body);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
    }
  });

  it('answers preview_not_found for a production app', async () => {
    const apps = (await get('/v1/apps')).body as { slug: string; preview_of_slug?: string }[];
    const parent = apps.find((app) => !app.preview_of_slug)!.slug;
    const read = await get(`/v1/preview/${parent}`);
    expect(read.response.status).toBe(404);
    expect(read.body.code).toBe('preview_not_found');
  });

  it('enforces the plan preview limit with plan_limit_apps', async () => {
    const apps = (await get('/v1/apps')).body as { slug: string; preview_of_slug?: string }[];
    const parent = apps.find((app) => !app.preview_of_slug)!.slug;
    let last: Response | undefined;
    for (let pr = 900; pr < 912; pr++) {
      last = await post(`/v1/apps/${parent}/previews`, { pr_number: pr });
      if (last.status !== 201) break;
    }
    expect(last!.status).toBe(403);
    expect((await last!.json()).code).toBe('plan_limit_apps');
  });
});

describe('billing identity, status and invoice history mock contract', () => {
  const patchBilling = (body: unknown) =>
    fetch(`${origin}/v1/account/billing`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const backfill = (query = '') =>
    fetch(`${origin}/v1/invoices/backfill${query}`, { method: 'POST' });
  const savedBilling = process.env.MOCK_BILLING;
  afterEach(() => {
    if (savedBilling === undefined) delete process.env.MOCK_BILLING;
    else process.env.MOCK_BILLING = savedBilling;
  });

  it('reports a live Stripe attachment, and billing off on demand', async () => {
    const live = await get('/v1/billing/status');
    expect(live.response.status).toBe(200);
    expect(live.body).toMatchObject({
      mode: 'live',
      enabled: true,
      provider: 'stripe',
      customer_configured: true,
      usage_reconciliation_enabled: false,
    });
    process.env.MOCK_BILLING = 'disabled';
    const off = await get('/v1/billing/status');
    expect(off.body).toMatchObject({ mode: 'disabled', enabled: false });
  });

  it('patches the identity partially, trims, clears with an empty string and reads back', async () => {
    expect((await patchBilling({})).status).toBe(400);
    expect((await patchBilling({ business_name: 'é'.repeat(129) })).status).toBe(400);

    const saved = await patchBilling({ business_name: '  Gregale Labs AG ', tax_id: 'DE123' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ business_name: 'Gregale Labs AG', tax_id: 'DE123' });

    expect((await patchBilling({ tax_id: '' })).status).toBe(200);
    const { body } = await get('/v1/account');
    expect(body.business_name).toBe('Gregale Labs AG');
    expect(body).not.toHaveProperty('tax_id');
  });

  it('imports missing provider invoices once and skips them on replay', async () => {
    const before = (await get('/v1/invoices')).body.items.length;
    expect((await backfill('?limit=26')).status).toBe(400);
    expect((await backfill('?page=2')).status).toBe(400);

    const first = await backfill();
    expect(first.status).toBe(200);
    const page = await first.json();
    expect(page).toMatchObject({ provider: 'stripe', has_more: false });
    expect(page.imported).toBeGreaterThan(0);
    expect(page.scanned).toBe(page.imported + page.skipped);
    expect((await get('/v1/invoices')).body.items).toHaveLength(before + page.imported);

    const replay = await (await backfill()).json();
    expect(replay.imported).toBe(0);
    expect(replay.skipped).toBe(page.scanned);
  });

  it('answers 501 when billing is off', async () => {
    process.env.MOCK_BILLING = 'disabled';
    const response = await backfill();
    expect(response.status).toBe(501);
    expect((await response.json()).code).toBe('not_implemented');
  });
});

describe('deleted-app inventory mock contract', () => {
  type Summary = {
    id: string;
    slug: string;
    restore_eligible: boolean;
    restore_blocker: string;
    delete_grace_until: string | null;
  };
  type Page = { account_id: string; apps: Summary[]; next_cursor?: string; evaluated_at: string };
  const list = async (query = '') => (await get(`/v1/deleted-apps${query}`)).body as Page;
  const restore = (id: string) =>
    fetch(`${origin}/v1/deleted-apps/${id}/restore`, { method: 'POST' });

  it('pages the seeded inventory newest first through an opaque cursor', async () => {
    const all = await list();
    expect(all.account_id).toBeTruthy();
    expect(all.apps.map((row) => row.restore_blocker)).toEqual(
      expect.arrayContaining(['', 'grace_expired', 'purge_started'])
    );
    const first = await list('?limit=1');
    expect(first.apps).toHaveLength(1);
    expect(first.next_cursor).toBeTruthy();
    const second = await list(`?limit=1&cursor=${first.next_cursor}`);
    expect(second.apps[0].id).not.toBe(first.apps[0].id);
    expect(second.apps[0].id).toBe(all.apps[1].id);
    for (const query of ['?limit=51', '?cursor=not-a-cursor', '?environment=staging']) {
      const rejected = await get(`/v1/deleted-apps${query}`);
      expect(rejected.response.status).toBe(400);
      expect(rejected.body).toMatchObject({ code: 'validation_failed' });
    }
  });

  it('restores a deleted app by exact ID, once', async () => {
    const slug = 'deleted-inventory-contract';
    const created = await fetch(`${origin}/v1/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    const { id } = (await created.json()) as { id: string };
    await fetch(`${origin}/v1/apps/${slug}`, { method: 'DELETE' });
    const row = (await list('?limit=50')).apps.find((r) => r.id === id);
    expect(row).toMatchObject({ slug, restore_eligible: true, restore_blocker: '' });
    expect((await get(`/v1/deleted-apps/${id}`)).body).toMatchObject({ id, slug });

    const restored = await restore(id);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ id, slug });
    expect((await list('?limit=50')).apps.some((r) => r.id === id)).toBe(false);
    const again = await restore(id);
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ code: 'not_found' });
  });

  it('refuses closed windows, reused names and a full plan with their codes', async () => {
    const rows = (await list('?limit=50')).apps;
    const expired = rows.find((r) => r.restore_blocker === 'grace_expired')!;
    expect(await (await restore(expired.id)).json()).toMatchObject({
      code: 'app_not_restorable',
    });
    const taken = rows.find((r) => r.slug === 'api-gateway')!;
    const conflict = await restore(taken.id);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'conflict' });

    process.env.MOCK_PLAN = 'free';
    const eligible = rows.find((r) => r.restore_eligible && r.slug !== 'api-gateway')!;
    const limited = await restore(eligible.id);
    expect(limited.status).toBe(403);
    expect(await limited.json()).toMatchObject({ code: 'plan_limit_apps' });
  });
});

it('keeps the restart contract on PATCH /v1/apps/{slug} and refuses past the plan cap', async () => {
  const patch = (body: object) =>
    fetch(`${origin}/v1/apps/api-gateway`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  process.env.MOCK_PLAN = 'hobby';
  const refused = await patch({ stop_grace_period_s: 90 });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ code: 'validation_failed' });

  const saved = await patch({ restart_policy: 'always', stop_grace_period_s: 20 });
  expect(saved.status).toBe(200);
  const app = await saved.json();
  expect(app.manifest).toMatchObject({ restart_policy: 'always', stop_grace_period: 20e9 });
  await patch({ restart_policy: '', stop_grace_period_s: 0 });
  const { body } = await get('/v1/apps/api-gateway');
  expect(body.manifest.restart_policy).toBeUndefined();
  expect(body.manifest.stop_grace_period).toBeUndefined();
});

it('echoes probe overrides on the serving deployment', async () => {
  const { body } = await get('/v1/apps/api-gateway/deployments');
  const live = body.items.find((d: { status: string }) => d.status === 'live');
  expect(live.override_readiness_probe).toMatchObject({ path: '/readyz' });
  expect(live.override_liveness_probe).toMatchObject({ path: '/livez' });
});
