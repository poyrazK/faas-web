import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
type Record_ = S['RequestAuditRecord'];
type RouteUsage = S['RouteCustomerUsage'];

export type MockProblem = { status: number; code: string; detail: string };
export const isMockProblem = (value: unknown): value is MockProblem =>
  typeof value === 'object' && value !== null && 'code' in value && 'status' in value;

const H = 3_600_000;
const D = 24 * H;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const parseTime = (raw: string) => (RFC3339.test(raw) ? Date.parse(raw) : NaN);
const validation = (detail: string): MockProblem => ({
  status: 400,
  code: 'validation_failed',
  detail,
});

/** DebugTelemetryRetentionDays in faas pkg/api/limits.go. */
const RETENTION_DAYS: Record<string, number> = { free: 0, hobby: 3, pro: 7, scale: 14 };

const ROUTES = [
  ['GET', '/orders'],
  ['GET', '/orders/{id}'],
  ['POST', '/orders'],
  ['GET', '/search'],
  ['DELETE', '/orders/{id}'],
  ['GET', '/health'],
] as const;
const STATUSES = [200, 200, 200, 201, 200, 204, 404, 200, 500, 200, 429, 200];
const CONSUMERS = [
  '3f6c2a1e-8b4d-4c7a-9e21-5d0f7b3a6c48',
  'a91d4e07-2c5b-4f8e-b3a6-7e14c9d02f5b',
  'c2e8f5b3-6a1d-4e9c-8f07-1b4d3a7e9c26',
];
const TENANTS = ['5b0e9c41-7d2a-4f63-8e15-2c9a0b7d4e18', '8d4a1f60-3e7b-4c25-a9d8-6f1e2b5c0a93'];
// Documentation ranges only (RFC 5737, RFC 3849).
const SOURCE_IPS = ['203.0.113.24', '198.51.100.7', '2001:db8::4f2a', '203.0.113.90'];

/** Minutes between seeded audit records, per app. Unlisted apps have none. */
const CADENCE_MIN: Record<string, number> = { 'api-gateway': 37, 'image-resize': 95 };

const hex = (n: number, salt: number) =>
  Array.from({ length: n }, (_, i) => ((salt * 31 + i * 7) % 16).toString(16)).join('');
