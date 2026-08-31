import type { components } from '../src/lib/api/schema';

/**
 * Fixture state for the dev-only mock API (see `plugin.ts`).
 *
 * Everything here is typed against the generated OpenAPI schema, so a field
 * the real server renames fails `tsc` here the same way it does in the app.
 * The generator is seeded, so every dev server boots into the same workspace
 * and a screenshot taken today matches one taken tomorrow. Mutations change
 * the in-memory state for the life of the server and nothing more.
 *
 * Not fixtures for the UI: nothing in `src/` imports this module, and the
 * plugin that serves it only exists under `MOCK_API=1`.
 */

type S = components['schemas'];

export type App = S['AppResponse'];
export type Deployment = S['DeploymentResponse'];
export type Build = S['BuildResponse'];

// --- Seeded randomness ------------------------------------------------------

let seed = 0x9e3779b9;
/** mulberry32 — tiny, deterministic, good enough for fixtures. */
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
const hex = (n: number) => Array.from({ length: n }, () => int(0, 15).toString(16)).join('');
export const id = () => hex(32);

/** Fixed "now" so relative timestamps stay stable across requests. */
export const NOW = Date.now();
const H = 3_600_000;
const D = 24 * H;
export const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

// --- Account -----------------------------------------------------------------

export const ACCOUNT_ID = id();
export const ORG_ID = id();

export const account: S['AccountResponse'] = {
  id: ACCOUNT_ID,
  email: 'design@gregale.dev',
  plan: 'pro',
  status: 'active',
  limits: {
    plan: 'pro',
    ram_mb: 4096,
    max_concurrency: 64,
    deployed_apps: 25,
    included_gb_hours: 2000,
    app_layer_max_mb: 2048,
  },
  usage_gb_hours: 1432.5,
  app_count: 6,
  github_install_id: '48213377',
};

// --- Apps --------------------------------------------------------------------

const APP_SEEDS = [
  { slug: 'api-gateway', type: 'app', runtime: 'node24', ram: 512, status: 'active', min: 1 },
  {
    slug: 'image-resize',
    type: 'function',
    runtime: 'python313',
    ram: 1024,
    status: 'active',
    min: 0,
  },
  {
    slug: 'webhook-router',
    type: 'function',
    runtime: 'go124',
    ram: 256,
    status: 'active',
    min: 0,
  },
  {
    slug: 'nightly-etl',
    type: 'function',
    runtime: 'python312',
    ram: 2048,
    status: 'parked',
    min: 0,
  },
  { slug: 'search-indexer', type: 'app', runtime: 'node22', ram: 512, status: 'deploying', min: 0 },
  {
    slug: 'billing-recon',
    type: 'function',
    runtime: 'go124-alpine',
    ram: 256,
    status: 'error',
    min: 0,
  },
] as const;

export const apps: App[] = APP_SEEDS.map((a, i) => ({
  id: id(),
  slug: a.slug,
  type: a.type,
  runtime: a.runtime,
  ram_mb: a.ram,
  max_concurrency: a.type === 'app' ? 8 : 4,
  concurrency_per_vm: 5,
  idle_timeout_s: 60,
  min_instances: a.min,
  status: a.status,
  url: `https://${a.slug}.gregale.app`,
  manifest: {
    entrypoint: a.runtime.startsWith('node')
      ? ['node', 'server.js']
      : a.runtime.startsWith('python')
        ? ['python', '-m', 'app']
        : ['/app/bin/server'],
    port: 8080,
    healthz: '/healthz',
  },
  autoscale_target_rps: 50,
  autoscale_target_cpu_pct: 70,
  streaming_enabled: a.type === 'app',
  route_metrics_enabled: true,
  require_authn: false,
  warm_snapshot_enabled: true,
  eviction_priority: a.min > 0 ? 'reserved' : 'best_effort',
  // Staggered so "created" sorts deterministically.
  ...({ created_at: iso((40 - i * 5) * D) } as object),
}));

export const appBySlug = (slug: string) => apps.find((a) => a.slug === slug);

/** The per-app maps are keyed by slug, so a rename has to move them too. */
export function renameApp(app: App, next: string) {
  for (const map of [secrets, env, upstreams, alerts, webhooks] as Map<string, unknown>[]) {
    const held = map.get(app.slug);
    map.delete(app.slug);
    if (held !== undefined) map.set(next, held);
  }
  app.slug = next;
  app.url = `https://${next}.gregale.app`;
}
export const slugById = (appId: string) => apps.find((a) => a.id === appId)?.slug ?? appId;

