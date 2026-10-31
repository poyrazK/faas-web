import { expect, it } from 'vitest';
import * as db from './data';
import { isMockProblem, readRequestAudit, readRouteCustomers } from './request-audit';

const app = (slug: string) => db.apps.find((a) => a.slug === slug)!;
const q = (params: Record<string, string> = {}) => new URLSearchParams(params);
const liveOf = (slug: string) =>
  db.deployments
    .filter((d) => d.app_id === app(slug).id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];

it('answers the newest 100 records of the last 24 hours by default, newest first', () => {
  const out = readRequestAudit(app('api-gateway'), q());
  if (isMockProblem(out)) throw new Error(out.code);
  expect(out.app_id).toBe(app('api-gateway').id);
  expect(out.records.length).toBeGreaterThan(0);
  expect(out.records.length).toBeLessThanOrEqual(100);
  const times = out.records.map((r) => Date.parse(r.occurred_at));
  expect([...times].sort((a, b) => b - a)).toEqual(times);
  expect(Date.parse(out.until) - Date.parse(out.since)).toBe(24 * 3600_000);
  for (const t of times) expect(t).toBeGreaterThanOrEqual(Date.parse(out.since));
});

it('honours the limit and widens with since', () => {
  const since = new Date(db.NOW - 7 * 24 * 3600_000).toISOString();
  const out = readRequestAudit(app('api-gateway'), q({ since, limit: '500' }));
  if (isMockProblem(out)) throw new Error(out.code);
  const day = readRequestAudit(app('api-gateway'), q());
  if (isMockProblem(day)) throw new Error(day.code);
  expect(out.records.length).toBeGreaterThan(day.records.length);
  const two = readRequestAudit(app('api-gateway'), q({ since, limit: '2' }));
  expect(isMockProblem(two) ? [] : two.records).toHaveLength(2);
});

it('rejects the windows and limits the handler rejects', () => {
  const at = (days: number) => new Date(db.NOW - days * 24 * 3600_000).toISOString();
  for (const params of <Record<string, string>[]>[
    { since: 'yesterday' },
    { until: 'now' },
    { since: at(32) },
    { since: at(1), until: at(2) },
    { limit: '0' },
    { limit: '501' },
  ]) {
    const out = readRequestAudit(app('api-gateway'), q(params));
    expect(isMockProblem(out) && out.code).toBe('validation_failed');
  }
});

it('has nothing for an app without collected audit, and fails the failing app', () => {
  const quiet = readRequestAudit(app('nightly-etl'), q());
  expect(isMockProblem(quiet) ? undefined : quiet.records).toEqual([]);
  const failing = readRequestAudit(app('billing-recon'), q());
  expect(isMockProblem(failing) && failing.code).toBe('capacity_unavailable');
});

it('reports route customers for the live deployment, with overlapping counts kept apart', () => {
  const out = readRouteCustomers(
    app('api-gateway'),
    q({ deployment_id: liveOf('api-gateway').id }),
    'pro'
  );
  if (isMockProblem(out)) throw new Error(out.code);
  expect(out).toMatchObject({
    slug: 'api-gateway',
    deployment_id: liveOf('api-gateway').id,
    coverage: 'observed_only',
    routes_limit: 200,
    customers_limit: 20,
    window_clamped: false,
  });
  expect(out.routes.length).toBeGreaterThan(2);
  for (const r of out.routes) {
    expect(r.identified_requests + r.anonymous_requests + r.unresolved_identity_requests).toBe(
      r.requests
    );
    expect(r.customers.length).toBeLessThanOrEqual(20);
  }
  expect(out.routes.some((r) => r.customers_truncated && r.other_customer_requests > 0)).toBe(true);
});

it('clamps a window past plan retention and gates the free plan', () => {
  const id = liveOf('api-gateway').id;
  const out = readRouteCustomers(app('api-gateway'), q({ deployment_id: id, since: '30d' }), 'pro');
  if (isMockProblem(out)) throw new Error(out.code);
  expect(out.window_clamped).toBe(true);
  expect(Date.parse(out.until) - Date.parse(out.from)).toBe(7 * 24 * 3600_000);
  const free = readRouteCustomers(app('api-gateway'), q({ deployment_id: id }), 'free');
  expect(isMockProblem(free) && free.code).toBe('plan_feature_gated');
});

it('rejects a malformed deployment and hides another app’s', () => {
  const bad = readRouteCustomers(app('api-gateway'), q({ deployment_id: 'nope' }), 'pro');
  expect(isMockProblem(bad) && bad.code).toBe('validation_failed');
  const foreign = readRouteCustomers(
    app('api-gateway'),
    q({ deployment_id: liveOf('image-resize').id }),
    'pro'
  );
  expect(isMockProblem(foreign) && foreign.code).toBe('not_found');
});

it('has no observations for an older deployment', () => {
  const older = db.deployments
    .filter((d) => d.app_id === app('api-gateway').id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[1];
  const out = readRouteCustomers(app('api-gateway'), q({ deployment_id: older.id }), 'pro');
  expect(isMockProblem(out) ? undefined : out.routes).toEqual([]);
});