const uuidOf = (n: number) => {
  const h = hex(32, n);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20)}`;
};

function liveDeployment(app: db.App) {
  return db.deployments
    .filter((d) => d.app_id === app.id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

/** Thirty days of exact records, newest first (ADR-242 keeps them for 30). */
const seeded = new Map<string, Record_[]>();
function recordsFor(app: db.App): Record_[] {
  const cached = seeded.get(app.id);
  if (cached) return cached;
  const cadence = CADENCE_MIN[app.slug];
  const deployment = liveDeployment(app);
  const out: Record_[] = [];
  if (cadence)
    for (let i = 0, ms = 4 * 60_000; ms < 30 * D; i++, ms += cadence * 60_000) {
      const [method, route] = ROUTES[i % ROUTES.length];
      const identified = i % 4 !== 3;
      out.push({
        event_id: uuidOf(i + 1),
        account_id: db.account.id,
        app_id: app.id,
        ...(identified ? { consumer_id: CONSUMERS[i % CONSUMERS.length] } : {}),
        ...(identified && i % 2 === 0 ? { platform_tenant_id: TENANTS[i % TENANTS.length] } : {}),
        route_template: route,
        method,
        http_status: route === '/health' ? 200 : STATUSES[i % STATUSES.length],
        latency_ms: 8 + ((i * 53) % 240),
        trace_id: hex(32, i + 7),
        ...(deployment ? { deployment_id: deployment.id } : {}),
        commit_sha: hex(40, 3),
        occurred_at: db.iso(ms),
        request_id: `req_${hex(16, i + 11)}`,
        // The trusted source IP is absent when the gateway could not verify it.
        ...(i % 9 === 4 ? {} : { source_ip: SOURCE_IPS[i % SOURCE_IPS.length] }),
      });
    }
  seeded.set(app.id, out);
  return out;
}

/** `GET /v1/apps/{slug}/audit/requests` (faas handlers_request_audit.go). */
export function readRequestAudit(
  app: db.App,
  query: URLSearchParams,
  now = Date.now()
): S['RequestAuditListResponse'] | MockProblem {
  // The failing app models a store that cannot answer (ErrCapacity).
  if (app.slug === 'billing-recon')
    return { status: 503, code: 'capacity_unavailable', detail: 'request audit' };
  let until = now + 1;
  const rawUntil = query.get('until');
  if (rawUntil) {
    until = parseTime(rawUntil);
    if (Number.isNaN(until)) return validation('until must be an RFC3339 timestamp');
  }
  let since = until - D;
  const rawSince = query.get('since');
  if (rawSince) {
    since = parseTime(rawSince);
    if (Number.isNaN(since)) return validation('since must be an RFC3339 timestamp');
  }
  if (until <= since || until - since > 31 * D)
    return validation('audit window must be positive and at most 31 days');
  let limit = 100;
  const rawLimit = query.get('limit');
  if (rawLimit) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
      return validation('limit must be between 1 and 500');
  }
  const records = recordsFor(app)
    .filter((r) => {
      const t = Date.parse(r.occurred_at);
      return t >= since && t < until;
    })
    .slice(0, limit);
  return {
    app_id: app.id,
    records,
    since: new Date(since).toISOString(),
    until: new Date(until).toISOString(),
  };
}

function parseSince(raw: string, until: number): number {
  const at = parseTime(raw);
  if (!Number.isNaN(at)) return at;
  const match = /^(\d+)(h|d)$/.exec(raw);
  if (!match || Number(match[1]) <= 0) return NaN;
  return until - Number(match[1]) * (match[2] === 'd' ? D : H);
}

/** Per-route totals for the live deployment, before the identity split. */
const ROUTE_TOTALS: Record<string, number> = {
  'GET /orders': 18_420,
  'GET /orders/{id}': 9_310,
  'POST /orders': 2_904,
  'GET /search': 1_266,
  'DELETE /orders/{id}': 87,
};

/** The identity groups seen on a route; `/orders` has more than the 20 shown. */
function customersFor(total: number, key: string, until: number) {
  const groups = key === 'GET /orders' ? 24 : key === 'DELETE /orders/{id}' ? 1 : 5;
  const all = Array.from({ length: groups }, (_, i) => ({
    consumer_id: i % 5 === 4 ? undefined : uuidOf(100 + i),
    platform_tenant_id: i % 2 === 0 ? TENANTS[(i / 2) % TENANTS.length] : undefined,
    requests: Math.max(1, Math.round((total * 0.7) / (i + 2) / 2)),
    last_observed_at: new Date(until - (i + 1) * 7 * 60_000).toISOString(),
  }));
  return {
    shown: all.slice(0, 20).map((c) => ({
      ...(c.consumer_id ? { consumer_id: c.consumer_id } : {}),
      ...(c.platform_tenant_id ? { platform_tenant_id: c.platform_tenant_id } : {}),
      requests: c.requests,
      last_observed_at: c.last_observed_at,
    })),
    groups,
    // Distinct counts precede the 20-group cap (route_customers.go).
    consumers: all.filter((c) => c.consumer_id).length,
    tenants: new Set(all.flatMap((c) => (c.platform_tenant_id ? [c.platform_tenant_id] : []))).size,
    other: all.slice(20).reduce((sum, c) => sum + c.requests, 0),
  };
}

/** `GET /v1/apps/{slug}/analytics/route-customers` (faas handlers_route_customers.go). */
export function readRouteCustomers(
  app: db.App,
  query: URLSearchParams,
  plan: string,
  now = Date.now()
): S['RouteCustomerUsageResponse'] | MockProblem {
  const retentionDays = RETENTION_DAYS[plan] ?? 7;
  if (retentionDays === 0)
    return {
      status: 402,
      code: 'plan_feature_gated',
      detail: `the ${plan} plan doesn't include request analytics; upgrade to Hobby or higher for historical observability.`,
    };
  const id = query.get('deployment_id') ?? '';
  if (!/^[0-9a-f]{32}$/i.test(id.replace(/-/g, '')))
    return validation('deployment_id must be a deployment UUID');
  const deployment = db.deployments.find((d) => d.id === id);
  if (!deployment || deployment.app_id !== app.id)
    return { status: 404, code: 'not_found', detail: 'no such deployment' };
  let until = now;
  const rawUntil = query.get('until');
  if (rawUntil) {
    until = parseTime(rawUntil);
    if (Number.isNaN(until)) return validation('until must be RFC3339');
    if (until > now) return validation('until must not be in the future');
  }
  const from = parseSince(query.get('since') || '24h', until);
  if (Number.isNaN(from))
    return validation(
      'since must be a positive duration (for example 24h or 7d) or an RFC3339 timestamp'
    );
  if (from >= until) return validation('since must be earlier than until');
  const minimum = now - retentionDays * D;
  if (until <= minimum) return validation('until must be within retained telemetry');
  const clamped = from < minimum;
  const start = clamped ? minimum : from;
  if (app.slug === 'billing-recon')
    return { status: 503, code: 'capacity_unavailable', detail: 'route customer analytics' };

  // Only the live deployment of an app with traffic has observations; the
  // window scales the seeded volume so a wider window reads as more traffic.
  const observed = CADENCE_MIN[app.slug] && liveDeployment(app)?.id === deployment.id;
  const scale = Math.min(1, (until - start) / (7 * D));
  const routes: RouteUsage[] = observed
    ? Object.entries(ROUTE_TOTALS).map(([key, base]) => {
        const [method, route] = key.split(' ') as [RouteUsage['method'], string];
        const requests = Math.max(1, Math.round(base * scale));
        const anonymous = Math.round(requests * 0.18);
        const unresolved = key === 'GET /search' ? Math.round(requests * 0.04) : 0;
        const customers = customersFor(requests - anonymous - unresolved, key, until);
        return {
          route,
          method,
          requests,
          identified_requests: requests - anonymous - unresolved,
          anonymous_requests: anonymous,
          unresolved_identity_requests: unresolved,
          consumer_count: customers.consumers,
          platform_tenant_count: customers.tenants,
          last_observed_at: new Date(until - 4 * 60_000).toISOString(),
          customers: customers.shown,
          customers_truncated: customers.groups > 20,
          other_customer_requests: customers.other,
        };
      })
    : [];
  return {
    slug: app.slug,
    deployment_id: deployment.id,
    from: new Date(start).toISOString(),
    until: new Date(until).toISOString(),
    as_of: new Date(now).toISOString(),
    window_clamped: clamped,
    coverage: 'observed_only',
    routes,
    routes_limit: 200,
    routes_truncated: false,
    customers_limit: 20,
  };
}