// --- Deployments & builds ----------------------------------------------------

const digest = () => `sha256:${hex(64)}`;

export const deployments: Deployment[] = [];
export const builds: Build[] = [];

for (const app of apps) {
  const n = int(3, 6);
  for (let k = 0; k < n; k++) {
    const latest = k === 0;
    const ageMs = latest ? between(0.5, 6) * H : between(1, 30) * D;
    const status = latest
      ? app.status === 'error'
        ? 'failed'
        : app.status === 'deploying'
          ? 'building'
          : 'active'
      : rand() < 0.12
        ? 'failed'
        : 'succeeded';
    const kind = pick(['github', 'github', 'github', 'tarball'] as const);
    const buildId = id();
    const dep: Deployment = {
      id: id(),
      app_id: app.id,
      build_id: buildId,
      image_digest: digest(),
      kind,
      status,
      error:
        status === 'failed'
          ? pick([
              'healthcheck timed out after 30s',
              'exit status 1 during boot',
              'OOM killed (256 MB)',
            ])
          : null,
      error_code: status === 'failed' ? 'boot_failed' : null,
      // ADR-129 auto-rollback fields: never triggered in the mock.
      rollback_on_5xx: false,
      first_5xx_count: 0,
      created_at: iso(ageMs),
      min_instances: app.min_instances,
      traffic_percent: latest ? 100 : 0,
      scan: null,
    };
    deployments.push(dep);
    const dur = int(38, 260);
    builds.push({
      id: buildId,
      deployment_id: dep.id,
      kind: kind === 'github' ? 'railpack' : 'tarball',
      source_bytes: int(120_000, 9_400_000),
      status:
        status === 'building'
          ? 'running'
          : status === 'failed' && rand() < 0.5
            ? 'failed'
            : 'succeeded',
      failure_class:
        status === 'failed' ? pick(['user_error', 'timeout', 'oom'] as const) : undefined,
      enqueued_at: iso(ageMs + dur * 1000 + 4000),
      started_at: iso(ageMs + dur * 1000),
      finished_at: status === 'building' ? undefined : iso(ageMs),
      duration_seconds: status === 'building' ? undefined : dur,
    });
  }
}
deployments.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
builds.sort((a, b) => Date.parse(b.enqueued_at) - Date.parse(a.enqueued_at));

// --- Metrics -----------------------------------------------------------------

const SCALE: Record<string, number> = {
  'api-gateway': 1,
  'image-resize': 0.35,
  'webhook-router': 0.6,
  'nightly-etl': 0.02,
  'search-indexer': 0.18,
  'billing-recon': 0.05,
};
const RANGE_HOURS: Record<string, number> = {
  '5m': 1 / 12,
  '15m': 0.25,
  '1h': 1,
  '6h': 6,
  '24h': 24,
  '7d': 168,
  '15d': 360,
};

export function metricsFor(app: App, range: string): S['AppMetricsResponse'] {
  const r = (RANGE_HOURS[range] ?? 24) * (SCALE[app.slug] ?? 0.1);
  const failing = app.status === 'error';
  return {
    app_id: app.id,
    range: (range in RANGE_HOURS ? range : '24h') as S['AppMetricsResponse']['range'],
    source: 'prometheus',
    as_of: iso(0),
    request_count: Math.round(r * 18_400),
    latency_p50_ms: Math.round(between(18, 42)),
    latency_p95_ms: Math.round(between(90, 180)),
    latency_p99_ms: Math.round(between(240, 520)),
    error_rate_pct: failing
      ? Number(between(12, 31).toFixed(2))
      : Number(between(0.02, 0.9).toFixed(2)),
    cold_start_pct: Number(between(1.2, 6.5).toFixed(1)),
    wake_p95_ms: Math.round(between(210, 340)),
    egress_bytes: Math.round(r * 4.1e8),
  };
}

export const routesFor = (app: App): S['AppRoutesResponse'] => ({
  slug: app.slug,
  app_id: app.id,
  routes:
    app.type === 'app'
      ? [
          '/',
          '/healthz',
          '/v1/*',
          '/v1/users/:id',
          '/v1/orders',
          '/v1/orders/:id',
          '/webhooks/stripe',
          '/static/*',
        ]
      : ['/', '/healthz', '/invoke'],
  source: 'live',
  cap_hit: false,
});

// --- Per-app config ----------------------------------------------------------

const stamp = () => ({ created_at: iso(between(5, 40) * D), updated_at: iso(between(0.1, 5) * D) });

