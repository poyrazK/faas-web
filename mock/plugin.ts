import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import * as db from './data';

/**
 * Dev-only mock of `apid`, as a Vite middleware.
 *
 * Registered by `vite.config.ts` only when `MOCK_API=1` (`npm run dev:mock`).
 * It answers the same paths the proxy would otherwise forward — `/v1/*`,
 * `POST /login`, `POST /signup` — with real HTTP on the dev origin, so the
 * app's fetch client, its cookies, and the `EventSource` log stream all run
 * unchanged. Nothing here is reachable from a production build: Vite plugins
 * do not ship, and `src/` never imports this directory.
 *
 * Coverage is the set of operations the console actually calls (see the
 * inventory in the PR that added this). Anything else under `/v1` gets a
 * `not_mocked` problem+json and a line on the dev-server console, so a gap
 * announces itself rather than hanging a spinner.
 */

type Handler = (ctx: {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  req: IncomingMessage;
  res: ServerResponse;
}) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, template: string, handler: Handler) {
  const keys: string[] = [];
  const source = template
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{(\w+)\\\}/g, (_, k: string) => {
      keys.push(k);
      return '([^/]+)';
    });
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
}

/** Thrown by a handler to answer with an RFC 7807 problem. */
class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string
  ) {
    super(detail ?? code);
  }
}

/** Signals "204 No Content". */
const NO_CONTENT = Symbol('no-content');
/** Wraps a body with a non-200 status. */
const status = (code: number, body: unknown) => ({ __status: code, body });

const latency = () => Number(process.env.MOCK_LATENCY ?? 180) + Math.random() * 160;

// --- Auth --------------------------------------------------------------------

const SESSION_COOKIE = 'faas_sid=mock-session; Path=/; HttpOnly; SameSite=Lax';
const CSRF_COOKIE = 'faas_csrf=mock-csrf; Path=/; SameSite=Lax';

const login: Handler = ({ body, res }) => {
  const email = String(body.email ?? '');
  const password = String(body.password ?? '');
  if (!email.includes('@'))
    throw new Problem(400, 'invalid_email', 'That does not look like an email address.');
  if (password.length < 12)
    throw new Problem(401, 'invalid_credentials', 'Email or password is incorrect.');
  res.setHeader('Set-Cookie', [SESSION_COOKIE, CSRF_COOKIE]);
  return { account_id: db.ACCOUNT_ID, plan: db.account.plan };
};
route('POST', '/login', login);
route('POST', '/signup', login);
route('POST', '/login/forgot', () => ({}));
route('POST', '/v1/auth/logout', ({ res }) => {
  res.setHeader('Set-Cookie', ['faas_sid=; Path=/; Max-Age=0', 'faas_csrf=; Path=/; Max-Age=0']);
  return NO_CONTENT;
});

route('GET', '/v1/account', () => ({ ...db.account, app_count: db.apps.length }));
route('PATCH', '/v1/account/plan', ({ body }) => {
  const plan = String(body.plan ?? '') as typeof db.account.plan;
  if (!['free', 'hobby', 'pro', 'scale'].includes(plan)) throw new Problem(400, 'invalid_plan');
  db.account.plan = plan;
  db.account.limits.plan = plan;
  return db.account;
});

route('GET', '/v1/auth/sessions', () => ({ sessions: db.sessions }));
route('DELETE', '/v1/auth/sessions/{id}', ({ params }) => {
  const i = db.sessions.findIndex((s) => s.id === params.id);
  if (i < 0) throw new Problem(404, 'session_not_found');
  if (db.sessions[i].current_session) throw new Problem(409, 'cannot_revoke_current_session');
  db.sessions.splice(i, 1);
  return NO_CONTENT;
});
route('POST', '/v1/auth/sessions/revoke_all', () => {
  const others = db.sessions.filter((s) => !s.current_session).length;
  db.sessions.splice(0, db.sessions.length, ...db.sessions.filter((s) => s.current_session));
  return { revoked: others };
});

// --- Apps --------------------------------------------------------------------

function app(slug: string) {
  const found = db.appBySlug(slug);
  if (!found) throw new Problem(404, 'app_not_found', `No app named "${slug}".`);
  return found;
}

route('GET', '/v1/apps', () => db.apps);
route('GET', '/v1/apps/metrics', ({ query }) => {
  const range = query.get('range') ?? '24h';
  return {
    range,
    source: 'prometheus',
    as_of: db.iso(0),
    apps: Object.fromEntries(db.apps.map((a) => [a.slug, db.metricsFor(a, range)])),
  };
});
route('POST', '/v1/apps', ({ body }) => {
  const slug = String(body.slug ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug))
    throw new Problem(400, 'invalid_slug', 'Slugs are lowercase letters, digits, and dashes.');
  if (db.appBySlug(slug)) throw new Problem(409, 'app_exists', `"${slug}" already exists.`);
  const created: db.App = {
    ...db.apps[0],
    id: db.id(),
    slug,
    type: (body.type as db.App['type']) ?? 'function',
    runtime: (body.runtime as db.App['runtime']) ?? 'node24',
    ram_mb: Number(body.ram_mb ?? 256),
    min_instances: 0,
    status: 'pending',
    url: `https://${slug}.gregale.app`,
  };
  db.apps.push(created);
  return status(201, created);
});
route('GET', '/v1/apps/{slug}', ({ params }) => app(params.slug));
route('DELETE', '/v1/apps/{slug}', ({ params }) => {
  const a = app(params.slug);
  db.apps.splice(db.apps.indexOf(a), 1);
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/wake', ({ params }) => {
  app(params.slug).status = 'active';
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/park', ({ params }) => {
  app(params.slug).status = 'parked';
  return NO_CONTENT;
});
const PATCHABLE = [
  'ram_mb',
  'idle_timeout_s',
  'max_concurrency',
  'min_instances',
  'egress_allowlist',
  'autoscale_target_rps',
  'autoscale_target_cpu_pct',
  'streaming_enabled',
  'websocket_enabled',
  'route_metrics_enabled',
  'maintenance_mode',
  'warm_snapshot_enabled',
  'eviction_priority',
] as const;
route('PATCH', '/v1/apps/{slug}', ({ params, body }) => {
  const a = app(params.slug);
  for (const k of PATCHABLE)
    if (k in body && body[k] !== null) (a as Record<string, unknown>)[k] = body[k];
  return a;
});
route('POST', '/v1/apps/{slug}/rename', ({ params, body }) => {
  const a = app(params.slug);
  const next = String(body.new_slug ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(next))
    throw new Problem(400, 'invalid_slug', 'Slugs are lowercase letters, digits, and dashes.');
  if (db.appBySlug(next)) throw new Problem(409, 'app_exists', `"${next}" already exists.`);
  db.renameApp(a, next);
  return a;
});
route('POST', '/v1/apps/{slug}/deployments/source-ref', ({ params, body }) => {
  const a = app(params.slug);
  if (!body.repo || !body.ref)
    throw new Problem(400, 'missing_field', 'repo and ref are required.');
  const dep: db.Deployment = {
    id: db.id(),
    app_id: a.id,
    build_id: db.id(),
    image_digest: `sha256:${db.id()}${db.id()}`,
    kind: 'github',
    status: 'building',
    created_at: db.iso(0),
    traffic_percent: 0,
    rollback_on_5xx: false,
    first_5xx_count: 0,
    scan: null,
  };
  db.deployments.unshift(dep);
  a.status = 'deploying';
  return status(202, dep);
});
route('POST', '/v1/apps/{slug}/rollback', ({ params }) => {
  const a = app(params.slug);
  const previous = db.deployments.filter((d) => d.app_id === a.id && d.status === 'succeeded')[0];
  if (!previous) throw new Problem(409, 'no_previous_deployment', 'Nothing to roll back to.');
  const dep: db.Deployment = {
    ...previous,
    id: db.id(),
    status: 'active',
    created_at: db.iso(0),
    traffic_percent: 100,
  };
  db.deployments.unshift(dep);
  return status(202, dep);
});
route('GET', '/v1/apps/{slug}/metrics', ({ params, query }) =>
  db.metricsFor(app(params.slug), query.get('range') ?? '24h')
);
route('GET', '/v1/apps/{slug}/routes', ({ params }) => db.routesFor(app(params.slug)));

// Per-app config
const listOf = <T>(map: Map<string, T[]>, slug: string) => map.get(app(slug).slug) ?? [];

route('GET', '/v1/apps/{slug}/secrets', ({ params }) => {
  const secrets = listOf(db.secrets, params.slug);
  return { secrets, quota_max: 64, count: secrets.length };
});
route('PUT', '/v1/apps/{slug}/secrets/{key}', ({ params }) => {
  const list = listOf(db.secrets, params.slug);
  const existing = list.find((s) => s.key === params.key);
  const now = db.iso(0);
  if (existing) {
    existing.updated_at = now;
    return existing;
  }
  const created = {
    key: params.key,
    scope: 'default',
    kid: db.id().slice(0, 8),
    created_at: now,
    updated_at: now,
  };
  list.push(created);
  db.secrets.set(params.slug, list);
  return created;
});
route('DELETE', '/v1/apps/{slug}/secrets/{key}', ({ params }) => {
  const list = listOf(db.secrets, params.slug);
  const i = list.findIndex((s) => s.key === params.key);
  if (i < 0) throw new Problem(404, 'secret_not_found');
  list.splice(i, 1);
  return NO_CONTENT;
});

route('GET', '/v1/apps/{slug}/env', ({ params }) => {
  const env = listOf(db.env, params.slug);
  return { env, env_by_scope: { app: env }, quota_max: 128, count: env.length };
});
route('PUT', '/v1/apps/{slug}/env/{key}', ({ params, body }) => {
  const list = listOf(db.env, params.slug);
  const existing = list.find((e) => e.key === params.key);
  const now = db.iso(0);
  if (existing) {
    existing.updated_at = now;
    return existing;
  }
  const created = {
    key: params.key,
    scope: String(body.scope ?? 'app'),
    created_at: now,
    updated_at: now,
  };
  list.push(created);
  db.env.set(params.slug, list);
  return created;
});
route('DELETE', '/v1/apps/{slug}/env/{key}', ({ params }) => {
  const list = listOf(db.env, params.slug);
  const i = list.findIndex((e) => e.key === params.key);
  if (i < 0) throw new Problem(404, 'env_not_found');
  list.splice(i, 1);
  return NO_CONTENT;
});

route('GET', '/v1/apps/{slug}/upstreams', ({ params }) => {
  const upstreams = listOf(db.upstreams, params.slug);
  return { upstreams, quota_max: 16, count: upstreams.length };
});
route('PUT', '/v1/apps/{slug}/upstreams', ({ params, body }) => {
  app(params.slug);
  const host = String(body.host ?? '').trim();
  if (!body.kind || !host || !body.port)
    throw new Problem(400, 'missing_field', 'kind, host, and port are required.');
  const list = listOf(db.upstreams, params.slug);
  const up: (typeof list)[number] = {
    id: db.id(),
    source: 'explicit',
    kind: body.kind as (typeof list)[number]['kind'],
    host_redacted_hash: db.id().slice(0, 16),
    host_last4: host.slice(-4),
    port: Number(body.port),
    scope: body.scope ? String(body.scope) : undefined,
    created_at: db.iso(0),
    last_seen_at: db.iso(0),
  };
  list.push(up);
  db.upstreams.set(params.slug, list);
  return status(201, up);
});
route('DELETE', '/v1/apps/{slug}/upstreams/{id}', ({ params }) => {
  const list = listOf(db.upstreams, params.slug);
  const i = list.findIndex((u) => u.id === params.id);
  if (i < 0) throw new Problem(404, 'upstream_not_found');
  list.splice(i, 1);
  return NO_CONTENT;
});
const alertPresets = [
  {
    id: 'preset-error-rate',
    name: 'error_rate_2pct',
    display_name: 'Error rate exceeds 2%',
    description: 'Fires when the rolling 15-minute error rate exceeds 2%.',
    category: 'reliability',
    metric: 'error_rate_pct',
    comparison: 'gt',
    threshold: 2,
    window_spec: '15m',
    default_cooldown_minutes: 15,
    minimum_plan: 'hobby',
    enabled_in_catalog: true,
  },
  {
    id: 'preset-latency',
    name: 'latency_p99_1s',
    display_name: 'p99 latency over 1s',
    description: 'Fires when the 99th percentile stays above one second for an hour.',
    category: 'availability',
    metric: 'latency_p99_ms',
    comparison: 'gt',
    threshold: 1000,
    window_spec: '1h',
    default_cooldown_minutes: 30,
    minimum_plan: 'pro',
    enabled_in_catalog: true,
  },
  {
    id: 'preset-cold-starts',
    name: 'cold_start_50pct',
    display_name: 'Cold starts over 50%',
    description: 'Most requests are waking the app; consider a warm instance.',
    category: 'cost',
    metric: 'cold_start_pct',
    comparison: 'gt',
    threshold: 50,
    window_spec: '6h',
    default_cooldown_minutes: 60,
    minimum_plan: 'free',
    enabled_in_catalog: true,
  },
];