export const secrets = new Map<string, S['AppSecretResponse'][]>(
  apps.map((a) => [
    a.slug,
    [
      'DATABASE_URL',
      'STRIPE_SECRET_KEY',
      'JWT_SIGNING_KEY',
      a.type === 'app' ? 'REDIS_URL' : 'S3_SECRET',
    ].map((key) => ({ key, scope: 'app', kid: hex(8), ...stamp() })),
  ])
);

export const env = new Map<string, S['AppEnvResponse'][]>(
  apps.map((a) => [
    a.slug,
    ['NODE_ENV', 'LOG_LEVEL', 'REGION', 'FEATURE_FLAGS'].map((key) => ({
      key,
      scope: 'app',
      ...stamp(),
    })),
  ])
);

export const upstreams = new Map<string, S['DataUpstreamResponse'][]>(
  apps.map((a) => [
    a.slug,
    a.status === 'parked'
      ? []
      : [
          { kind: 'postgres', port: 5432, host_last4: 'neon' },
          { kind: 'redis', port: 6379, host_last4: 'stsh' },
          ...(a.type === 'app' ? [{ kind: 's3', port: 443, host_last4: 'r2cf' }] : []),
        ].map((u) => ({
          id: id(),
          source: pick(['inferred', 'explicit'] as const),
          kind: u.kind as S['DataUpstreamResponse']['kind'],
          host_redacted_hash: hex(16),
          host_last4: u.host_last4,
          port: u.port,
          declared_region: 'eu-central',
          last_rtt_ms: Number(between(0.8, 9.5).toFixed(1)),
          last_probed_at: iso(between(1, 30) * 60_000),
          created_at: iso(between(5, 40) * D),
          last_seen_at: iso(between(1, 30) * 60_000),
        })),
  ])
);

export const alerts = new Map<string, S['AlertRuleResponse'][]>(
  apps.map((a) => [
    a.slug,
    [
      {
        name: 'Error rate over 5%',
        metric: 'error_rate_pct',
        comparison: 'gt',
        threshold: 5,
        window: '15m',
      },
      {
        name: 'p95 latency over 500 ms',
        metric: 'latency_p95_ms',
        comparison: 'gt',
        threshold: 500,
        window: '5m',
      },
    ].map((r) => ({
      id: id(),
      app_id: a.id,
      name: r.name,
      enabled: true,
      action: 'webhook' as const,
      metric: r.metric as S['AlertRuleResponse']['metric'],
      comparison: r.comparison as S['AlertRuleResponse']['comparison'],
      threshold: r.threshold,
      window_spec: r.window as S['AlertRuleResponse']['window_spec'],
      webhook_url: 'https://hooks.slack.com/services/T0000/B0000/XXXX',
      webhook_secret_sealed_masked: '***',
      cooldown_minutes: 30,
      state: a.status === 'error' && r.metric === 'error_rate_pct' ? 'firing' : 'ok',
      last_fired_at: a.status === 'error' ? iso(22 * 60_000) : undefined,
      last_evaluated_at: iso(60_000),
      ...stamp(),
    })),
  ])
);

export const webhooks = new Map<string, S['AppWebhookResponse'][]>(
  apps.map((a) => [
    a.slug,
    [
      {
        url: 'https://ops.example.com/hooks/gregale',
        filter: ['deployment.succeeded', 'deployment.failed'],
      },
      { url: 'https://api.pagerduty.com/v2/enqueue', filter: ['alert.firing'] },
    ].map((w) => ({
      id: id(),
      app_id: a.id,
      account_id: ACCOUNT_ID,
      target_url: w.url,
      webhook_secret_sealed_masked: '***' as const,
      event_filter: w.filter,
      retry_policy: 'default' as const,
      enabled: true,
      ...stamp(),
    })),
  ])
);

// --- Account-wide resources --------------------------------------------------

export const domains: S['CustomDomainResponse'][] = [
  { domain: 'api.acme.dev', app_id: apps[0].id, verified: true, verified_at: iso(31 * D) },
  { domain: 'img.acme.dev', app_id: apps[1].id, verified: true, verified_at: iso(19 * D) },
  {
    domain: 'hooks.acme.dev',
    app_id: apps[2].id,
    verified: false,
    challenge_token: hex(24),
    txt_record: `_gregale-challenge.hooks.acme.dev TXT "${hex(32)}"`,
  },
];

export const crons: S['CronResponse'][] = [
  {
    id: id(),
    app_id: apps[3].id,
    schedule: '0 2 * * *',
    path: '/run',
    enabled: true,
    created_at: iso(35 * D),
    last_fired_at: iso(16 * H),
  },
  {
    id: id(),
    app_id: apps[5].id,
    schedule: '*/15 * * * *',
    path: '/reconcile',
    enabled: true,
    created_at: iso(28 * D),
    last_fired_at: iso(9 * 60_000),
  },
  {
    id: id(),
    app_id: apps[4].id,
    schedule: '0 */6 * * *',
    path: '/reindex',
    enabled: false,
    created_at: iso(12 * D),
    last_fired_at: iso(3 * D),
  },
  {
    id: id(),
    app_id: apps[1].id,
    schedule: '30 4 * * 1',
    path: '/purge-cache',
    enabled: true,
    created_at: iso(20 * D),
    last_fired_at: iso(2 * D),
  },
];

export const keys: S['APIKeyResponse'][] = [
  {
    id: id(),
    org_id: ORG_ID,
    prefix: 'grg_live_7f3a',
    label: 'CI deploy',
    scopes: ['deploy:write', 'apps:read'],
    last_used_at: iso(2 * H),
    created_at: iso(60 * D),
    status: 'active',
  },
  {
    id: id(),
    org_id: ORG_ID,
    prefix: 'grg_live_c19e',
    label: 'Local CLI (emre)',
    scopes: ['admin'],
    last_used_at: iso(25 * 60_000),
    created_at: iso(14 * D),
    status: 'active',
  },
  {
    id: id(),
    org_id: ORG_ID,
    prefix: 'grg_live_02bd',
    label: 'Usage exporter',
    scopes: ['usage:read'],
    last_used_at: null,
    created_at: iso(90 * D),
    expires_at: iso(-30 * D),
    status: 'active',
  },
];

/**
 * One rule per kind that the console can meaningfully show, with the action
 * shape its kind actually takes — the earlier fixture gave every rule a
 * `route` action, so a cors rule claimed to target an app.
 */
export const edgeRules: S['EdgeRuleResponse'][] = (
  [
    {
      kind: 'route',
      host: 'api.acme.dev',
      path: '/v1/*',
      app: 0,
      action: { target_app_slug: 'api-gateway' },
    },
    {
      kind: 'rewrite',
      host: 'api.acme.dev',
      path: '/legacy/*',
      app: 0,
      action: { from: '/legacy', to: '/v1' },
    },
    {
      kind: 'throttle',
      host: 'hooks.acme.dev',
      path: '/*',
      app: 2,
      action: { requests_per_second: 50, burst: 100 },
    },
    {
      kind: 'cors',
      host: 'img.acme.dev',
      path: '/*',
      app: 1,
      action: {
        allow_origins: ['https://app.acme.dev', 'https://acme.dev'],
        allow_methods: ['GET', 'OPTIONS'],
        allow_headers: ['Authorization'],
        allow_credentials: true,
        max_age_seconds: 86400,
      },
    },
    {
      kind: 'maintenance',
      host: 'api.acme.dev',
      path: '/admin/*',
      app: 0,
      action: { retry_after_seconds: 600, message: 'Admin is down for migration.' },
    },
    {
      kind: 'headers',
      host: 'api.acme.dev',
      path: '/*',
      app: 0,
      action: {
        request_headers: [{ name: 'X-Forwarded-Tenant', value: 'acme', action: 'set' }],
        response_headers: [
          { name: 'X-Powered-By', action: 'remove' },
          { name: 'Strict-Transport-Security', value: 'max-age=63072000', action: 'set' },
        ],
      },
    },
    {
      kind: 'limit',
      host: 'img.acme.dev',
      path: '/upload',
      app: 1,
      action: { max_body_bytes: 10485760 },
    },
    {
      kind: 'geo',
      host: 'api.acme.dev',
      path: '/*',
      app: 0,
      action: { deny: ['KP'], allow: [] },
    },
  ] as {
    kind: S['EdgeRuleResponse']['kind'];
    host: string;
    path: string;
    app: number;
    action: S['EdgeRuleResponse']['action'];
  }[]
).map((r, i) => ({
  id: id(),
  account_id: ACCOUNT_ID,
  app_id: apps[r.app].id,
  match_host: r.host,
  match_path: r.path,
  match_methods: r.kind === 'cors' ? ['GET', 'OPTIONS'] : [],
  priority: (i + 1) * 10,
  validate_mode: 'block' as const,
  enabled: r.kind !== 'maintenance',
  kind: r.kind,
  action: r.action,
  ...stamp(),
}));