route('GET', '/v1/alert-presets', () => alertPresets);

route('POST', '/v1/apps/{slug}/alert-presets/{name}/enable', ({ params, body }) => {
  const preset = alertPresets.find((p) => p.name === params.name);
  if (!preset) throw new Problem(404, 'preset_not_found');
  // The account is on hobby in the mock, so a pro preset shows the plan gate.
  if (preset.minimum_plan === 'pro' || preset.minimum_plan === 'scale') {
    throw new Problem(402, 'plan_required', `This preset needs the ${preset.minimum_plan} plan.`);
  }
  const a = app(params.slug);
  const list = listOf(db.alerts, params.slug);
  const rule: (typeof list)[number] = {
    id: db.id(),
    app_id: a.id,
    name: preset.display_name,
    enabled: body.enabled !== false,
    metric: preset.metric as (typeof list)[number]['metric'],
    comparison: preset.comparison as (typeof list)[number]['comparison'],
    threshold: preset.threshold,
    window_spec: preset.window_spec as (typeof list)[number]['window_spec'],
    webhook_url: String(body.webhook_url ?? ''),
    webhook_secret_sealed_masked: '***',
    cooldown_minutes: preset.default_cooldown_minutes,
    action: 'webhook',
    state: 'ok',
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  list.push(rule);
  db.alerts.set(params.slug, list);
  return status(201, rule);
});

route('POST', '/v1/apps/{slug}/alert-presets/{name}/test', ({ params }) => {
  const preset = alertPresets.find((p) => p.name === params.name);
  if (!preset) throw new Problem(404, 'preset_not_found');
  const exists = listOf(db.alerts, params.slug).some((r) => r.name === preset.display_name);
  if (!exists) throw new Problem(404, 'not_found', 'This preset is not enabled on the app.');
  return { status: 'sent', is_test: true };
});

route('GET', '/v1/apps/{slug}/alerts', ({ params }) => listOf(db.alerts, params.slug));
route('POST', '/v1/apps/{slug}/alerts', ({ params, body }) => {
  const a = app(params.slug);
  if (!body.name || !body.metric || !body.webhook_url)
    throw new Problem(400, 'missing_field', 'name, metric, and webhook_url are required.');
  const list = listOf(db.alerts, params.slug);
  const rule: (typeof list)[number] = {
    id: db.id(),
    app_id: a.id,
    name: String(body.name),
    enabled: body.enabled !== false,
    metric: body.metric as (typeof list)[number]['metric'],
    comparison: (body.comparison ?? 'gt') as (typeof list)[number]['comparison'],
    threshold: Number(body.threshold ?? 0),
    window_spec: (body.window_spec ?? '15m') as (typeof list)[number]['window_spec'],
    webhook_url: String(body.webhook_url),
    webhook_secret_sealed_masked: '***',
    cooldown_minutes: Number(body.cooldown_minutes ?? 30),
    action: (body.action ?? 'webhook') as (typeof list)[number]['action'],
    state: 'ok',
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  list.push(rule);
  db.alerts.set(params.slug, list);
  return status(201, rule);
});
// Deliveries: one delivered, one failed with a real reason, and one test row
// that only appears when include_test is set — so both branches of the toggle
// are visible without a live webhook.
route('GET', '/v1/apps/{slug}/alerts/{id}/deliveries', ({ params, query }) => {
  const rule = listOf(db.alerts, params.slug).find((r) => r.id === params.id);
  if (!rule) throw new Problem(404, 'alert_not_found');
  const base = {
    rule_id: rule.id,
    account_id: 'acct-1',
    app_id: rule.app_id,
    observed_value: 12.5,
  };
  const rows = [
    {
      ...base,
      id: db.id(),
      idempotency_key: `${rule.id}:1`,
      status: 'delivered',
      attempt_count: 1,
      last_status_code: 200,
      fired_at: new Date(Date.now() - 3600_000).toISOString(),
      delivered_at: new Date(Date.now() - 3599_000).toISOString(),
      is_test: false,
    },
    {
      ...base,
      id: db.id(),
      idempotency_key: `${rule.id}:2`,
      status: 'failed',
      attempt_count: 3,
      last_status_code: 502,
      last_error: 'upstream refused the connection',
      observed_value: 31.2,
      fired_at: new Date(Date.now() - 7200_000).toISOString(),
      is_test: false,
    },
    {
      ...base,
      id: db.id(),
      idempotency_key: `${db.id()}:test`,
      status: 'delivered',
      attempt_count: 1,
      last_status_code: 200,
      fired_at: new Date(Date.now() - 600_000).toISOString(),
      delivered_at: new Date(Date.now() - 599_000).toISOString(),
      is_test: true,
    },
  ];
  return query.get('include_test') === 'true' ? rows : rows.filter((r) => !r.is_test);
});

route('PATCH', '/v1/apps/{slug}/alerts/{id}', ({ params, body }) => {
  const rule = listOf(db.alerts, params.slug).find((r) => r.id === params.id);
  if (!rule) throw new Problem(404, 'alert_rule_not_found');
  for (const k of [
    'name',
    'enabled',
    'metric',
    'comparison',
    'threshold',
    'window_spec',
    'webhook_url',
    'cooldown_minutes',
  ] as const)
    if (k in body && body[k] != null) (rule as Record<string, unknown>)[k] = body[k];
  rule.updated_at = db.iso(0);
  return rule;
});
route('POST', '/v1/apps/{slug}/alerts/{id}/rotate-secret', ({ params }) => {
  const rule = listOf(db.alerts, params.slug).find((r) => r.id === params.id);
  if (!rule) throw new Problem(404, 'alert_rule_not_found');
  rule.updated_at = db.iso(0);
  return { rotated_at: rule.updated_at, webhook_secret_sealed_masked: '***' };
});
route('DELETE', '/v1/apps/{slug}/alerts/{id}', ({ params }) => {
  const list = listOf(db.alerts, params.slug);
  const i = list.findIndex((r) => r.id === params.id);
  if (i < 0) throw new Problem(404, 'alert_rule_not_found');
  list.splice(i, 1);
  return NO_CONTENT;
});
// Traffic mirroring (ADR-124 / ADR-125). MOCK_PLAN=free reproduces the
// create-time plan gate; the list is never gated, as in apid.
// Pro allows one mirror rule per app, Scale three.
const mirrorQuota = () => (db.account.plan === 'scale' ? 3 : 1);
const MIRROR_WINDOW_SECONDS: Record<string, number> = { '1h': 3600, '24h': 86400, '7d': 604800 };

function mirrorRule(slug: string, id: string) {
  const rule = listOf(db.mirrorRules, slug).find((r) => r.id === id);
  if (!rule) throw new Problem(404, 'not_found', 'no such mirror rule');
  return rule;
}

route('GET', '/v1/apps/{slug}/mirrors', ({ params }) => {
  const rules = listOf(db.mirrorRules, params.slug);
  return { rules, count: rules.length };
});
route('POST', '/v1/apps/{slug}/mirrors', ({ params, body }) => {
  const a = app(params.slug);
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      403,
      'plan_mirror_not_allowed',
      'traffic mirroring needs the Pro or Scale plan.'
    );
  const list = listOf(db.mirrorRules, a.slug);
  const source = String(body.source_deployment_id ?? '');
  const mirror = String(body.mirror_deployment_id ?? '');
  const percent = Number(body.percent);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100)
    throw new Problem(422, 'invalid_mirror_percent', 'percent must be in [0, 100].');
  if (source === mirror)
    throw new Problem(422, 'mirror_source_target_same', 'source and mirror must differ.');
  const s = db.deployments.find((d) => d.id === source);
  const m = db.deployments.find((d) => d.id === mirror);
  if (!s || !m) throw new Problem(404, 'not_found', 'no such deployment');
  if (s.app_id !== a.id || m.app_id !== a.id)
    throw new Problem(422, 'mirror_cross_app_mismatch', 'both deployments must belong to the app.');
  if (s.status !== 'live' || m.status !== 'live')
    throw new Problem(409, 'mirror_deployment_not_live', 'both deployments must be live.');
  if (list.length >= mirrorQuota())
    throw new Problem(
      422,
      'mirror_rule_quota_exceeded',
      `at most ${mirrorQuota()} mirror rules per app on the ${db.account.plan} plan.`
    );
  const rule: (typeof list)[number] = {
    id: db.id(),
    account_id: db.ACCOUNT_ID,
    app_id: a.id,
    source_deployment_id: source,
    mirror_deployment_id: mirror,
    percent,
    enabled: true,
    include_body: body.include_body === true,
    redact_headers: Array.isArray(body.redact_headers) ? body.redact_headers.map(String) : [],
    always_stripped_headers: ['Authorization', 'Cookie'],
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  list.push(rule);
  db.mirrorRules.set(a.slug, list);
  return status(201, rule);
});
route('GET', '/v1/apps/{slug}/mirrors/{id}', ({ params }) => mirrorRule(params.slug, params.id));
route('PATCH', '/v1/apps/{slug}/mirrors/{id}', ({ params, body }) => {
  const rule = mirrorRule(params.slug, params.id);
  if (body.percent !== undefined) {
    const percent = Number(body.percent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100)
      throw new Problem(422, 'invalid_mirror_percent', 'percent must be in [0, 100].');
    rule.percent = percent;
  }
  if (typeof body.enabled === 'boolean') rule.enabled = body.enabled;
  if (typeof body.include_body === 'boolean') rule.include_body = body.include_body;
  if (Array.isArray(body.redact_headers)) rule.redact_headers = body.redact_headers.map(String);
  rule.updated_at = db.iso(0);
  return rule;
});
route('DELETE', '/v1/apps/{slug}/mirrors/{id}', ({ params }) => {
  const list = listOf(db.mirrorRules, params.slug);
  const i = list.findIndex((r) => r.id === params.id);
  if (i < 0) throw new Problem(404, 'not_found', 'no such mirror rule');
  list.splice(i, 1);
  return NO_CONTENT;
});
route('GET', '/v1/apps/{slug}/mirrors/{id}/summary', ({ params, query }) => {
  const rule = mirrorRule(params.slug, params.id);
  const window = query.get('window') ?? '1h';
  const seconds = MIRROR_WINDOW_SECONDS[window];
  if (!seconds) throw new Problem(422, 'invalid_mirror_window', 'window must be 1h, 24h or 7d.');
  // Deterministic drift proportional to the window and the mirrored share,
  // so switching windows visibly changes the counts.
  const total = rule.enabled ? Math.round((seconds / 3600) * rule.percent * 4.2) : 0;
  return {
    total_invocations: total,
    status_diff_count: Math.round(total * 0.012),
    schema_diff_count: Math.round(total * 0.004),
    body_diff_count: rule.include_body ? Math.round(total * 0.03) : 0,
    mean_latency_diff_ms: total === 0 ? 0 : 12,
    p99_latency_diff_ms: total === 0 ? 0 : -8,
    crash_count: Math.round(total * 0.0005),
    window_seconds: seconds,
  };
});

route('GET', '/v1/apps/{slug}/webhooks', ({ params }) => listOf(db.webhooks, params.slug));
route('POST', '/v1/apps/{slug}/webhooks', ({ params, body }) => {
  const a = app(params.slug);
  const url = String(body.target_url ?? '');
  if (!/^https:\/\//.test(url))
    throw new Problem(400, 'invalid_target_url', 'Webhook targets must be https.');
  if (!body.webhook_secret) throw new Problem(400, 'missing_field', 'webhook_secret is required.');
  const list = listOf(db.webhooks, params.slug);
  const hook: (typeof list)[number] = {
    id: db.id(),
    app_id: a.id,
    account_id: db.ACCOUNT_ID,
    target_url: url,
    webhook_secret_sealed_masked: '***',
    event_filter: Array.isArray(body.event_filter)
      ? (body.event_filter as (typeof list)[number]['event_filter'])
      : [],
    retry_policy: (body.retry_policy ?? 'default') as (typeof list)[number]['retry_policy'],
    enabled: body.enabled !== false,
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  list.push(hook);
  db.webhooks.set(params.slug, list);
  db.deliveries.set(hook.id, []);
  return status(201, hook);
});
route('PATCH', '/v1/apps/{slug}/webhooks/{id}', ({ params, body }) => {
  const hook = listOf(db.webhooks, params.slug).find((w) => w.id === params.id);
  if (!hook) throw new Problem(404, 'webhook_not_found');
  for (const k of ['target_url', 'event_filter', 'retry_policy', 'enabled'] as const)
    if (k in body && body[k] != null) (hook as Record<string, unknown>)[k] = body[k];
  hook.updated_at = db.iso(0);
  return hook;
});
route('DELETE', '/v1/apps/{slug}/webhooks/{id}', ({ params }) => {
  const list = listOf(db.webhooks, params.slug);
  const i = list.findIndex((w) => w.id === params.id);
  if (i < 0) throw new Problem(404, 'webhook_not_found');
  list.splice(i, 1);
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/webhooks/{id}/rotate-secret', ({ params }) => {
  const hook = listOf(db.webhooks, params.slug).find((w) => w.id === params.id);
  if (!hook) throw new Problem(404, 'webhook_not_found');
  hook.updated_at = db.iso(0);
  return { rotated_at: hook.updated_at, webhook_secret_sealed_masked: '***' as const };
});
route('GET', '/v1/apps/{slug}/webhooks/{id}/deliveries', ({ params }) => {
  app(params.slug);
  return { deliveries: db.deliveries.get(params.id) ?? [] };
});
route('POST', '/v1/apps/{slug}/webhooks/{id}/deliveries/{did}/retry', ({ params }) => {
  const d = (db.deliveries.get(params.id) ?? []).find((x) => x.id === params.did);
  if (!d) throw new Problem(404, 'delivery_not_found');
  if (d.status !== 'dead' && d.status !== 'failed')
    throw new Problem(
      409,
      'delivery_not_retryable',
      'Only a failed or dead delivery can be retried.'
    );
  d.status = 'pending';
  d.next_attempt_at = db.iso(-5_000);
  d.updated_at = db.iso(0);
  return { delivery: d };
});

// Deployment lifecycle. Cancel refuses a live row the way the API does; retry
// answers with a new row so the console's "it appears as a new deployment"
// promise is visible in dev.
route('POST', '/v1/apps/{slug}/deployments/{id}/cancel', ({ params }) => {
  const d = db.deployments.find((x) => x.id === params.id);
  if (!d) throw new Problem(404, 'deployment_not_found');
  if (d.status === 'live')
    throw new Problem(409, 'conflict', 'Live deployment cannot be cancelled.');
  d.status = 'cancelled';
  return d;
});

route('POST', '/v1/deployments/{id}/retry', ({ params, body }) => {
  const d = db.deployments.find((x) => x.id === params.id);
  if (!d) throw new Problem(404, 'deployment_not_found');
  const stages = [
    'source_download',
    'dependency_restore',
    'image_build',
    'security_scan',
    'snapshot_prepare',
    'readiness',
  ];
  if (!stages.includes(String(body.from_stage ?? ''))) throw new Problem(400, 'invalid_from_stage');
  const copy = { ...d, id: db.id(), status: 'building', created_at: new Date().toISOString() };
  db.deployments.unshift(copy);
  return copy;
});

// Deployment control (ADR-117 stages, ADR-122 canary + audit + preview URL,
// ADR-124 queue controls). MOCK_PLAN=free reproduces the plan gates.
const STAGE_ORDER = [
  'source_download',
  'dependency_restore',
  'image_build',
  'security_scan',
  'snapshot_prepare',
  'readiness',
] as const;
const STAGE_MS = [1800, 9400, 41000, 6200, 3100, 2500];
const PREVIEW_ALIVE = new Set(['pending', 'building', 'imaging', 'snapshotting', 'live']);
const CANARY_LADDER: Record<string, number[]> = {
  slow: [5, 10, 25, 50, 100],
  balanced: [10, 50, 100],
  aggressive: [25, 100],
  '1-10-50-100': [1, 10, 50, 100],
  none: [100],
};
const queueGated = process.env.MOCK_PLAN === 'free';

function gateQueueControls() {
  if (queueGated) {
    throw new Problem(
      402,
      'plan_reorder_disabled',
      "the free plan doesn't unlock deployment queue controls; upgrade to Hobby or higher."
    );
  }
}

function deploymentById(id: string) {
  const d = db.deployments.find((x) => x.id === id);
  if (!d) throw new Problem(404, 'not_found', 'no such deployment');
  return d;
}

route('GET', '/v1/deployments/{id}/stages', ({ params }) => {
  const d = deploymentById(params.id);
  const started = Date.parse(d.created_at);
  const at = (i: number) => STAGE_MS.slice(0, i).reduce((sum, ms) => sum + ms, 0);
  const row = (i: number, stageStatus: 'completed' | 'failed', reason?: string) => ({
    name: STAGE_ORDER[i],
    started_at: new Date(started + at(i)).toISOString(),
    ended_at: new Date(started + at(i + 1)).toISOString(),
    duration_ms: STAGE_MS[i],
    status: stageStatus,
    ...(reason ? { reason } : {}),
  });
  if (d.status === 'pending') return { history: [] };
  if (d.status === 'building')
    return {
      current: 'image_build',
      current_started_at: new Date(started + at(2)).toISOString(),
      history: [row(0, 'completed'), row(1, 'completed')],
    };
  if (d.status === 'failed' || d.status === 'cancelled')
    return {
      history: [
        row(0, 'completed'),
        row(1, 'completed'),
        row(2, 'failed', d.error ?? 'build failed'),
      ],
    };
  return { history: STAGE_ORDER.map((_, i) => row(i, 'completed')) };
});

route('GET', '/v1/deployments/{id}/audit', ({ params, query }) => {
  const d = deploymentById(params.id);
  const limit = Math.min(500, Math.max(1, Number(query.get('limit') ?? 50) || 50));
  const items: Array<{ at: string; kind: string; actor: string; data?: unknown }> = [];
  if (d.canary_total_steps)
    items.push({
      at: d.canary_step_started_at ?? d.created_at,
      kind: 'deploy.traffic_changed',
      actor: 'canary',
      data: { step: d.canary_step, traffic_percent: d.traffic_percent },
    });
  if (d.status === 'live' || d.status === 'superseded')
    items.push({
      at: d.created_at,
      kind: 'deploy.traffic_changed',
      actor: 'system',
      data: { from: 0, to: d.traffic_percent ?? 100 },
    });
  items.push({ at: d.created_at, kind: 'deploy.created', actor: d.deployed_via ?? 'cli' });
  return { items: items.slice(0, limit), limit };
});

route('GET', '/v1/deployments/{id}/url', ({ params }) => {
  const d = deploymentById(params.id);
  const a = db.apps.find((x) => x.id === d.app_id);
  const siblings = db.deployments
    .filter((x) => x.app_id === d.app_id)
    .sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
  const ordinal = siblings.findIndex((x) => x.id === d.id) + 1;
  const alive = PREVIEW_ALIVE.has(d.status);
  const host = alive && a ? `deploy-${ordinal}.${a.slug}.gregale.dev` : '';
  return {
    deployment_id: d.id,
    app_id: d.app_id,
    host,
    url: host ? `https://${host}` : '',
    alive,
    last_checked_at: new Date().toISOString(),
  };
});

route('POST', '/v1/deployments/{id}/canary/advance', ({ params, body }) => {
  if (queueGated)
    throw new Problem(
      403,
      'plan_traffic_split_not_allowed',
      'canary rollouts need the Pro or Scale plan.'
    );
  const d = deploymentById(params.id);
  const total = d.canary_total_steps ?? 0;
  const step = d.canary_step ?? 0;
  if (d.rollout_state !== 'rolling_out' || total === 0 || step >= total)
    throw new Problem(409, 'canary_step_conflict', 'deployment is not mid-rollout.');
  if (Number(body.expected_step) !== step)
    throw new Problem(
      409,
      'canary_step_conflict',
      `expected step ${step}, got ${String(body.expected_step)}.`
    );
  const ladder = CANARY_LADDER[d.canary_preset ?? 'balanced'] ?? CANARY_LADDER.balanced;
  const next = step + 1;
  d.canary_step = next;
  d.canary_step_started_at = new Date().toISOString();
  d.traffic_percent = ladder[Math.min(next, ladder.length) - 1] ?? 100;
  if (next >= total) {
    d.rollout_state = 'complete';
    d.rollout_completed_at = new Date().toISOString();
    d.traffic_percent = 100;
  }
  return { deployment: d, audit_id: db.id() };
});

route('POST', '/v1/deployments/{id}/reorder', ({ params, body }) => {
  gateQueueControls();
  const d = deploymentById(params.id);
  const priority = Number(body.priority);
  if (!Number.isInteger(priority))
    throw new Problem(400, 'validation_failed', 'body must be {"priority": <int in [0,1000]>}');
  if (d.status !== 'pending')
    throw new Problem(
      409,
      'deployment_reorder_not_pending',
      'deployment has left the pending queue.'
    );
  if (priority < 0 || priority > 1000)
    throw new Problem(422, 'deployment_reorder_priority_invalid', 'priority must be in [0,1000].');
  return { id: d.id, priority };
});

route('POST', '/v1/apps/{slug}/deployments/clear-obsolete', ({ params, body }) => {
  gateQueueControls();
  const a = app(params.slug);
  const olderThan =
    typeof body.older_than === 'string' && body.older_than ? body.older_than : '168h';
  const hours = /^(\d+)h$/.exec(olderThan);
  if (!hours)
    throw new Problem(
      400,
      'validation_failed',
      'older_than must be a Go duration in hours, e.g. 168h'
    );
  const cutoff = Date.now() - Number(hours[1]) * 3_600_000;
  const obsolete = new Set(['superseded', 'failed', 'cancelled']);
  let count = 0;
  for (let i = db.deployments.length - 1; i >= 0; i--) {
    const d = db.deployments[i];
    if (d.app_id === a.id && obsolete.has(d.status) && Date.parse(d.created_at) < cutoff) {
      db.deployments.splice(i, 1);
      count++;
    }
  }
  return { app_slug: a.slug, count, older_than: olderThan };
});

route('GET', '/v1/apps/{slug}/queues/state', ({ params }) => db.queueState(app(params.slug)));
route('GET', '/v1/apps/{slug}/queues/peek', ({ params }) => db.queuePeek(app(params.slug)));
route('GET', '/v1/apps/{slug}/queues/dead_letter', ({ params }) =>
  db.queueDeadLetter(app(params.slug))
);

// Replay resets the row in place. A second replay finds it already pending and
// 404s, matching the real contract the console's "already replayed" branch
// depends on.
const replayed = new Set<string>();

route('POST', '/v1/apps/{slug}/queues/dead_letter/{id}/replay', ({ params }) => {
  const key = `${params.slug}:${params.id}`;
  if (replayed.has(key)) throw new Problem(404, 'not_found', 'The row is already pending.');
  replayed.add(key);
  return NO_CONTENT;
});

// --- Logs (SSE) ---------------------------------------------------------------

route('GET', '/v1/apps/{slug}/instances', ({ params }) => {
  const a = app(params.slug);
  return db.instances.filter((i) => i.app_id === a.id);
});

route('GET', '/v1/apps/{slug}/logs', ({ params, query, req, res }) => {
  const a = app(params.slug);
  const grep = query.get('grep')?.toLowerCase() ?? '';
  const level = query.get('level') ?? '';
  const archive = query.get('archive') === '1';

  // Both archive gates answer before the stream opens, so they are ordinary
  // problem+json rather than SSE frames.
  if (archive) {
    const retention = db.ARCHIVE_RETENTION_DAYS[db.account.plan] ?? 0;
    if (retention === 0)
      throw new Problem(
        402,
        'plan_log_archive_not_allowed',
        'The free plan does not include log archive read-back; upgrade to Hobby or above to query historical logs from object storage.'
      );
    const instance = query.get('instance') ?? '';
    const date = query.get('date') ?? '';
    if (!instance || !date)
      throw new Problem(400, 'rule_invalid', 'archive=1 requires instance and date.');
    const ageDays = Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    if (ageDays < 0 || ageDays > retention)
      throw new Problem(
        403,
        'log_archive_retention_exceeded',
        `?date=${date} is outside the per-plan window of ${retention} days.`
      );
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': mock log stream\n\n');

  const send = (event: string, data: string) => res.write(`event: ${event}\ndata: ${data}\n\n`);

  // The API validates `level` against a closed enum and short-circuits with an
  // SSE error frame rather than an HTTP status, because the stream has already
  // begun. The console renders that code.
  if (level && !['info', 'warn', 'error'].includes(level)) {
    send('error', 'invalid_level');
    res.end();
    return undefined;
  }

  // A parked app has nothing to say; the stream ends the way the real one does.
  if (a.status === 'parked') {
    send(
      'log',
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        instance_id: '',
        msg: 'instance parked — no live output',
      })
    );
    send('end', '');
    res.end();
    return undefined;
  }

  // Archive replays a stored day and ends with a reason; the SSE shape is the
  // same as live so one decoder handles both.
  if (archive) {
    const instance = query.get('instance')!;
    const date = query.get('date')!;
    const known = db.instances.some((i) => i.id === instance && i.app_id === a.id);
    if (!known) {
      send('end', 'archive_missing');
      res.end();
      return undefined;
    }
    const frames = db
      .archivedDay(instance, date)
      .filter(
        (f) => (!grep || f.msg.toLowerCase().includes(grep)) && (!level || f.level === level)
      );
    for (const frame of frames) send('log', JSON.stringify(frame));
    // Older days in this fixture were only partially shipped, which is the
    // case the degraded reason exists for.
    const ageDays = Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    send('end', ageDays > 3 ? 'archive_degraded' : 'archive_complete');
    res.end();
    return undefined;
  }

  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    const frame = db.logFrame(a);
    const matchesGrep = !grep || frame.msg.toLowerCase().includes(grep);
    const matchesLevel = !level || frame.level === level;
    if (matchesGrep && matchesLevel) send('log', JSON.stringify(frame));
    timer = setTimeout(tick, 250 + Math.random() * 900);
  };
  tick();
  req.on('close', () => clearTimeout(timer));
  return undefined; // the handler owns the response
});