export const invocations: S['Invocation'][] = Array.from({ length: 40 }, (_, i) => {
  const app = pick(apps.filter((a) => a.status !== 'parked'));
  const state = pick([
    'completed',
    'completed',
    'completed',
    'completed',
    'failed',
    'pending',
    'dead_letter',
  ] as const);
  const created = i * 11 * 60_000 + int(0, 600_000);
  return {
    id: id(),
    app_id: app.id,
    account_id: ACCOUNT_ID,
    source: pick(['async_invoke', 'queue', 'cron', 'delayed_task', 'replay'] as const),
    state,
    method: 'POST',
    path: pick(['/invoke', '/run', '/reconcile', '/resize']),
    payload: { event: pick(['order.created', 'image.uploaded', 'user.signup']), id: hex(8) },
    result: state === 'completed' ? { ok: true, took_ms: int(40, 2200) } : null,
    created_at: iso(created),
    completed_at:
      state === 'completed' || state === 'failed' ? iso(created - int(120, 4000)) : null,
    instance_id: state === 'pending' ? null : id(),
    last_error:
      state === 'failed' || state === 'dead_letter'
        ? pick(['upstream timeout after 10s', 'handler returned 500', 'payload schema mismatch'])
        : null,
    attempts: state === 'dead_letter' ? 5 : int(1, 2),
  };
});

export const instances: S['InstanceResponse'][] = apps.flatMap((a) => {
  const n = a.status === 'parked' ? 1 : a.status === 'active' ? int(1, 3) : 1;
  const dep = deployments.find((d) => d.app_id === a.id)!;
  return Array.from({ length: n }, () => ({
    id: id(),
    app_id: a.id,
    deployment_id: dep.id,
    state: a.status === 'parked' ? 'parked' : a.status === 'deploying' ? 'pending' : 'running',
    host_ip: `10.40.${int(0, 3)}.${int(10, 250)}`,
    ram_mb: a.ram_mb,
    wake_id: `wk_${hex(6)}`,
    started_at: iso(between(0.2, 30) * H),
    last_request_at: a.status === 'parked' ? iso(14 * H) : iso(between(1, 400) * 1000),
    parked_at: a.status === 'parked' ? iso(13 * H) : null,
    min_instances_target: a.min_instances,
  }));
});

export const audit: S['AuditLogEntry'][] = Array.from({ length: 30 }, (_, i) => {
  const kind = pick([
    'deployment.created',
    'deployment.succeeded',
    'secret.set',
    'env.set',
    'key.created',
    'auth.login',
    'domain.verified',
    'app.parked',
    'app.woken',
    'cron.fired',
  ]);
  const app = pick(apps);
  return {
    id: id(),
    kind,
    account_id: ACCOUNT_ID,
    account_email: account.email,
    actor:
      kind === 'cron.fired' || kind === 'app.parked'
        ? 'system'
        : pick([account.email, 'ci@acme.dev']),
    received_at: iso(i * 3.7 * H + int(0, H)),
    data: {
      app: app.slug,
      ...(kind.startsWith('secret') ? { key: 'DATABASE_URL' } : {}),
      ...(kind === 'auth.login' ? { ip: '185.93.2.14', ua: 'Chrome/128 macOS' } : {}),
    },
  };
});

export const usage: S['UsageSummaryResponse'] = {
  month: new Date(NOW).toISOString().slice(0, 7),
  used_gb_hours: 1432.5,
  included_gb_hours: 2000,
  overage_gb_hours: 0,
  overage_cents: 0,
  used_cpu_hours: 318.2,
  used_egress_gb: 41.7,
  used_ingress_gb: 12.3,
  cold_boots: 8412,
};

export const storage: S['StorageUsageResponse'][] = apps.map((a) => ({
  app_id: a.id,
  day: new Date(NOW).toISOString().slice(0, 10),
  snapshot_bytes: Math.round(a.ram_mb * 1024 * 1024 * between(0.3, 0.8)),
  layer_bytes: int(60e6, 480e6),
}));

export const invoices: S['Invoice'][] = Array.from({ length: 6 }, (_, i) => {
  const end = new Date(NOW);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() - i);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const subtotal = 4900 + (i === 1 ? 1240 : 0);
  return {
    id: id(),
    provider: 'stripe',
    provider_invoice_id: `in_${hex(14)}`,
    number: `GRG-${end.getUTCFullYear()}${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(1042 - i).padStart(4, '0')}`,
    status: i === 0 ? 'open' : 'paid',
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    subtotal_cents: subtotal,
    tax_cents: Math.round(subtotal * 0.19),
    total_cents: Math.round(subtotal * 1.19),
    amount_paid_cents: i === 0 ? 0 : Math.round(subtotal * 1.19),
    currency: 'eur',
    pdf_available: i !== 0,
    created_at: end.toISOString(),
  };
});

export const billingPortal: S['BillingPortalResponse'] = {
  url: null,
  payment_method: { brand: 'visa', last4: '4242', exp_month: 9, exp_year: 2028 },
};

export const orgs: S['OrgResponse'][] = [
  {
    id: ORG_ID,
    slug: 'acme-corp',
    name: 'Acme Corp',
    personal: false,
    plan: 'pro',
    status: 'active',
    created_at: iso(120 * D),
    updated_at: iso(3 * D),
  },
  {
    id: id(),
    slug: 'design',
    name: 'design',
    personal: true,
    plan: 'free',
    status: 'active',
    created_at: iso(140 * D),
    updated_at: iso(140 * D),
  },
];

export const members: S['OrgMemberResponse'][] = [
  { account_id: ACCOUNT_ID, email: account.email, role: 'owner', joined_at: iso(120 * D) },
  { account_id: id(), email: 'poyraz@acme.dev', role: 'admin', joined_at: iso(118 * D) },
  { account_id: id(), email: 'mira@acme.dev', role: 'developer', joined_at: iso(64 * D) },
  { account_id: id(), email: 'finance@acme.dev', role: 'billing', joined_at: iso(30 * D) },
];

export const invitations: S['OrgInvitationResponse'][] = [
  {
    id: id(),
    org_id: ORG_ID,
    org_slug: 'acme-corp',
    email: 'jonas@acme.dev',
    role: 'developer',
    status: 'pending',
    expires_at: iso(-6 * D),
    created_at: iso(1 * D),
  },
  {
    id: id(),
    org_id: ORG_ID,
    org_slug: 'acme-corp',
    email: 'contractor@ext.io',
    role: 'viewer',
    status: 'expired',
    expires_at: iso(2 * D),
    created_at: iso(9 * D),
  },
];

export const sessions: S['SessionInfo'][] = [
  {
    id: id(),
    account_id: ACCOUNT_ID,
    issued_ip: '185.93.2.14',
    issued_ua: 'Chrome 128 · macOS',
    issued_at: iso(2 * H),
    last_seen_at: iso(30_000),
    current_session: true,
  },
  {
    id: id(),
    account_id: ACCOUNT_ID,
    issued_ip: '185.93.2.14',
    issued_ua: 'Safari 18 · iPhone',
    issued_at: iso(3 * D),
    last_seen_at: iso(5 * H),
    current_session: false,
  },
  {
    id: id(),
    account_id: ACCOUNT_ID,
    issued_ip: '78.180.11.9',
    issued_ua: 'gregale-cli/0.9.2',
    issued_at: iso(14 * D),
    last_seen_at: iso(25 * 60_000),
    current_session: false,
  },
];

// --- Queues ------------------------------------------------------------------

export function queueState(app: App): S['QueueStateResponse'] {
  const busy = app.status === 'active';
  return {
    app_slug: app.slug,
    plan: 'pro',
    plan_cap: 10_000,
    depth: busy ? int(0, 340) : 0,
    in_flight: busy ? int(0, 12) : 0,
    oldest_pending_at: busy ? iso(int(5, 900) * 1000) : null,
    oldest_pending_age_seconds: busy ? int(5, 900) : null,
    generated_at: iso(0),
  };
}

export const queuePeek = (app: App): S['QueuePeekResponse'] => ({
  app_slug: app.slug,
  messages: Array.from({ length: app.status === 'active' ? int(3, 8) : 0 }, () => ({
    id: id(),
    created_at: iso(int(5, 900) * 1000),
    attempts: int(0, 2),
    payload: JSON.stringify({
      event: pick(['order.created', 'image.uploaded', 'user.signup']),
      id: hex(8),
    }),
  })),
});

export const queueDeadLetter = (app: App): S['QueueDeadLetterResponse'] => ({
  app_slug: app.slug,
  messages: Array.from(
    { length: app.status === 'error' ? 4 : app.status === 'active' ? int(0, 2) : 0 },
    () => ({
      id: id(),
      created_at: iso(int(2, 40) * H),
      failed_at: iso(int(1, 30) * H),
      attempts: 5,
      last_error: pick([
        'handler returned 500',
        'upstream timeout after 10s',
        'payload schema mismatch',
      ]),
      payload: JSON.stringify({ event: 'order.created', id: hex(8) }),
    })
  ),
});