// --- Account-wide lists --------------------------------------------------------

route('GET', '/v1/deployments', ({ query }) => ({
  items: db.deployments.slice(0, Number(query.get('limit') ?? 50)),
  next_before: null,
}));
route('GET', '/v1/deployments/{id}', ({ params }) => {
  const d = db.deployments.find((x) => x.id === params.id);
  if (!d) throw new Problem(404, 'deployment_not_found');
  return d;
});
route('GET', '/v1/builds', () => ({ items: db.builds }));
route('GET', '/v1/builds/{id}', ({ params }) => {
  const b = db.builds.find((x) => x.id === params.id);
  if (!b) throw new Problem(404, 'build_not_found');
  return b;
});
route('GET', '/v1/deployments/{id}/logs', ({ params, query, req, res }) => {
  const dep = db.deployments.find((d) => d.id === params.id);
  if (!dep) throw new Problem(404, 'deployment_not_found');
  const build = db.builds.find((b) => b.deployment_id === dep.id);
  const app = db.apps.find((a) => a.id === dep.app_id);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': mock build log\n\n');
  const send = (event: string, data: string) => res.write(`event: ${event}\ndata: ${data}\n\n`);

  const lines = db.buildLog(
    app?.slug ?? 'app',
    build?.status ?? dep.status,
    dep.image_digest,
    build?.failure_class
  );
  const limit = Number(query.get('limit') ?? 0);
  const burst = limit > 0 ? lines.slice(-limit) : lines;
  for (const frame of burst) send('log', JSON.stringify(frame));

  // A finished build has nothing more to say; a running one keeps going and
  // ends when it lands, exactly like the real stream.
  if ((build?.status ?? dep.status) !== 'running' && dep.status !== 'building') {
    send('end', '');
    res.end();
    return undefined;
  }
  let step = 0;
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    step += 1;
    send(
      'log',
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        instance_id: '',
        msg: `#${8 + step} building layer ${step}/4…`,
      })
    );
    if (step >= 4) {
      send(
        'log',
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          instance_id: '',
          msg: 'build succeeded',
        })
      );
      send('end', '');
      res.end();
      return;
    }
    timer = setTimeout(tick, 1200);
  };
  timer = setTimeout(tick, 1200);
  req.on('close', () => clearTimeout(timer));
  return undefined;
});

route('GET', '/v1/builds/{id}/sbom', ({ params, res }) => {
  const b = db.builds.find((x) => x.id === params.id);
  if (!b) throw new Problem(404, 'build_not_found');
  if (b.status !== 'succeeded')
    throw new Problem(409, 'sbom_not_ready', 'The SBOM is produced when the build succeeds.');
  res.setHeader('Content-Type', 'application/vnd.cyclonedx+json');
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${b.id.slice(0, 8)}-0000-4000-8000-${b.id.slice(8, 20)}`,
    version: 1,
    metadata: {
      timestamp: b.finished_at,
      component: { type: 'application', name: 'app', version: b.id.slice(0, 7) },
    },
    components: [
      { type: 'library', name: 'express', version: '4.19.2', purl: 'pkg:npm/express@4.19.2' },
      { type: 'library', name: 'pg', version: '8.11.3', purl: 'pkg:npm/pg@8.11.3' },
      { type: 'library', name: 'ioredis', version: '5.3.2', purl: 'pkg:npm/ioredis@5.3.2' },
    ],
  };
});
route('GET', '/v1/deployments/{id}/scan', ({ params }) => {
  const d = db.deployments.find((x) => x.id === params.id);
  if (!d) throw new Problem(404, 'deployment_not_found');
  if (d.status === 'building')
    return {
      status: 'pending',
      severity_counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      vulnerabilities: [],
    };
  const failing = d.status === 'failed';
  const vulns = [
    {
      id: 'CVE-2024-27980',
      severity: 'HIGH',
      package: 'node',
      version: '24.1.0',
      fixed_in: '24.1.1',
      paths: ['/usr/local/bin/node'],
    },
    {
      id: 'CVE-2023-45857',
      severity: 'MEDIUM',
      package: 'axios',
      version: '1.5.1',
      fixed_in: '1.6.0',
      paths: ['/app/node_modules/axios'],
    },
    {
      id: 'GHSA-9wv6-86v2-598j',
      severity: 'LOW',
      package: 'path-to-regexp',
      version: '6.2.1',
      fixed_in: '6.3.0',
    },
  ].slice(0, failing ? 3 : 2);
  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const v of vulns) counts[v.severity.toLowerCase() as keyof typeof counts]++;
  return {
    status: 'complete',
    scanned_at: d.created_at,
    scanner_version: 'grype 0.79.3',
    image_digest: d.image_digest,
    severity_counts: counts,
    vulnerabilities: vulns,
  };
});

route('GET', '/v1/domains', () => db.domains);
route('POST', '/v1/domains', ({ body }) => {
  const domain = String(body.domain ?? '')
    .toLowerCase()
    .trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Problem(400, 'invalid_domain');
  if (db.domains.some((d) => d.domain === domain)) throw new Problem(409, 'domain_exists');
  const a = db.appBySlug(String(body.app_slug ?? '')) ?? db.apps[0];
  const created = {
    domain,
    app_id: a.id,
    verified: false,
    challenge_token: db.id().slice(0, 24),
    txt_record: `_gregale-challenge.${domain} TXT "${db.id()}"`,
  };
  db.domains.push(created);
  return status(201, created);
});
route('DELETE', '/v1/domains/{domain}', ({ params }) => {
  const i = db.domains.findIndex((d) => d.domain === params.domain);
  if (i < 0) throw new Problem(404, 'domain_not_found');
  db.domains.splice(i, 1);
  return NO_CONTENT;
});

// Verify flips the row on the second press, so the console's "not verified
// yet" branch is reachable without waiting on real DNS. The attempt count
// lives beside the row rather than on it: the rows are schema-typed.
const verifyAttempts = new Map<string, number>();

route('POST', '/v1/domains/{domain}/verify', ({ params }) => {
  const d = db.domains.find((x) => x.domain === params.domain);
  if (!d) throw new Problem(404, 'domain_not_found');
  const n = (verifyAttempts.get(d.domain) ?? 0) + 1;
  verifyAttempts.set(d.domain, n);
  if (n > 1) {
    d.verified = true;
    d.verified_at = new Date().toISOString();
  }
  return d;
});

route('GET', '/v1/domains/{domain}/doctor', ({ params }) => {
  const d = db.domains.find((x) => x.domain === params.domain);
  if (!d) throw new Problem(404, 'domain_not_found');
  const ok = (name: string, detail: string) => ({
    name,
    status: 'ok',
    detail,
    checked_at: new Date().toISOString(),
  });
  return {
    domain: d.domain,
    app_id: d.app_id,
    stale: false,
    healthy: Boolean(d.verified),
    observed_at: new Date().toISOString(),
    checks: d.verified
      ? [
          ok('dns_record', 'CNAME resolves.'),
          ok('points_to_gregale', 'Points at edge.gregale.dev.'),
          ok('tls_certificate', 'Issued and valid.'),
          ok('caa_permits', 'No CAA record restricts issuance.'),
          ok('ipv6_conflict', 'No conflicting AAAA record.'),
        ]
      : [
          {
            name: 'dns_record',
            status: 'fail',
            detail: 'No CNAME found for this hostname.',
            observed: 'NXDOMAIN',
            remediation: `Set CNAME ${d.domain} -> edge.gregale.dev`,
            checked_at: new Date().toISOString(),
          },
          { name: 'points_to_gregale', status: 'pending', detail: 'Waiting on the DNS record.' },
          { name: 'tls_certificate', status: 'pending', detail: 'Issued once DNS resolves.' },
          ok('caa_permits', 'No CAA record restricts issuance.'),
          { name: 'ipv6_conflict', status: 'na', detail: 'No AAAA record published.' },
        ],
  };
});

// --- Debugger (ADR-127) -----------------------------------------------------
// MOCK_PLAN=free reproduces the plan gate, which is the branch that decides
// whether the page reads as broken or as "not on your plan".
const debugGated = process.env.MOCK_PLAN === 'free';

function gateDebug() {
  if (debugGated) {
    throw new Problem(
      402,
      'plan_feature_gated',
      "the free plan doesn't unlock debugger; upgrade to Hobby or higher to use event-driven features."
    );
  }
}

const DEBUG_ROUTES = ['/orders/{id}', '/health', '/webhooks/stripe', '/search'];

route('GET', '/v1/apps/{slug}/debug/requests', ({ query }) => {
  gateDebug();
  const asked = query.get('since') || '1h';
  // The server clamps to the plan's retention; 72h comes back as 24h so the
  // console's "capped" notice is reachable.
  const since = asked === '72h' ? '24h' : asked;
  const requests = Array.from({ length: 18 }, (_, i) => ({
    id: db.id(),
    deployment_id: db.deployments[i % db.deployments.length].id,
    route: DEBUG_ROUTES[i % DEBUG_ROUTES.length],
    method: (['GET', 'POST', 'GET', 'PUT'] as const)[i % 4],
    status: i % 7 === 0 ? 500 : i % 5 === 0 ? 404 : 200,
    latency_ms: i % 7 === 0 ? 2400 : 40 + i * 11,
    cold_boot: i % 6 === 0,
    trace_id: db.id() + db.id(),
    received_at: db.iso(i * 120_000),
  }));
  return { since, requests };
});

route('GET', '/v1/apps/{slug}/debug/regressions', ({ query }) => {
  gateDebug();
  return {
    since: query.get('since') || '24h',
    regressions: [
      {
        deployment_id: db.deployments[0].id,
        route: '/orders/{id}',
        p95_ms: 1840,
        p95_base_ms: 260,
        affected_count: 412,
        regression_factor: '7.08',
        first_detected_at: db.iso(5_400_000),
        last_detected_at: db.iso(120_000),
      },
      {
        deployment_id: db.deployments[0].id,
        route: '/search',
        p95_ms: 390,
        p95_base_ms: 300,
        affected_count: 27,
        regression_factor: '1.30',
        first_detected_at: db.iso(9_000_000),
        last_detected_at: db.iso(600_000),
      },
    ],
  };
});

route('POST', '/v1/apps/{slug}/debug/compare', ({ body }) => {
  gateDebug();
  if (!body.source || !body.mirror) throw new Problem(400, 'validation_failed');
  return {
    source: String(body.source),
    mirror: String(body.mirror),
    // The last route has traffic on one side only — the API does not
    // synthesise the missing percentiles, and neither should the console.
    routes: [
      {
        route: '/orders/{id}',
        source_p50_ms: 120,
        source_p95_ms: 260,
        source_p99_ms: 410,
        source_count: 5120,
        mirror_p50_ms: 640,
        mirror_p95_ms: 1840,
        mirror_p99_ms: 2600,
        mirror_count: 4980,
      },
      {
        route: '/health',
        source_p50_ms: 4,
        source_p95_ms: 9,
        source_p99_ms: 14,
        source_count: 20400,
        mirror_p50_ms: 4,
        mirror_p95_ms: 9,
        mirror_p99_ms: 15,
        mirror_count: 20110,
      },
      {
        route: '/search',
        source_p50_ms: 210,
        source_p95_ms: 480,
        source_p99_ms: 700,
        source_count: 880,
        mirror_p50_ms: 150,
        mirror_p95_ms: 300,
        mirror_p99_ms: 460,
        mirror_count: 910,
      },
      {
        route: '/webhooks/stripe',
        source_p50_ms: 88,
        source_p95_ms: 140,
        source_p99_ms: 190,
        source_count: 310,
        mirror_p50_ms: null,
        mirror_p95_ms: null,
        mirror_p99_ms: null,
        mirror_count: null,
      },
    ],
  };
});

// --- Jobs (spec 14.A) -------------------------------------------------------
// MOCK_PLAN=free reproduces the 402 jobs_not_allowed gate. Run and task states
// cover the whole enum so every badge and every empty state is reachable.
const jobsGated = process.env.MOCK_PLAN === 'free';

function gateJobs() {
  if (jobsGated) {
    throw new Problem(
      402,
      'jobs_not_allowed',
      'the free plan does not include jobs; upgrade to Hobby or above to run batch / one-shot workloads.'
    );
  }
}

const jobSeed = [
  { name: 'nightly-export', kind: 'batch', status: 'active', tasks: 24 },
  { name: 'reindex-search', kind: 'recurring', status: 'active', tasks: 8 },
  { name: 'legacy-backfill', kind: 'batch', status: 'paused', tasks: 120 },
];

const jobs = jobSeed.map((j) => ({
  id: db.id(),
  account_id: 'acct-1',
  name: j.name,
  kind: j.kind,
  image_ref: `registry.gregale.dev/acme/${j.name}:v3`,
  command: ['node', 'scripts/run.js'],
  ram_mb: 2048,
  task_timeout_sec: 1800,
  max_parallelism: 25,
  retry_max: 5,
  status: j.status,
  created_at: db.iso(86_400_000),
  updated_at: db.iso(3_600_000),
}));

const RUN_STATES = ['running', 'succeeded', 'failed', 'cancelled', 'queued', 'dead_letter'];
const TASK_STATES = ['succeeded', 'failed', 'timeout', 'oom', 'cancelled', 'claimed', 'queued'];

function runsFor(name: string) {
  const job = jobs.find((j) => j.name === name);
  const tasks = jobSeed.find((j) => j.name === name)?.tasks ?? 8;
  return RUN_STATES.map((state, i) => ({
    id: db.id(),
    job_id: job?.id ?? db.id(),
    account_id: 'acct-1',
    trigger_kind: (['manual', 'scheduled', 'triggered'] as const)[i % 3],
    tasks,
    parallelism: 25,
    retry_max: 5,
    task_timeout_sec: 1800,
    aggregate_status: state,
    tasks_succeeded: state === 'succeeded' ? tasks : Math.floor(tasks / 2),
    tasks_failed: state === 'failed' || state === 'dead_letter' ? 3 : 0,
    tasks_cancelled: state === 'cancelled' ? 2 : 0,
    created_at: db.iso(i * 3_600_000),
    updated_at: db.iso(i * 3_500_000),
  }));
}

const runCache = new Map<string, ReturnType<typeof runsFor>>();
const runsOf = (name: string) => {
  if (!runCache.has(name)) runCache.set(name, runsFor(name));
  return runCache.get(name)!;
};

route('GET', '/v1/jobs', () => {
  gateJobs();
  return { jobs, limit: 50, offset: 0, next_offset: -1, total: jobs.length };
});

route('GET', '/v1/jobs/{name}', ({ params }) => {
  gateJobs();
  const j = jobs.find((x) => x.name === params.name);
  if (!j) throw new Problem(404, 'job_not_found');
  return j;
});

route('GET', '/v1/jobs/{name}/runs', ({ params }) => {
  gateJobs();
  if (!jobs.some((j) => j.name === params.name)) throw new Problem(404, 'job_not_found');
  const runs = runsOf(params.name);
  return { runs, limit: 50, offset: 0, next_offset: -1, total: runs.length };
});

route('GET', '/v1/jobs/{name}/runs/{id}/tasks', ({ params }) => {
  gateJobs();
  const run = runsOf(params.name).find((r) => r.id === params.id);
  if (!run) throw new Problem(404, 'job_run_not_found');
  const tasks = Array.from({ length: Math.min(run.tasks, 12) }, (_, i) => ({
    run_id: run.id,
    task_index: i,
    status: TASK_STATES[i % TASK_STATES.length],
    attempt: i % 3 === 0 ? 2 : 1,
    instance_id: db.id(),
    started_at: db.iso(600_000),
    finished_at: db.iso(300_000),
  }));
  return { tasks, limit: 50, offset: 0, next_offset: -1, total: tasks.length };
});

route('GET', '/v1/jobs/{name}/runs/{id}/tasks/{idx}/logs', ({ params }) => {
  gateJobs();
  const idx = Number(params.idx);
  // Task 1 is truncated so the console's "log was cut" notice is reachable.
  const truncated = idx === 1;
  return {
    task_status: TASK_STATES[idx % TASK_STATES.length],
    log_content: Array.from(
      { length: truncated ? 12 : 6 },
      (_, n) => `[task ${idx}] step ${n + 1} complete`
    ).join('\n'),
    truncated,
    max_bytes: 65536,
  };
});

route('POST', '/v1/jobs/{name}/runs/{id}/cancel', ({ params }) => {
  gateJobs();
  const run = runsOf(params.name).find((r) => r.id === params.id);
  if (!run) throw new Problem(404, 'job_run_not_found');
  if (run.aggregate_status !== 'running' && run.aggregate_status !== 'queued') {
    throw new Problem(409, 'job_run_not_cancellable', 'The run has already finished.');
  }
  run.aggregate_status = 'cancelled';
  return { run, cancelled_at: new Date().toISOString() };
});

// --- Triggers ---------------------------------------------------------------
// Six kinds so every pill renders, one paused, and a spread of record states
// and dead-letter reasons so each filter has something to find.
const triggerSeed = [
  { kind: 'cron', slug: 'nightly-report', enabled: true, config: { schedule: '0 3 * * *' } },
  {
    kind: 'kafka',
    slug: 'orders',
    enabled: true,
    config: { brokers: ['broker-1:9092'], topic: 'orders.v1', group: 'faas-orders' },
  },
  {
    kind: 'nats',
    slug: 'billing-events',
    enabled: false,
    config: { url: 'nats://nats:4222', stream: 'BILLING', subject: 'billing.>', durable: 'faas' },
  },
  {
    kind: 'redis_streams',
    slug: 'sessions',
    enabled: true,
    config: { addr: 'redis:6379', stream: 'sessions', group: 'faas' },
  },
  {
    kind: 'sqs_compat',
    slug: 'inbound-mail',
    enabled: true,
    config: { queue_url: 'http://sqs.local/q/mail', long_poll_secs: 20 },
  },
  { kind: 'queue', slug: 'delayed-tasks', enabled: true, config: { mode: 'delayed_task' } },
];

const triggers = triggerSeed.map((t, i) => ({
  id: db.id(),
  account_id: 'acct-1',
  app_id: db.apps[i % db.apps.length].id,
  kind: t.kind,
  slug: t.slug,
  enabled: t.enabled,
  config: t.config,
  batch_size_max: t.kind === 'cron' ? 1 : 500,
  batch_window_ms: t.kind === 'cron' ? 0 : 30000,
  max_attempts: 10,
  max_payload_bytes: 6 * 1024 * 1024,
  created_at: db.iso(0),
  updated_at: db.iso(0),
}));

const RECORD_STATES = ['pending', 'claimed', 'succeeded', 'retry', 'dead_letter'];
const DLQ_REASONS = ['max_attempts', 'poison_record', 'broker_error', 'rate_limited'];

route('GET', '/v1/triggers', ({ query }) => {
  const kind = query.get('kind');
  return triggers.filter((t) => !kind || t.kind === kind);
});

route('GET', '/v1/triggers/{id}', ({ params }) => {
  const t = triggers.find((x) => x.id === params.id);
  if (!t) throw new Problem(404, 'trigger_not_found');
  return t;
});

route('POST', '/v1/triggers/{id}/pause', ({ params }) => {
  const t = triggers.find((x) => x.id === params.id);
  if (!t) throw new Problem(404, 'trigger_not_found');
  t.enabled = false;
  return NO_CONTENT;
});

route('POST', '/v1/triggers/{id}/resume', ({ params }) => {
  const t = triggers.find((x) => x.id === params.id);
  if (!t) throw new Problem(404, 'trigger_not_found');
  t.enabled = true;
  return NO_CONTENT;
});

route('GET', '/v1/triggers/{id}/metrics', ({ params }) => ({
  trigger_id: params.id,
  pending_count: 4,
  claimed_count: 1,
  succeeded_count: 1284,
  retry_count: 3,
  dead_letter_count: 2,
}));

route('GET', '/v1/triggers/{id}/records', ({ params, query }) => {
  const want = query.get('state');
  const records = RECORD_STATES.flatMap((state, i) =>
    Array.from({ length: state === 'succeeded' ? 3 : 1 }, (_, n) => ({
      id: db.id(),
      trigger_id: params.id,
      item_identifier: `orders.v1@${4200 + i * 10 + n}`,
      payload: JSON.stringify({ order: 1000 + i, total_cents: 4200 + i }),
      headers: JSON.stringify({ 'content-type': 'application/json' }),
      metadata: JSON.stringify({ delivery_count: state === 'retry' ? 3 : 1 }),
      state,
      attempts: state === 'retry' ? 3 : state === 'dead_letter' ? 10 : 1,
      next_fire_at: db.iso(0),
      received_at: db.iso(i * 900_000),
      last_error: state === 'retry' || state === 'dead_letter' ? 'handler returned 500' : undefined,
      last_dispatched_at: state === 'pending' ? undefined : db.iso(i * 800_000),
    }))
  );
  return { records: records.filter((r) => !want || r.state === want) };
});

route('GET', '/v1/triggers/{id}/dlq', ({ params, query }) => {
  const want = query.get('reason');
  const records = DLQ_REASONS.map((reason, i) => ({
    record_id: db.id(),
    trigger_id: params.id,
    reason,
    routed_to: reason === 'poison_record' ? 'drop' : 'manual_retry',
    detail:
      reason === 'broker_error'
        ? { broker: 'broker-1:9092', error: 'connection reset by peer' }
        : { attempts: 10, last_status: 500 },
    created_at: db.iso(i * 3_600_000),
  }));
  return { records: records.filter((r) => !want || r.reason === want) };
});

// Retry mirrors the real contract: only a record in retry or dead_letter can
// be re-driven, everything else answers 409 trigger_dlq_retry_failed. The
// console decides from the record's state, so this is the backstop for the
// dead-letter list, where the state is implied rather than shown.
const retriedRecords = new Set<string>();

route('POST', '/v1/triggers/{id}/records/{rid}/retry', ({ params }) => {
  if (retriedRecords.has(params.rid)) {
    throw new Problem(
      409,
      'trigger_dlq_retry_failed',
      'Record state was not retry or dead_letter.'
    );
  }
  retriedRecords.add(params.rid);
  return NO_CONTENT;
});

route('POST', '/v1/triggers/{id}/records/{rid}/drop', () => NO_CONTENT);

route('GET', '/v1/crons', () => db.crons);
route('POST', '/v1/crons', ({ body }) => {
  const a = db.apps.find((x) => x.id === body.app_id);
  if (!a) throw new Problem(404, 'app_not_found', 'No app with that id.');
  const schedule = String(body.schedule ?? '').trim();
  if (schedule.split(/\s+/).length !== 5)
    throw new Problem(
      400,
      'invalid_schedule',
      'A schedule has five fields: minute hour day month weekday.'
    );
  const cron = {
    id: db.id(),
    app_id: a.id,
    schedule,
    path: String(body.path ?? '/'),
    enabled: body.enabled !== false,
    timezone: String(body.timezone ?? 'UTC'),
    skip_if_running: body.skip_if_running === true,
    created_at: db.iso(0),
    last_fired_at: null,
  };
  db.crons.push(cron);
  db.cronRuns.set(cron.id, []);
  return status(201, cron);
});
route('PATCH', '/v1/crons/{id}', ({ params, body }) => {
  const c = db.crons.find((x) => x.id === params.id);
  if (!c) throw new Problem(404, 'cron_not_found');
  if (typeof body.schedule === 'string') c.schedule = body.schedule;
  if (typeof body.path === 'string') c.path = body.path;
  if (typeof body.enabled === 'boolean') c.enabled = body.enabled;
  return c;
});
route('GET', '/v1/crons/{id}/runs', ({ params }) => {
  if (!db.crons.some((x) => x.id === params.id)) throw new Problem(404, 'cron_not_found');
  return { runs: db.cronRuns.get(params.id) ?? [] };
});
route('DELETE', '/v1/crons/{id}', ({ params }) => {
  const i = db.crons.findIndex((c) => c.id === params.id);
  if (i < 0) throw new Problem(404, 'cron_not_found');
  db.crons.splice(i, 1);
  return NO_CONTENT;
});
route('POST', '/v1/crons/{id}/run', ({ params }) => {
  const c = db.crons.find((x) => x.id === params.id);
  if (!c) throw new Problem(404, 'cron_not_found');
  c.last_fired_at = db.iso(0);
  return status(202, { request_id: db.id(), cron_id: c.id, status: 'pending' });
});

route('GET', '/v1/keys', () => db.keys.map(({ plaintext: _omit, ...k }) => k));
route('POST', '/v1/keys', ({ body }) => {
  const created: (typeof db.keys)[number] = {
    id: db.id(),
    org_id: db.ORG_ID,
    prefix: `grg_live_${db.id().slice(0, 4)}`,
    label: String(body.label ?? 'Untitled key'),
    scopes: (Array.isArray(body.scopes)
      ? body.scopes
      : ['apps:read']) as (typeof db.keys)[number]['scopes'],
    last_used_at: null,
    created_at: db.iso(0),
    status: 'active',
  };
  db.keys.push(created);
  return status(201, { ...created, plaintext: `${created.prefix}_${db.id()}` });
});
route('DELETE', '/v1/keys/{id}', ({ params }) => {
  const i = db.keys.findIndex((k) => k.id === params.id);
  if (i < 0) throw new Problem(404, 'key_not_found');
  db.keys.splice(i, 1);
  return NO_CONTENT;
});
route('POST', '/v1/keys/{id}/rotate', ({ params }) => {
  const old = db.keys.find((k) => k.id === params.id);
  if (!old) throw new Problem(404, 'key_not_found');
  old.status = 'grace';
  old.expires_at = db.iso(-24 * 3_600_000);
  const key: (typeof db.keys)[number] = {
    ...old,
    id: db.id(),
    prefix: `grg_live_${db.id().slice(0, 4)}`,
    status: 'active',
    expires_at: null,
    created_at: db.iso(0),
    rotated_from_id: old.id,
  };
  db.keys.push(key);
  return {
    key,
    key_plaintext: `${key.prefix}_${db.id()}`,
    old_key_id: old.id,
    old_key_expires_at: old.expires_at,
  };
});

route('GET', '/v1/edge-rules', () => db.edgeRules);
route('GET', '/v1/apps/{slug}/edge-rules', ({ params }) => {
  const a = app(params.slug);
  return db.edgeRules.filter((r) => r.app_id === a.id);
});

/** jwt and ip are paid; geo is allowed on free with a tighter quota. */
const PAID_KINDS = new Set(['jwt', 'ip']);
const QUOTA_PER_APP = 12;
const FREE_GEO_QUOTA = 2;

route('POST', '/v1/apps/{slug}/edge-rules', ({ params, body }) => {
  const a = app(params.slug);
  const kind = String(body.kind ?? '');
  if (!kind) throw new Problem(400, 'rule_invalid', 'A kind is required.');

  if (PAID_KINDS.has(kind) && db.account.plan === 'free')
    throw new Problem(402, 'plan_edge_rule_kind_not_allowed', `${kind} rules need a paid plan.`);

  const onApp = db.edgeRules.filter((r) => r.app_id === a.id);
  if (onApp.length >= QUOTA_PER_APP)
    throw new Problem(
      402,
      'plan_limit_edge_rules',
      `This app is at its limit of ${QUOTA_PER_APP} edge rules.`
    );
  if (
    kind === 'geo' &&
    db.account.plan === 'free' &&
    onApp.filter((r) => r.kind === 'geo').length >= FREE_GEO_QUOTA
  )
    throw new Problem(
      402,
      'plan_limit_edge_rules',
      `Free plans allow ${FREE_GEO_QUOTA} geo rules per app.`
    );

  // The API documents `edge_rule_conflict` for "duplicate or overlapping rule
  // state" without saying what overlaps. A same-priority, same-host, same-path
  // pair is the clearest case and is what this mock rejects, so the console's
  // 409 branch has something to render — the real predicate may be broader.
  if (
    onApp.some(
      (r) =>
        r.priority === Number(body.priority) &&
        r.match_host === String(body.match_host ?? '') &&
        r.match_path === String(body.match_path ?? '')
    )
  )
    throw new Problem(
      409,
      'edge_rule_conflict',
      'Another rule already has that priority for this host and path.'
    );

  const rule = {
    id: db.id(),
    account_id: db.ACCOUNT_ID,
    app_id: a.id,
    match_host: String(body.match_host ?? ''),
    match_path: String(body.match_path ?? '/*'),
    match_methods: Array.isArray(body.match_methods) ? (body.match_methods as string[]) : [],
    priority: Number(body.priority ?? 100),
    enabled: body.enabled !== false,
    kind: kind as (typeof db.edgeRules)[number]['kind'],
    validate_mode: (body.validate_mode ??
      'block') as (typeof db.edgeRules)[number]['validate_mode'],
    action: body.action as (typeof db.edgeRules)[number]['action'],
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  db.edgeRules.push(rule);
  return status(201, rule);
});

route('PATCH', '/v1/edge-rules/{id}', ({ params, body }) => {
  const rule = db.edgeRules.find((r) => r.id === params.id);
  if (!rule) throw new Problem(404, 'edge_rule_not_found');
  // Rotating kind would break the action union; the spec says recreate.
  if ('kind' in body && body.kind && body.kind !== rule.kind)
    throw new Problem(
      422,
      'rule_invalid',
      'Kind cannot be changed. Delete the rule and create a new one.'
    );
  for (const k of ['match_host', 'match_path', 'match_methods', 'priority', 'enabled'] as const)
    if (k in body && body[k] != null) (rule as Record<string, unknown>)[k] = body[k];
  // `action` replaces whole — there is no partial shape for it.
  if (body.action) rule.action = body.action as typeof rule.action;
  rule.updated_at = db.iso(0);
  return rule;
});

route('GET', '/v1/apps/{slug}/throttle-suggestions', ({ params, query }) => {
  const a = app(params.slug);
  const range = String(query.get('range') ?? '5m');
  if (!a.route_metrics_enabled)
    return {
      app_id: a.id,
      range,
      source: 'prometheus',
      as_of: db.iso(0),
      route_metrics_disabled: true,
      routes_collapsed: 0,
      plan_ceiling_rps: 500,
      plan_ceiling_burst: 1000,
      multiplier: 1.5,
      suggestions: [],
    };
  const routes = db
    .routesFor(a)
    .routes.filter((r) => !r.includes('*'))
    .slice(0, 5);
  return {
    app_id: a.id,
    range,
    source: 'prometheus',
    as_of: db.iso(0),
    route_metrics_disabled: false,
    routes_collapsed: 0,
    plan_ceiling_rps: 500,
    plan_ceiling_burst: 1000,
    multiplier: 1.5,
    suggestions: routes.map((route, i) => {
      const observed = Number((12 / (i + 1)).toFixed(1));
      const suggested = Math.min(500, Math.max(1, Math.ceil(observed * 1.5)));
      return {
        route,
        observed_rps: observed,
        suggested_rps: suggested,
        suggested_burst: Math.min(1000, suggested * 2),
      };
    }),
  };
});
route('DELETE', '/v1/edge-rules/{id}', ({ params }) => {
  const i = db.edgeRules.findIndex((r) => r.id === params.id);
  if (i < 0) throw new Problem(404, 'edge_rule_not_found');
  db.edgeRules.splice(i, 1);
  return NO_CONTENT;
});

route('GET', '/v1/invocations', ({ query }) => ({
  invocations: db.invocations.slice(0, Number(query.get('limit') ?? 50)),
}));
route('GET', '/v1/invocations/{id}', ({ params }) => {
  const inv = db.invocations.find((x) => x.id === params.id);
  if (!inv) throw new Problem(404, 'invocation_not_found');
  return inv;
});
route('POST', '/v1/invocations/{id}/replay', ({ params }) => {
  const inv = db.invocations.find((x) => x.id === params.id);
  if (!inv) throw new Problem(404, 'invocation_not_found');
  const replay = {
    ...inv,
    id: db.id(),
    source: 'replay' as const,
    state: 'pending' as const,
    created_at: db.iso(0),
    completed_at: null,
    last_error: null,
    attempts: 0,
  };
  db.invocations.unshift(replay);
  return status(202, { id: replay.id, status_url: `/v1/invocations/${replay.id}` });
});

route('GET', '/v1/instances', () => ({ instances: db.instances, next_before: null }));
route('GET', '/v1/audit-log', ({ query }) => {
  const limit = Number(query.get('limit') ?? 50);
  return { entries: db.audit.slice(0, limit), limit };
});

route('GET', '/v1/usage/summary', () => db.usage);
route('GET', '/v1/usage/storage', () => ({ items: db.storage }));
route('GET', '/v1/invoices', () => ({ items: db.invoices, next_before: null }));
route('GET', '/v1/billing/portal', () => db.billingPortal);

route('GET', '/v1/orgs', () => ({ orgs: db.orgs }));
route('GET', '/v1/orgs/{slug}/members', () => ({ members: db.members }));
route('GET', '/v1/orgs/{slug}/invitations', () => ({ invitations: db.invitations }));
route('POST', '/v1/orgs/{slug}/members', ({ params, body }) => {
  const org = db.orgs.find((o) => o.slug === params.slug);
  if (!org) throw new Problem(404, 'org_not_found');
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  if (!email.includes('@'))
    throw new Problem(400, 'invalid_email', 'That does not look like an email address.');
  if (db.members.some((m) => m.email === email))
    throw new Problem(409, 'already_member', `${email} is already a member.`);
  const inv: (typeof db.invitations)[number] = {
    id: db.id(),
    org_id: org.id,
    org_slug: org.slug,
    email,
    role: (body.role ?? 'developer') as (typeof db.invitations)[number]['role'],
    status: 'pending',
    expires_at: db.iso(-7 * 24 * 3_600_000),
    created_at: db.iso(0),
  };
  db.invitations.unshift(inv);
  // The plaintext token is returned exactly once, like a minted API key.
  return status(201, { ...inv, token: `inv_${db.id()}` });
});
route('PATCH', '/v1/orgs/{slug}/members/{user_id}', ({ params, body }) => {
  const m = db.members.find((x) => x.account_id === params.user_id);
  if (!m) throw new Problem(404, 'member_not_found');
  if (m.role === 'owner')
    throw new Problem(409, 'cannot_change_owner_role', 'Transfer ownership instead.');
  m.role = body.role as typeof m.role;
  return m;
});
route('DELETE', '/v1/orgs/{slug}/members/{user_id}', ({ params }) => {
  const i = db.members.findIndex((x) => x.account_id === params.user_id);
  if (i < 0) throw new Problem(404, 'member_not_found');
  if (db.members[i].role === 'owner')
    throw new Problem(409, 'cannot_remove_owner', 'Transfer ownership first.');
  db.members.splice(i, 1);
  return NO_CONTENT;
});
route('DELETE', '/v1/orgs/{slug}/invitations/{token}', ({ params }) => {
  const inv = db.invitations.find((x) => x.id === params.token);
  if (!inv) throw new Problem(404, 'invitation_not_found');
  inv.status = 'revoked';
  return NO_CONTENT;
});

const hex = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');

// --- GitHub installation repos + app binding ---
route('POST', '/v1/install/repos/list', () => [
  { id: 1001, full_name: 'acme-corp/storefront', default_branch: 'main', private: true },
  { id: 1002, full_name: 'acme-corp/checkout', default_branch: 'main', private: true },
  { id: 1003, full_name: 'acme-corp/webhook-router', default_branch: 'master', private: false },
  { id: 1004, full_name: 'acme-corp/nightly-etl', default_branch: 'main', private: true },
]);
route('POST', '/v1/apps/{slug}/install/bind', async ({ body }) => ({
  binding_id: hex(32),
  repo_full_name: String(body.repo_full_name ?? ''),
  production_branch: String(body.production_branch ?? 'main'),
}));

// --- Organisations, org keys, invitations ---
route('GET', '/v1/orgs/{slug}', ({ params }) => ({
  id: hex(32),
  slug: params.slug,
  name: 'Acme Corp',
  personal: false,
  plan: db.account.plan,
  status: 'active',
  created_at: db.iso(200 * 24),
  updated_at: db.iso(2 * 24),
}));
route('PATCH', '/v1/orgs/{slug}', async ({ params, body }) => ({
  id: hex(32),
  slug: params.slug,
  name: String(body.name ?? 'Acme Corp'),
  personal: false,
  plan: String(body.plan ?? db.account.plan),
  status: 'active',
  created_at: db.iso(200 * 24),
  updated_at: new Date().toISOString(),
}));
route('DELETE', '/v1/orgs/{slug}', () => ({}));
route('GET', '/v1/orgs/{slug}/seat_usage', () => ({ used: 3, limit: 5, plan: db.account.plan }));
route('POST', '/v1/orgs/{slug}/transfer_ownership', ({ params }) => ({
  id: hex(32),
  slug: params.slug,
  name: 'Acme Corp',
  personal: false,
  plan: db.account.plan,
  status: 'active',
  created_at: db.iso(200 * 24),
  updated_at: new Date().toISOString(),
}));
const orgKeys: Record<string, unknown>[] = [
  {
    id: hex(32),
    org_id: hex(32),
    prefix: 'gk_org_a1b2',
    label: 'ci-deploy',
    scopes: ['deploy:write', 'apps:read'],
    last_used_at: db.iso(5),
    created_at: db.iso(90 * 24),
    expires_at: null,
    status: 'active',
    revoked_at: null,
    rotated_from_id: null,
  },
];
route('GET', '/v1/orgs/{slug}/keys', () => ({ keys: orgKeys }));
route('POST', '/v1/orgs/{slug}/keys', async ({ body }) => {
  const key = {
    id: hex(32),
    org_id: hex(32),
    prefix: `gk_org_${hex(4)}`,
    label: String(body.label ?? ''),
    scopes: body.scopes ?? [],
    last_used_at: null,
    created_at: new Date().toISOString(),
    expires_at: null,
    status: 'active',
    revoked_at: null,
    rotated_from_id: null,
    plaintext: `gk_org_${hex(28)}`,
  };
  orgKeys.unshift(key);
  return status(201, key);
});
route('DELETE', '/v1/orgs/{slug}/keys/{id}', ({ params }) => {
  const i = orgKeys.findIndex((k) => k.id === params.id);
  if (i >= 0) orgKeys.splice(i, 1);
  return {};
});
route('POST', '/v1/orgs/{slug}/keys/{id}/rotate', ({ params }) => ({
  key: orgKeys[0],
  key_plaintext: `gk_org_${hex(28)}`,
  old_key_id: params.id,
  old_key_expires_at: new Date(Date.now() + 7 * 86400e3).toISOString(),
}));
route('GET', '/v1/invitations/{token}', ({ params }) => ({
  id: hex(32),
  org_id: hex(32),
  org_slug: 'acme-corp',
  email: 'new-teammate@acme-corp.dev',
  role: 'developer',
  status: params.token === 'used' ? 'accepted' : 'pending',
  expires_at: new Date(Date.now() + 6 * 86400e3).toISOString(),
  created_at: db.iso(24),
}));
route('POST', '/v1/invitations/{token}/accept', () => ({
  account_id: hex(32),
  email: 'new-teammate@acme-corp.dev',
  role: 'developer',
  joined_at: new Date().toISOString(),
}));
// The real route double-submits a purpose-bound token (ADR-140): the
// console mints it from /v1/auth/csrf and posts it back as `csrf_token`.
// The mock keeps that shape so a wizard that forgets the token fails here
// the same way it would against apid, with a 400 rather than a 302.
const MOCK_CSRF_ACTIONS = new Set([
  'auth.logout',
  'auth.session.revoke',
  'auth.sessions.revoke_all',
  'mfa_confirm',
  'mfa_recover',
  'mfa_disable',
  'set_password',
]);
route('GET', '/v1/auth/csrf', ({ query, res }) => {
  const action = query.get('action') ?? '';
  if (!MOCK_CSRF_ACTIONS.has(action))
    throw new Problem(
      400,
      'validation_failed',
      'the requested action is not available to browser clients'
    );
  res.setHeader('Set-Cookie', CSRF_COOKIE);
  return { csrf_token: 'mock-csrf' };
});
// ADR-140 cohorts. The real server decides the proof from the account; the
// mock keeps just enough state to show each branch on demand.
const mockAuth = {
  password: process.env.MOCK_HAS_PASSWORD === '1' ? 'mock-current-password' : null,
  mfaEnrolled: process.env.MOCK_MFA === '1',
  mfaRequired: process.env.MOCK_MFA === 'required',
  steppedUpAt: 0,
};
const STEP_UP_TTL_MS = 5 * 60_000;

route('POST', '/v1/account/mfa/verify', ({ body }) => {
  if (!/^\d{6}$/.test(String(body.totp ?? '')))
    throw new Problem(401, 'mfa_invalid_code', 'the TOTP code did not match');
  mockAuth.steppedUpAt = Date.now();
  return { account_id: db.ACCOUNT_ID, mfa_pending: false };
});
route('POST', '/v1/account/mfa/enroll', () => ({
  otpauth_url: 'otpauth://totp/Gregale:design@gregale.dev?secret=JBSWY3DPEHPK3PXP&issuer=Gregale',
  secret: 'JBSWY3DPEHPK3PXP',
  qr_code_png_base64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  recovery_codes: [
    'MOCKRECOV1',
    'MOCKRECOV2',
    'MOCKRECOV3',
    'MOCKRECOV4',
    'MOCKRECOV5',
    'MOCKRECOV6',
    'MOCKRECOV7',
    'MOCKRECOV8',
    'MOCKRECOV9',
    'MOCKRECOV0',
  ],
}));
route('POST', '/v1/account/mfa/confirm', ({ body }) => {
  if (!/^\d{6}$/.test(String(body.totp ?? '')))
    throw new Problem(401, 'mfa_invalid_code', 'the TOTP code did not match');
  mockAuth.mfaEnrolled = true;
  mockAuth.mfaRequired = false;
  mockAuth.steppedUpAt = Date.now();
  return {};
});
route('POST', '/dashboard/account/set-password', ({ body, res }) => {
  if (body.csrf_token !== 'mock-csrf')
    throw new Problem(400, 'validation_failed', 'Invalid CSRF token');
  const next = String(body.password ?? '');
  if (next.length < 12)
    throw new Problem(400, 'password_too_weak', 'Password must be at least 12 characters.');
  const fresh = Date.now() - mockAuth.steppedUpAt < STEP_UP_TTL_MS;
  if (!fresh) {
    if (mockAuth.mfaRequired && !mockAuth.mfaEnrolled)
      throw new Problem(403, 'mfa_required', 'enable two-factor authentication to continue');
    if (mockAuth.mfaEnrolled)
      throw new Problem(403, 'step_up_required', 'verify your authenticator first');
    if (mockAuth.password !== null && body.current_password !== mockAuth.password)
      throw new Problem(401, 'invalid_credentials', 'Email or password is incorrect.');
  }
  mockAuth.password = next;
  res.setHeader('location', '/dashboard/account');
  return status(302, '');
});

// --- Billing & account controls ---
route('POST', '/v1/account/overage-cap', () => ({ ...db.account, app_count: db.apps.length }));
route('POST', '/v1/billing/cancel', () => ({
  cancel_scheduled: true,
  effective_at: new Date(Date.now() + 19 * 86400e3).toISOString(),
}));
route('POST', '/v1/billing/retry', () => ({
  attempt_id: `att_${hex(8)}`,
  provider_ref_id: `txn_${hex(8)}`,
  status: 'submitted',
  next_billing_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
}));
route('GET', '/v1/account/export', () => ({
  exported_at: new Date().toISOString(),
  account: db.account,
  apps: db.apps,
  deployments: db.deployments,
  builds: db.builds,
  instances: db.instances,
  usage: [],
  domains: db.domains,
  crons: db.crons,
  api_keys: db.keys ?? [],
}));
route('POST', '/v1/account/restore', () => ({ ...db.account, app_count: db.apps.length }));
let graceDays = 7;
route('GET', '/v1/account/keys/grace_window_days', () => ({ days: graceDays, plan_default: 7 }));
route('PATCH', '/v1/account/keys/grace_window_days', async ({ body }) => {
  graceDays = Number(body.days ?? graceDays);
  return { days: graceDays, plan_default: 7 };
});
let egressExtra = 0;
route('GET', '/v1/account/egress_allowlist_extra', () => ({
  extra: egressExtra,
  plan_cap: 8,
  max_extra: 32,
}));
route('PATCH', '/v1/account/egress_allowlist_extra', async ({ body }) => {
  egressExtra = Number(body.extra ?? egressExtra);
  return { extra: egressExtra, plan_cap: 8, max_extra: 32 };
});
route('GET', '/v1/usage', () =>
  db.apps.slice(0, 6).map((a, i) => ({
    app_id: a.id,
    mb_seconds: Math.round((i + 1) * 3.7e8),
    requests: Math.round((6 - i) * 140_000),
    included_gb_hours: 2000,
    cpu_usec: Math.round((i + 1) * 9e9),
    tx_bytes: Math.round((i + 1) * 4.1e9),
    net_tx_bytes: Math.round((i + 1) * 1.2e9),
    net_rx_bytes: Math.round((i + 1) * 0.8e9),
    cold_boots: (i + 1) * 12,
  }))
);

// --- Supply chain & secrets hygiene ---
const trustedSigners = new Map<
  string,
  { name: string; public_key_pem: string; added_at: string; added_by: string }[]
>();
route('PATCH', '/v1/apps/{slug}/security', async ({ params, body }) => {
  const a = db.apps.find((x) => x.slug === params.slug);
  if (a) (a as unknown as Record<string, unknown>).require_signed = Boolean(body.require_signed);
  return { require_signed: Boolean(body.require_signed) };
});
route('GET', '/v1/apps/{slug}/trusted_signers', ({ params }) => ({
  signers: trustedSigners.get(params.slug) ?? [
    {
      name: 'release-ci',
      public_key_pem: '-----BEGIN PUBLIC KEY-----…',
      added_at: new Date(Date.now() - 12 * 86400e3).toISOString(),
      added_by: 'demo@acme-corp.dev',
    },
  ],
}));
route('PUT', '/v1/apps/{slug}/trusted_signers/{name}', async ({ params, body }) => {
  const list = trustedSigners.get(params.slug) ?? [
    {
      name: 'release-ci',
      public_key_pem: '-----BEGIN PUBLIC KEY-----…',
      added_at: new Date(Date.now() - 12 * 86400e3).toISOString(),
      added_by: 'demo@acme-corp.dev',
    },
  ];
  const entry = {
    name: params.name,
    public_key_pem: String(body.public_key_pem ?? ''),
    added_at: new Date().toISOString(),
    added_by: 'demo@acme-corp.dev',
  };
  trustedSigners.set(params.slug, [...list.filter((x) => x.name !== params.name), entry]);
  return entry;
});
route('DELETE', '/v1/apps/{slug}/trusted_signers/{name}', ({ params }) => {
  const list = trustedSigners.get(params.slug) ?? [];
  trustedSigners.set(
    params.slug,
    list.filter((x) => x.name !== params.name)
  );
  return {};
});
route('POST', '/v1/apps/{slug}/secrets/{key}/rotate', ({ params }) => ({
  key: params.key,
  rotated_at: new Date().toISOString(),
  kid: `kid_${hex(6)}`,
}));
route('GET', '/v1/secrets', () => ({
  secrets: db.apps.slice(0, 4).flatMap((a, i) => [
    {
      app_id: a.id,
      app_slug: a.slug,
      key: 'DATABASE_URL',
      ciphertext: '***',
      created_at: db.iso((30 + i) * 24),
      updated_at: db.iso((3 + i) * 24),
    },
    ...(i % 2 === 0
      ? [
          {
            app_id: a.id,
            app_slug: a.slug,
            key: 'STRIPE_KEY',
            ciphertext: '***',
            created_at: db.iso(60 * 24),
            updated_at: db.iso(45 * 24),
          },
        ]
      : []),
  ]),
  next_before: null,
}));

// --- Scheduling: delayed tasks (session-tracked) + cron fire-now state ---
const delayedTasks = new Map<string, { id: string; scheduled_at: string; state: string }>();
route('POST', '/v1/apps/{slug}/delayed-tasks', async ({ body }) => {
  const id = `dt_${hex(10)}`;
  const t = {
    id,
    scheduled_at: String(body.scheduled_at ?? new Date().toISOString()),
    state: 'pending',
  };
  delayedTasks.set(id, t);
  return t;
});
route('GET', '/v1/delayed-tasks/{id}', ({ params, res }) => {
  const t = delayedTasks.get(params.id);
  if (!t) {
    res.statusCode = 404;
    return { type: 'about:blank', title: 'not found', code: 'not_found' };
  }
  if (t.state === 'pending' && Date.parse(t.scheduled_at) < Date.now()) t.state = 'completed';
  return t;
});
route('DELETE', '/v1/delayed-tasks/{id}', ({ params }) => {
  const t = delayedTasks.get(params.id);
  if (t) t.state = 'cancelled';
  return {};
});
const fireRequests = new Map<string, number>();
route('GET', '/v1/cron-fire-now-requests/{request_id}', ({ params }) => {
  const started = fireRequests.get(params.request_id) ?? Date.now();
  fireRequests.set(params.request_id, started);
  const done = Date.now() - started > 4000;
  return {
    request_id: params.request_id,
    cron_id: db.crons[0]?.id ?? 'cron_1',
    status: done ? 'completed' : 'running',
    requested_at: new Date(started).toISOString(),
    finished_at: done ? new Date().toISOString() : null,
    invocation_id: done ? `inv_${hex(8)}` : null,
    error: '',
    account_id: db.account.id,
  };
});

// --- Observability: error groups, wake timelines, diff preview, build
// provenance, secret scan, auth audit events. ---
const ERR_FP = 'fp_5c1a9b2e77d34fa0';
route('GET', '/v1/apps/{slug}/errors/summary', ({ params }) => {
  const a = db.apps.find((x) => x.slug === params.slug);
  const failing = a?.status === 'error';
  return {
    generated_at: new Date().toISOString(),
    app_id: a?.id ?? 'unknown',
    app_slug: params.slug,
    window_start: new Date(Date.now() - 24 * 3600e3).toISOString(),
    window_end: new Date().toISOString(),
    window_clamped: false,
    items: failing
      ? [
          {
            fingerprint: ERR_FP,
            error_class: 'TypeError',
            route: 'POST /v1/reconcile',
            http_status: 500,
            count: 412,
            request_count: 2001,
            first_seen_at: new Date(Date.now() - 5 * 3600e3).toISOString(),
            last_seen_at: new Date(Date.now() - 120e3).toISOString(),
            sample_message: "Cannot read properties of undefined (reading 'invoice_id')",
          },
          {
            fingerprint: 'fp_88d0c4a1b52e9f13',
            error_class: 'TimeoutError',
            route: 'GET /v1/reports/daily',
            http_status: 504,
            count: 37,
            request_count: 400,
            first_seen_at: new Date(Date.now() - 20 * 3600e3).toISOString(),
            last_seen_at: new Date(Date.now() - 3600e3).toISOString(),
            sample_message: 'upstream ledger did not answer within 10s',
          },
        ]
      : [],
    next_cursor: null,
    limit: 50,
  };
});
route('GET', '/v1/apps/{slug}/errors/{fingerprint}', ({ params }) => ({
  fingerprint: params.fingerprint,
  error_class: 'TypeError',
  route: 'POST /v1/reconcile',
  http_status: 500,
  requests: Array.from({ length: 6 }, (_, i) => ({
    request_id: `req_${hex(8)}`,
    received_at: new Date(Date.now() - (i + 1) * 900e3).toISOString(),
    route: 'POST /v1/reconcile',
    http_status: 500,
    error_class: 'TypeError',
    sample_message: "Cannot read properties of undefined (reading 'invoice_id')",
    deployment_id: db.deployments[0]?.id ?? null,
  })),
  next_cursor: null,
}));
route('GET', '/v1/apps/{slug}/errors/{fingerprint}/first', () => ({
  request_id: `req_${hex(8)}`,
  received_at: new Date(Date.now() - 5 * 3600e3).toISOString(),
  route: 'POST /v1/reconcile',
  http_status: 500,
  error_class: 'TypeError',
  sample_message:
    "Cannot read properties of undefined (reading 'invoice_id') at reconcile (/app/dist/worker.js:214:31)",
  deployment_id: db.deployments[0]?.id ?? null,
  headers_sample: {
    'content-type': 'application/json',
    'user-agent': 'stripe-webhooks/2.1',
    'x-request-id': hex(12),
  },
  redactions_applied: ['authorization', 'cookie'],
}));
route('GET', '/v1/apps/{slug}/wakes/{wake_id}/timeline', ({ params }) => {
  const t0 = Date.now() - 3600e3;
  const frames: [number, string][] = [
    [0, 'wake.requested'],
    [4, 'admission.granted'],
    [9, 'snapshot.located'],
    [31, 'restore.started'],
    [212, 'restore.completed'],
    [219, 'resume_hook.entropy_reseeded'],
    [224, 'resume_hook.clock_stepped'],
    [281, 'healthz.first_probe'],
    [304, 'ready'],
  ];
  return {
    wake_id: params.wake_id,
    app_id: db.apps[0]?.id ?? 'unknown',
    events: frames.map(([dt, kind]) => ({
      at: new Date(t0 + dt).toISOString(),
      kind,
      actor: 'schedd',
      data: {},
    })),
    next_cursor: '',
    limit: 100,
  };
});
route('POST', '/v1/apps/{slug}/diff', async ({ params, body }) => {
  const cfg = (body.app_config ?? {}) as Record<string, unknown>;
  const a = db.apps.find((x) => x.slug === params.slug);
  const changes = Object.entries(cfg).map(([field, after]) => ({
    field,
    kind: 'modify',
    before: String((a as Record<string, unknown> | undefined)?.[field] ?? '—'),
    after: String(Array.isArray(after) ? after.join(',') : after),
  }));
  return {
    slug: params.slug,
    plan: db.account.plan,
    blocking: false,
    diff: {
      slug: params.slug,
      plan: db.account.plan,
      changes,
      breaks:
        cfg.ram_mb && Number(cfg.ram_mb) < (a?.ram_mb ?? 0)
          ? ['Shrinking memory invalidates the warm snapshot; the next wake cold-boots.']
          : [],
    },
  };
});
route('GET', '/v1/builds/{id}/provenance', ({ params }) => ({
  id: `prov_${hex(6)}`,
  build_id: params.id,
  buildkit_version: 'v0.17.2',
  railpack_version: '0.9.4',
  base_digest: 'sha256:' + hex(16),
  source_sha256: hex(16),
  source_url: '',
  commit_sha: hex(20),
  plan: 'railpack-node',
  runner_digest: 'sha256:' + hex(16),
  builder_node_id: 'fra-metal-1',
  started_at: new Date(Date.now() - 7200e3).toISOString(),
  finished_at: new Date(Date.now() - 7100e3).toISOString(),
  sbom_storage_key: 'sbom/' + params.id,
  framework_version: '22.12.0',
}));
route('GET', '/v1/deployments/{id}/secret-scan', () => ({
  status: 'complete',
  scanned_at: new Date(Date.now() - 7000e3).toISOString(),
  image_digest: 'sha256:' + hex(16),
  findings: [],
  error: '',
}));
route('GET', '/v1/audit-events', () => ({
  events: [
    {
      id: hex(12),
      at: new Date(Date.now() - 600e3).toISOString(),
      actor: 'demo@acme-corp.dev',
      kind: 'session.signed_in',
      subject: 'google-oauth',
      severity: 'info',
      data: {},
    },
    {
      id: hex(12),
      at: new Date(Date.now() - 86400e3).toISOString(),
      actor: 'demo@acme-corp.dev',
      kind: 'api_key.minted',
      subject: 'ci-deploy',
      severity: 'info',
      data: {},
    },
    {
      id: hex(12),
      at: new Date(Date.now() - 2 * 86400e3).toISOString(),
      actor: 'demo@acme-corp.dev',
      kind: 'login.failed_password',
      subject: '203.0.113.7',
      severity: 'warn',
      data: {},
    },
  ],
  limit: 50,
}));

// --- Project import (scan/apply). The dev mock cannot untar a real upload,
// so the scan answers a canned Kubernetes-flavoured plan and apply echoes
// the applied set; the fixture fleet itself stays static. ---
const MOCK_PLAN = {
  project_slug: 'acme-shop',
  scan_source: 'k8s',
  tier: 'workspace',
  workloads: [
    {
      name: 'storefront',
      root_dir: 'apps/storefront',
      command: ['node', 'server.js'],
      class: 'http',
      ports: [8080],
      env_keys: ['DATABASE_URL', 'STRIPE_KEY'],
      source: 'k8s: deployment.yaml',
      tier: 'workspace',
    },
    {
      name: 'checkout-api',
      root_dir: 'apps/checkout',
      command: ['/app/bin/server'],
      class: 'grpc',
      ports: [50051],
      env_keys: ['DATABASE_URL'],
      source: 'k8s: deployment.yaml',
      tier: 'workspace',
    },
    {
      name: 'nightly-report',
      root_dir: 'jobs/report',
      command: ['python', '-m', 'report'],
      class: 'job',
      schedule: '0 3 * * *',
      ports: [],
      source: 'k8s: cronjob.yaml',
      tier: 'workspace',
    },
  ],
  managed: [
    {
      name: 'postgres',
      kind: 'postgres',
      env_hint: 'DATABASE_URL',
      source: 'k8s: statefulset.yaml',
      image: 'postgres:16',
    },
    {
      name: 'redis',
      kind: 'redis',
      env_hint: 'REDIS_URL',
      source: 'k8s: deployment.yaml',
      image: 'redis:7',
    },
  ],
  crons: [{ workload_name: 'nightly-report', schedule: '0 3 * * *', path: '/', enabled: true }],
  warnings: ['Ingress annotations were ignored — routing is configured per app after apply.'],
  observed_apps: 3,
  observed_crons: 1,
  limit_apps: 25,
  limit_crons: 20,
  can_apply: true,
  plan_token: 'mock-plan-token',
};

route('POST', '/v1/projects/scan', () => MOCK_PLAN);
route('POST', '/v1/projects', () => ({
  ...MOCK_PLAN,
  project_id: 'proj_mock01',
  apps: MOCK_PLAN.workloads
    .filter((w) => !w.schedule)
    .map((w, i) => ({ slug: w.name, id: `app_import_${i}` })),
  builds: [],
}));

// --- Plumbing ------------------------------------------------------------------

// JSON for the `/v1` surface; form-encoded for apid's own dashboard posts
// (`/login`, `/dashboard/account/set-password`), which the console submits
// the way a browser form would.
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      const type = String(req.headers['content-type'] ?? '');
      if (type.includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function problem(res: ServerResponse, p: Problem) {
  res.statusCode = p.status;
  res.setHeader('Content-Type', 'application/problem+json');
  res.end(
    JSON.stringify({
      type: 'about:blank',
      status: p.status,
      code: p.code,
      title: p.code.replace(/_/g, ' '),
      detail: p.detail,
    })
  );
}

const MOCKED_PREFIXES = ['/v1/', '/login', '/signup', '/dashboard/account/set-password'];

export function mockApi(): Plugin {
  return {
    name: 'gregale-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info(
        `  ➜  mock api: serving /v1/* from mock/ — no backend needed${db.EMPTY ? ' (empty workspace)' : ''}`
      );
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const method = req.method ?? 'GET';
        // GET /login and /signup are this app's own pages; only the POSTs are the API's.
        const isApi =
          url.pathname.startsWith('/v1/') ||
          (method !== 'GET' &&
            MOCKED_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p + '/')));
        if (!isApi) return next();

        const match = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
        if (!match) {
          server.config.logger.warn(`  mock api: no handler for ${method} ${url.pathname}`);
          return problem(
            res,
            new Problem(
              404,
              'not_mocked',
              `The mock API has no handler for ${method} ${url.pathname}.`
            )
          );
        }

        const values = url.pathname.match(match.pattern)!.slice(1).map(decodeURIComponent);
        const params = Object.fromEntries(match.keys.map((k, i) => [k, values[i]]));

        void (async () => {
          const body = method === 'GET' ? {} : await readBody(req);
          await new Promise((r) => setTimeout(r, latency()));
          try {
            const out = await match.handler({ params, query: url.searchParams, body, req, res });
            if (res.writableEnded || res.headersSent) return; // streaming handlers own the response
            if (out === NO_CONTENT) {
              res.statusCode = 204;
              res.end();
              return;
            }
            if (out && typeof out === 'object' && '__status' in out) {
              const s = out as { __status: number; body: unknown };
              return json(res, s.__status, s.body);
            }
            json(res, 200, out);
          } catch (err) {
            if (err instanceof Problem) return problem(res, err);
            server.config.logger.error(
              `  mock api: ${method} ${url.pathname} threw: ${String(err)}`
            );
            problem(res, new Problem(500, 'mock_error', String(err)));
          }
        })();
      });
    },
  };
}