// --- Cron runs & webhook deliveries ------------------------------------------

export const cronRuns = new Map<string, S['CronRun'][]>(
  crons.map((c) => [
    c.id,
    Array.from({ length: c.enabled ? int(6, 12) : 2 }, (_, i) => {
      const outcome = pick([
        'success',
        'success',
        'success',
        'success',
        'failed',
        'timeout',
      ] as const);
      const started = (i + 1) * 6 * H + int(0, H);
      const dur = outcome === 'timeout' ? 30_000 : int(400, 9_000);
      return {
        id: id(),
        started_at: iso(started),
        completed_at: iso(started - dur),
        duration_ms: dur,
        outcome,
        attempts: outcome === 'failed' ? int(2, 3) : 1,
        instance_id: id(),
        error:
          outcome === 'failed'
            ? pick(['handler returned 500', 'upstream postgres: connection refused'])
            : outcome === 'timeout'
              ? 'no response within 30s'
              : null,
      };
    }),
  ])
);

export const deliveries = new Map<string, S['AppWebhookDeliveryResponse'][]>(
  [...webhooks.entries()].flatMap(([slug, hooks]) =>
    hooks.map((w) => [
      w.id,
      Array.from({ length: int(4, 9) }, (_, i) => {
        const status = pick([
          'succeeded',
          'succeeded',
          'succeeded',
          'failed',
          'dead',
          'pending',
        ] as const);
        const created = (i + 1) * 3 * H + int(0, H);
        return {
          id: id(),
          webhook_id: w.id,
          app_id: appBySlug(slug)?.id ?? '',
          account_id: ACCOUNT_ID,
          event: pick(w.event_filter.length ? w.event_filter : ['build.succeeded']),
          payload: { app: slug, deployment_id: id() },
          attempt: status === 'dead' ? 7 : status === 'failed' ? int(1, 4) : 1,
          status,
          last_error:
            status === 'failed' || status === 'dead'
              ? pick(['HTTP 503', 'timeout after 10s', 'HTTP 401'])
              : undefined,
          last_response_code: status === 'succeeded' ? 200 : status === 'failed' ? 503 : undefined,
          next_attempt_at: iso(-int(1, 30) * 60_000),
          delivered_at: status === 'succeeded' ? iso(created - 800) : undefined,
          created_at: iso(created),
          updated_at: iso(created - 800),
        };
      }),
    ])
  )
);

// --- Logs --------------------------------------------------------------------

const LOG_PATHS = [
  '/v1/orders',
  '/v1/users/42',
  '/healthz',
  '/v1/orders/9f2a',
  '/webhooks/stripe',
  '/invoke',
];

/** Per-plan archive retention, in days. Free has no archive at all. */
export const ARCHIVE_RETENTION_DAYS: Record<string, number> = {
  free: 0,
  hobby: 7,
  pro: 30,
  scale: 90,
};

export interface LogFrame {
  ts: string;
  level: 'info' | 'warn' | 'error';
  instance_id: string;
  msg: string;
}

/**
 * One structured frame, the way the spec describes the stream: a level, the
 * instance that emitted it, and a message. The earlier fixture sent a plain
 * text line, which meant the console had nothing to colour or filter on.
 */
export function logFrame(app: App): LogFrame {
  const instance = instances.find((i) => i.app_id === app.id)?.id ?? id();
  // An app the fleet considers failing says so in its output, which is also
  // what makes the error view worth looking at in the mock.
  const failing = app.status === 'error';
  const roll = rand() * (failing ? 0.35 : 1);
  const base = { ts: new Date().toISOString(), instance_id: instance };

  if (roll < 0.06)
    return { ...base, level: 'warn', msg: `upstream postgres slow query 412ms stmt=select_orders` };
  if (roll < 0.09)
    return { ...base, level: 'error', msg: 'handler panic: nil pointer dereference (recovered)' };
  if (roll < 0.12) return { ...base, level: 'info', msg: 'wake cold snapshot=restore 214ms' };

  const status = rand() < 0.94 ? 200 : pick([201, 204, 400, 404, 500]);
  return {
    ...base,
    level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    msg: `${pick(['GET', 'GET', 'POST', 'PUT'])} ${pick(LOG_PATHS)} ${status} ${int(3, 240)}ms`,
  };
}

/* --- Empty workspace --------------------------------------------------------
   `MOCK_EMPTY=1` boots the same account with nothing in it, which is the
   state a real first sign-in lands on and the one the console has always been
   hardest to see. Built first and cleared afterwards rather than branched at
   every seed: the fixtures reference each other, and half of them would have
   to grow a "unless empty" case.
   ---------------------------------------------------------------------------- */

export const EMPTY = process.env.MOCK_EMPTY === '1';

if (EMPTY) {
  for (const list of [
    apps,
    deployments,
    builds,
    domains,
    crons,
    keys,
    edgeRules,
    invocations,
    instances,
    audit,
    storage,
    invoices,
    invitations,
  ] as { length: number }[]) {
    list.length = 0;
  }
  for (const map of [secrets, env, upstreams, alerts, webhooks]) map.clear();
  account.app_count = 0;
  account.usage_gb_hours = 0;
  Object.assign(usage, {
    used_gb_hours: 0,
    overage_gb_hours: 0,
    overage_cents: 0,
    used_cpu_hours: 0,
    used_egress_gb: 0,
    used_ingress_gb: 0,
    cold_boots: 0,
  });
}

/**
 * A day of archived lines for one instance, replayed from "S3".
 *
 * Seeded off the instance and the date so the same day always reads the same
 * way — an archive that changed between two reads would be a strange thing to
 * design against.
 */
export function archivedDay(instance: string, date: string): LogFrame[] {
  let h = 0;
  for (const ch of `${instance}:${date}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const next = () => {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    return h / 0x7fffffff;
  };
  const count = 25 + Math.floor(next() * 60);
  return Array.from({ length: count }, (_, i) => {
    const roll = next();
    const minute = Math.floor((i / count) * 1440);
    const ts = `${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00.000Z`;
    if (roll < 0.05)
      return {
        ts,
        level: 'error' as const,
        instance_id: instance,
        msg: 'handler returned 500 after 10s',
      };
    if (roll < 0.12)
      return {
        ts,
        level: 'warn' as const,
        instance_id: instance,
        msg: 'upstream postgres slow query 512ms',
      };
    return {
      ts,
      level: 'info' as const,
      instance_id: instance,
      msg: `${roll < 0.5 ? 'GET' : 'POST'} ${LOG_PATHS[Math.floor(next() * LOG_PATHS.length)]} 200 ${Math.floor(next() * 200) + 5}ms`,
    };
  });
}

/**
 * A build's output, in the shape the log decoder already understands.
 *
 * A failed build ends on the reason it failed, because that is the question a
 * failed build actually raises and the console could not answer it.
 */
export function buildLog(
  slug: string,
  status: string,
  digest: string,
  failureClass?: string
): LogFrame[] {
  const at = (i: number) => new Date(NOW - (40 - i) * 1000).toISOString();
  const frames: LogFrame[] = [
    { ts: at(0), level: 'info', instance_id: '', msg: `#1 resolving source for ${slug}` },
    { ts: at(1), level: 'info', instance_id: '', msg: '#2 detected runtime from manifest' },
    { ts: at(2), level: 'info', instance_id: '', msg: '#3 restoring dependency cache' },
    { ts: at(3), level: 'info', instance_id: '', msg: '#4 installing dependencies' },
    { ts: at(4), level: 'info', instance_id: '', msg: '#5 running build' },
  ];
  if (status === 'failed') {
    // The reason has to agree with the failure class on the row beside it.
    const reason: Record<string, [string, string]> = {
      oom: ['fatal: out of memory while bundling', '#5 killed (OOM, 2048 MB)'],
      timeout: ['still running after 600s', '#5 cancelled: build timeout'],
      infra: ['builder lost connection to the registry', '#5 aborted: infrastructure error'],
      user_error: ['error: cannot find module "./config"', '#5 exited with code 1'],
    };
    const [detail, exit] = reason[failureClass ?? 'user_error'] ?? reason.user_error;
    frames.push(
      { ts: at(5), level: 'error', instance_id: '', msg: detail },
      { ts: at(6), level: 'error', instance_id: '', msg: exit },
      { ts: at(7), level: 'error', instance_id: '', msg: 'build failed' }
    );
    return frames;
  }
  frames.push(
    { ts: at(5), level: 'info', instance_id: '', msg: '#6 exporting layers' },
    { ts: at(6), level: 'info', instance_id: '', msg: `#7 wrote ${digest.slice(0, 19)}…` },
    { ts: at(7), level: 'info', instance_id: '', msg: 'build succeeded' }
  );
  return frames;
}
