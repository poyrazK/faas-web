import { randomBytes, randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';

/**
 * Dev-only mock of API monetization (ADR-120): app consumers, their keys,
 * plans, plan assignments, durable usage, quotes, alerts and statements, and
 * the account-level customers ("platform tenants") that group them.
 *
 * Registered from `mock/plugin.ts` with one call so that file keeps a small
 * diff; the plugin's own `route`, `Problem` and `status` are passed in rather
 * than duplicated. Usage is synthesised deterministically from the consumer
 * id and the UTC day, so a quote, a statement and the usage tiles over the
 * same period agree with each other. `MOCK_EMPTY=1` seeds nothing.
 */

type S = components['schemas'];
type Consumer = S['APIConsumerResponse'];
type ConsumerKey = S['ConsumerKeyResponse'];
type Plan = S['APIConsumerPlanResponse'];
type Assignment = S['APIConsumerPlanAssignmentResponse'];
type Statement = S['APIConsumerUsageStatementResponse'];
type Handoff = S['APIConsumerUsageStatementHandoffResponse'];
type Tenant = S['PlatformTenantResponse'];
type RateCard = S['PlatformTenantRateCardResponse'];
type TenantStatement = S['PlatformTenantStatementResponse'];
type UsageBucket = S['APIConsumerUsageBucketResponse'];

type Ctx = {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
};
type Register = (method: string, template: string, handler: (ctx: Ctx) => unknown) => void;
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;
type StatusFn = (code: number, body: unknown) => unknown;

const MINUTE = 60_000;
const DAY = 86_400_000;
/** The app-wide rate card every mocked app has, from this minute on. */
const APP_RATE_FROM = Date.UTC(2026, 5, 1);
const APP_PRICE = 10; // millicents per unit
const PLAN_PRICE: Record<string, number> = { starter: 12, pro: 8 };
const CURRENCY = 'EUR';

const iso = (ms: number) => new Date(ms).toISOString();
const utcMonthStart = (ms: number, offset = 0) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
};
const nextMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE + MINUTE;

/** A small stable hash, so synthesised usage is the same on every read. */
function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000;
}

const consumers = new Map<string, Consumer[]>();
const keys = new Map<string, ConsumerKey[]>();
const plans = new Map<string, Plan[]>();
const assignments = new Map<string, Assignment[]>();
const statements = new Map<string, Statement[]>();
const handoffs = new Map<string, Handoff>();
const tenants: Tenant[] = [];
const tenantConsumers = new Map<string, string[]>();
const tenantSurfaceIds = new Map<string, string[]>();
const rateCards = new Map<string, RateCard[]>();
const tenantStatements = new Map<string, TenantStatement[]>();
const alertsByConsumer = new Map<string, S['APIConsumerUsageAlertResponse'][]>();

function appFor(slug: string, Problem: ProblemCtor) {
  const app = db.apps.find((a) => a.slug === slug);
  if (!app) throw new Problem(404, 'app_not_found', `No app named ${slug}.`);
  return app;
}

function allConsumers(): Consumer[] {
  return [...consumers.values()].flat();
}

/** Durable minute usage for one consumer: three busy minutes per UTC day. */
function usageBuckets(consumer: Consumer, since: number, until: number): UsageBucket[] {
  const out: UsageBucket[] = [];
  const born = Date.parse(consumer.created_at);
  const end = Math.min(until, consumer.revoked_at ? Date.parse(consumer.revoked_at) : until);
  for (let day = Math.floor(since / DAY) * DAY; day < end; day += DAY) {
    for (const hour of [9, 14, 20]) {
      const at = day + hour * 3_600_000;
      if (at < since || at >= end || at < born || at > Date.now()) continue;
      const n = seed(`${consumer.id}:${at}`);
      if (n < 120) continue;
      const requests = 40 + (n % 400);
      out.push({
        window_start: iso(at),
        request_count: requests,
        error_count: n % 7 === 0 ? Math.ceil(requests / 25) : 0,
        billable_units: requests,
      });
    }
  }
  return out;
}

function planInForce(consumerId: string, at: number): Assignment | undefined {
  return (assignments.get(consumerId) ?? [])
    .filter((a) => Date.parse(a.effective_from) <= at)
    .sort((a, b) => Date.parse(b.effective_from) - Date.parse(a.effective_from))[0];
}

function priceAt(slug: string, consumerId: string, at: number): number | undefined {
  if (at < APP_RATE_FROM) return undefined;
  const planId = planInForce(consumerId, at)?.plan_id;
  const plan = planId ? (plans.get(slug) ?? []).find((p) => p.id === planId) : undefined;
  return plan ? (PLAN_PRICE[plan.name] ?? APP_PRICE) : APP_PRICE;
}

function priced(slug: string, consumer: Consumer, since: number, until: number) {
  const buckets = usageBuckets(consumer, since, until).map((b) => {
    const price = priceAt(slug, consumer.id, Date.parse(b.window_start));
    return {
      window_start: b.window_start,
      billable_units: b.billable_units,
      charged_units: price === undefined ? 0 : b.billable_units,
      amount_millicents: (price ?? 0) * b.billable_units,
      ...(price === undefined ? {} : { currency: CURRENCY, price_millicents_per_unit: price }),
    };
  });
  const billable = buckets.reduce((n, b) => n + b.billable_units, 0);
  const unpriced = buckets.reduce((n, b) => n + (b.charged_units ? 0 : b.billable_units), 0);
  return {
    buckets,
    billable_units: billable,
    unpriced_units: unpriced,
    amount_millicents: buckets.reduce((n, b) => n + b.amount_millicents, 0),
    priced: unpriced === 0,
    currency: CURRENCY,
  };
}

function window(query: URLSearchParams, Problem: ProblemCtor) {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const since = query.get('since') ? Date.parse(query.get('since')!) : today - 30 * DAY;
  const until = query.get('until') ? Date.parse(query.get('until')!) : today;
  if (Number.isNaN(since) || Number.isNaN(until) || since >= until)
    throw new Problem(400, 'validation_failed', 'since must be before until.');
  return { since, until };
}

function period(body: Record<string, unknown>, Problem: ProblemCtor) {
  const start = Date.parse(String(body.period_start ?? ''));
  const end = Date.parse(String(body.period_end ?? ''));
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end)
    throw new Problem(400, 'validation_failed', 'period_start must be before period_end.');
  if (start % MINUTE || end % MINUTE)
    throw new Problem(400, 'validation_failed', 'Periods are whole UTC minutes.');
  return { start, end };
}

let seeded = false;
function seedAll() {
  if (seeded || db.EMPTY) return;
  seeded = true;
  const now = Date.now();
  const app = db.apps.find((a) => a.slug === 'api-gateway') ?? db.apps[0];
  if (!app) return;
  const slug = app.slug;
  const created = (daysAgo: number) => iso(Math.floor((now - daysAgo * DAY) / MINUTE) * MINUTE);
  const consumer = (name: string, ref: string, daysAgo: number, revoked = false): Consumer => ({
    id: randomUUID(),
    app_id: app.id,
    external_ref: ref,
    name,
    status: revoked ? 'revoked' : 'active',
    created_at: created(daysAgo),
    updated_at: created(revoked ? 10 : daysAgo),
    revoked_at: revoked ? created(10) : null,
  });
  const acme = consumer('Acme', 'crm-1001', 160);
  const globex = consumer('Globex', 'crm-1002', 90);
  const initech = consumer('Initech', 'crm-1003', 120, true);
  consumers.set(slug, [acme, globex, initech]);

  const plan = (name: string, rpm: number, units: number, alerts: number[]): Plan => ({
    id: randomUUID(),
    app_id: app.id,
    name,
    max_requests_per_minute: rpm,
    max_units_per_month: units,
    alert_thresholds_percent: alerts,
    created_at: created(170),
    updated_at: created(30),
  });
  const starter = plan('starter', 60, 20_000, [80, 100]);
  const pro = plan('pro', 600, 0, []);
  plans.set(slug, [starter, pro]);

  const assign = (c: Consumer, p: Plan | undefined, from: number): Assignment => ({
    id: randomUUID(),
    consumer_id: c.id,
    ...(p ? { plan_id: p.id } : {}),
    effective_from: iso(from),
    created_at: iso(Math.min(from, now)),
  });
  assignments.set(acme.id, [assign(acme, pro, utcMonthStart(now, -3))]);
  assignments.set(globex.id, [
    assign(globex, starter, utcMonthStart(now, -2)),
    assign(globex, pro, utcMonthStart(now, 1)),
  ]);

  const key = (c: Consumer, name: string, scopes: ConsumerKey['scopes'], revoked = false) => ({
    id: randomUUID(),
    consumer_id: c.id,
    name,
    prefix: `gcs_${randomBytes(4).toString('hex')}`,
    scopes,
    created_at: c.created_at,
    expires_at: null,
    last_used_at: revoked ? null : created(1),
    revoked_at: revoked ? created(20) : null,
  });
  keys.set(acme.id, [
    key(acme, 'primary', ['read', 'write']),
    key(acme, 'staging', ['read'], true),
  ]);
  keys.set(globex.id, [key(globex, 'primary', ['read'])]);
  keys.set(initech.id, [key(initech, 'primary', ['read'], true)]);

  // Acme: two months ago is finalized and handed off.
  const start = utcMonthStart(now, -2);
  const end = utcMonthStart(now, -1);
  const quote = priced(slug, acme, start, end);
  const finalized: Statement = {
    id: randomUUID(),
    consumer_id: acme.id,
    period_start: iso(start),
    period_end: iso(end),
    revision: 1,
    status: 'finalized',
    ...quote,
    as_of: iso(end + 5 * MINUTE),
    created_at: iso(end + DAY),
    finalized_at: iso(end + 2 * DAY),
  };
  statements.set(acme.id, [finalized]);
  handoffs.set(finalized.id, {
    id: randomUUID(),
    statement_id: finalized.id,
    external_invoice_id: 'INV-2026-0042',
    currency: CURRENCY,
    amount_millicents: finalized.amount_millicents,
    created_at: iso(end + 3 * DAY),
  });

  const usedPercent = 80;
  const alertMonth = utcMonthStart(now, -1);
  alertsByConsumer.set(globex.id, [
    {
      id: randomUUID(),
      consumer_id: globex.id,
      plan_id: starter.id,
      month_start: iso(alertMonth),
      threshold_percent: usedPercent,
      limit_units: starter.max_units_per_month,
      used_units: (starter.max_units_per_month * usedPercent) / 100 + 37,
      crossed_at: iso(alertMonth + 19 * DAY + 14 * 3_600_000),
    },
  ]);

  const tenant = (name: string, ref: string, daysAgo: number, suspended = false): Tenant => ({
    id: randomUUID(),
    external_ref: ref,
    name,
    status: suspended ? 'suspended' : 'active',
    created_at: created(daysAgo),
    updated_at: created(suspended ? 5 : daysAgo),
  });
  const acmeCorp = tenant('Acme Corporation', 'crm-1001', 150);
  const globexCorp = tenant('Globex', 'crm-1002', 80);
  const initrode = tenant('Initrode', 'crm-1004', 40, true);
  tenants.push(acmeCorp, globexCorp, initrode);
  tenantConsumers.set(acmeCorp.id, [acme.id]);
  tenantConsumers.set(globexCorp.id, [globex.id]);
  const surface = (db.tenantSurfaces.get(slug) ?? [])[0];
  if (surface) tenantSurfaceIds.set(acmeCorp.id, [surface.id]);
  rateCards.set(acmeCorp.id, [
    {
      id: randomUUID(),
      tenant_id: acmeCorp.id,
      currency: CURRENCY,
      unit: 'request',
      price_millicents_per_unit: 9,
      included_units_per_month: 5_000,
      effective_from: iso(utcMonthStart(now, -3)),
      created_at: iso(utcMonthStart(now, -3) - DAY),
    },
  ]);
}

export function registerMonetizationMock({
  route,
  Problem,
  status,
}: {
  route: Register;
  Problem: ProblemCtor;
  status: StatusFn;
}) {
  seedAll();

  const consumerOf = (slug: string, id: string) => {
    appFor(slug, Problem);
    const c = (consumers.get(slug) ?? []).find((x) => x.id === id);
    if (!c) throw new Problem(404, 'not_found', 'No such consumer.');
    return c;
  };
  const tenantOf = (id: string) => {
    const t = tenants.find((x) => x.id === id);
    if (!t) throw new Problem(404, 'not_found', 'No such customer.');
    return t;
  };
  const metadata = ({ key: _plaintext, ...rest }: ConsumerKey) => rest;

  // --- Consumers --------------------------------------------------------------
  route('GET', '/v1/apps/{slug}/consumers', ({ params }) => {
    appFor(params.slug, Problem);
    return { consumers: consumers.get(params.slug) ?? [] };
  });
  route('POST', '/v1/apps/{slug}/consumers', ({ params, body }) => {
    const app = appFor(params.slug, Problem);
    const ref = String(body.external_ref ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!ref || !name || ref.length > 256 || name.length > 128)
      throw new Problem(400, 'validation_failed', 'external_ref and name are required.');
    const list = consumers.get(params.slug) ?? [];
    if (list.some((c) => c.external_ref === ref))
      throw new Problem(409, 'conflict', `A consumer with external_ref ${ref} already exists.`);
    const now = iso(Date.now());
    const created: Consumer = {
      id: randomUUID(),
      app_id: app.id,
      external_ref: ref,
      name,
      status: 'active',
      created_at: now,
      updated_at: now,
      revoked_at: null,
    };
    consumers.set(params.slug, [...list, created]);
    return status(201, created);
  });
  route('GET', '/v1/apps/{slug}/consumers/{consumer_id}', ({ params }) =>
    consumerOf(params.slug, params.consumer_id)
  );
  route('DELETE', '/v1/apps/{slug}/consumers/{consumer_id}', ({ params }) => {
    const c = consumerOf(params.slug, params.consumer_id);
    if (c.status === 'active') {
      const now = iso(Date.now());
      Object.assign(c, { status: 'revoked', revoked_at: now, updated_at: now });
    }
    return c;
  });

  // --- Keys -------------------------------------------------------------------
  route('GET', '/v1/apps/{slug}/consumers/{consumer_id}/keys', ({ params }) => {
    consumerOf(params.slug, params.consumer_id);
    return { keys: (keys.get(params.consumer_id) ?? []).map(metadata) };
  });
  route('POST', '/v1/apps/{slug}/consumers/{consumer_id}/keys', ({ params, body }) => {
    const c = consumerOf(params.slug, params.consumer_id);
    if (c.status !== 'active')
      throw new Problem(409, 'conflict', 'A revoked consumer cannot be issued keys.');
    const name = String(body.name ?? '').trim();
    const scopes = Array.isArray(body.scopes) ? (body.scopes as ConsumerKey['scopes']) : [];
    if (!name || scopes.length === 0)
      throw new Problem(400, 'validation_failed', 'name and at least one scope are required.');
    const secret = `gcs_${randomBytes(4).toString('hex')}_${randomBytes(20).toString('hex')}`;
    const created: ConsumerKey = {
      id: randomUUID(),
      consumer_id: c.id,
      name,
      prefix: secret.slice(0, 12),
      scopes,
      created_at: iso(Date.now()),
      expires_at: typeof body.expires_at === 'string' ? body.expires_at : null,
      last_used_at: null,
      revoked_at: null,
    };
    keys.set(c.id, [...(keys.get(c.id) ?? []), created]);
    return status(201, { ...created, key: secret });
  });
  route('DELETE', '/v1/apps/{slug}/consumers/{consumer_id}/keys/{key_id}', ({ params }) => {
    consumerOf(params.slug, params.consumer_id);
    const k = (keys.get(params.consumer_id) ?? []).find((x) => x.id === params.key_id);
    if (!k) throw new Problem(404, 'not_found', 'No such key.');
    k.revoked_at ??= iso(Date.now());
    return metadata(k);
  });

  // --- Plans and assignments -------------------------------------------------------
  const limits = (body: Record<string, unknown>, requireAll: boolean) => {
    const read = (k: string) => {
      const v = body[k];
      if (v === undefined && !requireAll) return 0;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
        throw new Problem(400, 'validation_failed', `${k} must be a non-negative integer.`);
      return v;
    };
    const rpm = read('max_requests_per_minute');
    const units = read('max_units_per_month');
    const alerts = body.alert_thresholds_percent as number[] | undefined;
    if (alerts && alerts.length > 0 && units === 0)
      throw new Problem(400, 'validation_failed', 'Alert thresholds need max_units_per_month.');
    return { rpm, units, alerts };
  };
  route('GET', '/v1/apps/{slug}/consumer-plans', ({ params }) => {
    appFor(params.slug, Problem);
    return { plans: plans.get(params.slug) ?? [] };
  });
  route('POST', '/v1/apps/{slug}/consumer-plans', ({ params, body }) => {
    const app = appFor(params.slug, Problem);
    const name = String(body.name ?? '');
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name))
      throw new Problem(400, 'validation_failed', 'name must be a lowercase slug.');
    const list = plans.get(params.slug) ?? [];
    if (list.length >= 20) throw new Problem(402, 'plan_limit_consumer_plans', 'At most 20 plans.');
    if (list.some((p) => p.name === name))
      throw new Problem(409, 'conflict', `A plan named ${name} already exists.`);
    const { rpm, units, alerts } = limits(body, false);
    const now = iso(Date.now());
    const created: Plan = {
      id: randomUUID(),
      app_id: app.id,
      name,
      max_requests_per_minute: rpm,
      max_units_per_month: units,
      alert_thresholds_percent: alerts ?? [],
      created_at: now,
      updated_at: now,
    };
    plans.set(params.slug, [...list, created]);
    return status(201, created);
  });
  route('PUT', '/v1/apps/{slug}/consumer-plans/{plan_id}', ({ params, body }) => {
    appFor(params.slug, Problem);
    const plan = (plans.get(params.slug) ?? []).find((p) => p.id === params.plan_id);
    if (!plan) throw new Problem(404, 'not_found', 'No such plan.');
    const { rpm, units, alerts } = limits(body, true);
    Object.assign(plan, {
      max_requests_per_minute: rpm,
      max_units_per_month: units,
      alert_thresholds_percent: alerts ?? plan.alert_thresholds_percent,
      updated_at: iso(Date.now()),
    });
    return plan;
  });
  route('GET', '/v1/apps/{slug}/consumers/{consumer_id}/plan-assignments', ({ params }) => {
    consumerOf(params.slug, params.consumer_id);
    return { assignments: assignments.get(params.consumer_id) ?? [] };
  });
  route('POST', '/v1/apps/{slug}/consumers/{consumer_id}/plan-assignments', ({ params, body }) => {
    const c = consumerOf(params.slug, params.consumer_id);
    const planId = typeof body.plan_id === 'string' && body.plan_id ? body.plan_id : undefined;
    if (planId && !(plans.get(params.slug) ?? []).some((p) => p.id === planId))
      throw new Problem(400, 'validation_failed', 'plan_id is not a plan of this app.');
    const from =
      typeof body.effective_from === 'string' ? Date.parse(body.effective_from) : nextMinute();
    if (Number.isNaN(from) || from % MINUTE)
      throw new Problem(400, 'validation_failed', 'effective_from must be a whole UTC minute.');
    if (from < Date.now())
      throw new Problem(400, 'validation_failed', 'effective_from cannot be in the past.');
    const created: Assignment = {
      id: randomUUID(),
      consumer_id: c.id,
      ...(planId ? { plan_id: planId } : {}),
      effective_from: iso(from),
      created_at: iso(Date.now()),
    };
    assignments.set(c.id, [...(assignments.get(c.id) ?? []), created]);
    return status(201, created);
  });

  // --- Usage, quote, alerts -----------------------------------------------------------
  route('GET', '/v1/apps/{slug}/consumers/{consumer_id}/usage', ({ params, query }) => {
    const c = consumerOf(params.slug, params.consumer_id);
    const { since, until } = window(query, Problem);
    const buckets = usageBuckets(c, since, until);
    return {
      consumer_id: c.id,
      period_start: iso(since),
      period_end: iso(until),
      request_count: buckets.reduce((n, b) => n + b.request_count, 0),
      error_count: buckets.reduce((n, b) => n + b.error_count, 0),
      billable_units: buckets.reduce((n, b) => n + b.billable_units, 0),
      buckets,
      as_of: iso(nextMinute() - 2 * MINUTE),
    };
  });
  route('GET', '/v1/apps/{slug}/consumers/{consumer_id}/usage/quote', ({ params, query }) => {
    const c = consumerOf(params.slug, params.consumer_id);
    const { since, until } = window(query, Problem);
    return {
      consumer_id: c.id,
      period_start: iso(since),
      period_end: iso(until),
      ...priced(params.slug, c, since, until),
      as_of: iso(nextMinute() - 2 * MINUTE),
    };
  });
  route('GET', '/v1/apps/{slug}/consumers/{consumer_id}/usage-alerts', ({ params }) => {
    consumerOf(params.slug, params.consumer_id);
    return { alerts: alertsByConsumer.get(params.consumer_id) ?? [] };
  });

  // --- Consumer statements ----------------------------------------------------------
  route('GET', '/v1/apps/{slug}/consumers/{consumer_id}/usage-statements', ({ params }) => {
    consumerOf(params.slug, params.consumer_id);
    const list = [...(statements.get(params.consumer_id) ?? [])];
    return {
      statements: list.sort(
        (a, b) => Date.parse(b.period_start) - Date.parse(a.period_start) || b.revision - a.revision
      ),
    };
  });
  route('POST', '/v1/apps/{slug}/consumers/{consumer_id}/usage-statements', ({ params, body }) => {
    const c = consumerOf(params.slug, params.consumer_id);
    const { start, end } = period(body, Problem);
    const quote = priced(params.slug, c, start, end);
    const list = statements.get(c.id) ?? [];
    const same = list.filter(
      (s) => Date.parse(s.period_start) === start && Date.parse(s.period_end) === end
    );
    const latest = same.sort((a, b) => b.revision - a.revision)[0];
    const billedBefore = same
      .filter((s) => s.status === 'finalized')
      .reduce((n, s) => n + s.billable_units, 0);
    if (latest?.status === 'draft' && latest.billable_units === quote.billable_units)
      return status(200, latest);
    if (latest?.status === 'finalized' && quote.billable_units <= billedBefore)
      return status(200, latest);
    if (latest?.status === 'draft') latest.status = 'superseded';
    const adjustment = latest?.status === 'finalized';
    const units = adjustment ? quote.billable_units - billedBefore : quote.billable_units;
    const unit = quote.billable_units ? quote.amount_millicents / quote.billable_units : 0;
    const created: Statement = {
      id: randomUUID(),
      consumer_id: c.id,
      period_start: iso(start),
      period_end: iso(end),
      revision: (latest?.revision ?? 0) + 1,
      status: 'draft',
      ...quote,
      billable_units: units,
      amount_millicents: adjustment ? Math.round(unit * units) : quote.amount_millicents,
      as_of: iso(nextMinute() - 2 * MINUTE),
      created_at: iso(Date.now()),
      finalized_at: null,
    };
    statements.set(c.id, [...list, created]);
    return status(201, created);
  });
  const statementOf = (slug: string, consumerId: string, id: string) => {
    consumerOf(slug, consumerId);
    const s = (statements.get(consumerId) ?? []).find((x) => x.id === id);
    if (!s) throw new Problem(404, 'not_found', 'No such statement.');
    return s;
  };
  route(
    'GET',
    '/v1/apps/{slug}/consumers/{consumer_id}/usage-statements/{statement_id}',
    ({ params }) => statementOf(params.slug, params.consumer_id, params.statement_id)
  );
  route(
    'POST',
    '/v1/apps/{slug}/consumers/{consumer_id}/usage-statements/{statement_id}/finalize',
    ({ params }) => {
      const s = statementOf(params.slug, params.consumer_id, params.statement_id);
      if (s.status === 'finalized') return s;
      if (s.status === 'superseded')
        throw new Problem(409, 'conflict', 'A superseded revision cannot be finalized.');
      if (!s.priced)
        throw new Problem(409, 'conflict', 'Only a fully priced statement can be finalized.');
      Object.assign(s, { status: 'finalized', finalized_at: iso(Date.now()) });
      return s;
    }
  );
  route(
    'GET',
    '/v1/apps/{slug}/consumers/{consumer_id}/usage-statements/{statement_id}/handoff',
    ({ params }) => {
      const s = statementOf(params.slug, params.consumer_id, params.statement_id);
      const receipt = handoffs.get(s.id);
      if (!receipt) throw new Problem(404, 'not_found', 'No handoff recorded for this statement.');
      return receipt;
    }
  );

  // --- Platform tenants -------------------------------------------------------------
  const detail = (t: Tenant) => {
    const linked = tenantConsumers.get(t.id) ?? [];
    const surfaceIds = tenantSurfaceIds.get(t.id) ?? [];
    const surfaces = [...db.tenantSurfaces.values()]
      .flat()
      .filter((s) => surfaceIds.includes(s.id))
      .map((s) => ({ id: s.id, app_id: s.app_id, name: s.name, status: s.status }));
    return { ...t, consumers: allConsumers().filter((c) => linked.includes(c.id)), surfaces };
  };
  route('GET', '/v1/account/platform-tenants', ({ query }) => {
    const limit = Math.min(Number(query.get('limit') ?? 100) || 100, 100);
    const offset = Number(query.get('page_token') || query.get('offset') || 0);
    const page = tenants.slice(offset, offset + limit);
    const more = offset + limit < tenants.length;
    return {
      tenants: page,
      ...(more ? { next_offset: offset + limit, next_page_token: String(offset + limit) } : {}),
    };
  });
  route('POST', '/v1/account/platform-tenants', ({ body }) => {
    const ref = String(body.external_ref ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!ref || !name)
      throw new Problem(400, 'validation_failed', 'external_ref and name are required.');
    const existing = tenants.find((t) => t.external_ref === ref);
    if (existing && existing.name === name) return status(200, existing);
    if (existing)
      throw new Problem(
        409,
        'conflict',
        `external_ref ${ref} is already registered as "${existing.name}".`
      );
    const now = iso(Date.now());
    const created: Tenant = {
      id: randomUUID(),
      external_ref: ref,
      name,
      status: 'active',
      created_at: now,
      updated_at: now,
    };
    tenants.push(created);
    return status(201, created);
  });
  route('GET', '/v1/account/platform-tenants/{id}', ({ params }) => detail(tenantOf(params.id)));
  route('PATCH', '/v1/account/platform-tenants/{id}', ({ params, body }) => {
    const t = tenantOf(params.id);
    if (body.status !== 'active' && body.status !== 'suspended')
      throw new Problem(400, 'validation_failed', 'status must be active or suspended.');
    Object.assign(t, { status: body.status, updated_at: iso(Date.now()) });
    return t;
  });
  route('POST', '/v1/account/platform-tenants/{id}/consumers', ({ params, body }) => {
    const t = tenantOf(params.id);
    const c = allConsumers().find((x) => x.id === body.consumer_id);
    if (!c) throw new Problem(404, 'not_found', 'No such consumer in this account.');
    for (const [other, ids] of tenantConsumers)
      if (other !== t.id && ids.includes(c.id))
        throw new Problem(409, 'conflict', 'That consumer is linked to another customer.');
    const ids = tenantConsumers.get(t.id) ?? [];
    if (!ids.includes(c.id)) tenantConsumers.set(t.id, [...ids, c.id]);
    return c;
  });
  route('POST', '/v1/account/platform-tenants/{id}/surfaces', ({ params, body }) => {
    const t = tenantOf(params.id);
    const s = [...db.tenantSurfaces.values()].flat().find((x) => x.id === body.surface_id);
    if (!s) throw new Problem(404, 'not_found', 'No such tenant surface in this account.');
    for (const [other, ids] of tenantSurfaceIds)
      if (other !== t.id && ids.includes(s.id))
        throw new Problem(409, 'conflict', 'That surface is linked to another customer.');
    const ids = tenantSurfaceIds.get(t.id) ?? [];
    if (!ids.includes(s.id)) tenantSurfaceIds.set(t.id, [...ids, s.id]);
    return { id: s.id, app_id: s.app_id, name: s.name, status: s.status };
  });
  route('GET', '/v1/account/platform-tenants/{id}/rate-cards', ({ params }) => {
    tenantOf(params.id);
    return { rate_cards: rateCards.get(params.id) ?? [] };
  });
  route('POST', '/v1/account/platform-tenants/{id}/rate-cards', ({ params, body }) => {
    const t = tenantOf(params.id);
    const list = rateCards.get(t.id) ?? [];
    const currency = typeof body.currency === 'string' ? body.currency : 'EUR';
    const price = body.price_millicents_per_unit;
    if (typeof price !== 'number' || !Number.isInteger(price) || price < 0)
      throw new Problem(422, 'validation_failed', 'price_millicents_per_unit must be an integer.');
    if (!/^[A-Z]{3}$/.test(currency))
      throw new Problem(422, 'validation_failed', 'currency must be an ISO 4217 code.');
    if (list.length > 0 && list[0].currency !== currency)
      throw new Problem(409, 'conflict', `This customer is priced in ${list[0].currency}.`);
    const from =
      typeof body.effective_from === 'string' ? Date.parse(body.effective_from) : nextMinute();
    if (Number.isNaN(from) || from % MINUTE)
      throw new Problem(422, 'validation_failed', 'effective_from must be a whole UTC minute.');
    const included =
      typeof body.included_units_per_month === 'number' ? body.included_units_per_month : 0;
    if (from < Date.now() && list.some((c) => c.included_units_per_month > 0 || c.tiers?.length))
      throw new Problem(422, 'validation_failed', 'effective_from cannot be in the past here.');
    const created: RateCard = {
      id: randomUUID(),
      tenant_id: t.id,
      currency,
      unit: 'request',
      price_millicents_per_unit: price,
      included_units_per_month: included,
      effective_from: iso(from),
      created_at: iso(Date.now()),
    };
    rateCards.set(
      t.id,
      [...list, created].sort((a, b) => Date.parse(a.effective_from) - Date.parse(b.effective_from))
    );
    return status(201, created);
  });

  const tenantBuckets = (t: Tenant, since: number, until: number) => {
    const linked = allConsumers().filter((c) => (tenantConsumers.get(t.id) ?? []).includes(c.id));
    return linked.flatMap((c) => {
      const byDay = new Map<number, UsageBucket>();
      for (const b of usageBuckets(c, since, until)) {
        const day = Math.floor(Date.parse(b.window_start) / DAY) * DAY;
        const acc = byDay.get(day) ?? {
          window_start: iso(day),
          request_count: 0,
          error_count: 0,
          billable_units: 0,
        };
        acc.request_count += b.request_count;
        acc.error_count += b.error_count;
        acc.billable_units += b.billable_units;
        byDay.set(day, acc);
      }
      return [...byDay.values()].map((b) => ({ app_id: c.app_id, consumer_id: c.id, ...b }));
    });
  };
  route('GET', '/v1/account/platform-tenants/{id}/usage', ({ params, query }) => {
    const t = tenantOf(params.id);
    const { since, until } = window(query, Problem);
    const buckets = tenantBuckets(t, since, until);
    return {
      tenant_id: t.id,
      period_start: iso(since),
      period_end: iso(until),
      request_count: buckets.reduce((n, b) => n + b.request_count, 0),
      error_count: buckets.reduce((n, b) => n + b.error_count, 0),
      billable_units: buckets.reduce((n, b) => n + b.billable_units, 0),
      buckets,
      as_of: iso(nextMinute() - 2 * MINUTE),
    };
  });
  route('GET', '/v1/account/platform-tenants/{id}/usage-statements', ({ params, query }) => {
    tenantOf(params.id);
    const start = Date.parse(query.get('period_start') ?? '');
    const end = Date.parse(query.get('period_end') ?? '');
    if (Number.isNaN(start) || Number.isNaN(end))
      throw new Problem(400, 'validation_failed', 'period_start and period_end are required.');
    return {
      statements: (tenantStatements.get(params.id) ?? [])
        .filter((s) => Date.parse(s.period_start) === start && Date.parse(s.period_end) === end)
        .sort((a, b) => a.revision - b.revision),
    };
  });
  route('POST', '/v1/account/platform-tenants/{id}/usage-statements', ({ params, body }) => {
    const t = tenantOf(params.id);
    const { start, end } = period(body, Problem);
    const card = (rateCards.get(t.id) ?? [])
      .filter((c) => Date.parse(c.effective_from) <= start)
      .at(-1);
    const linked = allConsumers().filter((c) => (tenantConsumers.get(t.id) ?? []).includes(c.id));
    let free = card?.included_units_per_month ?? 0;
    const lines = linked.flatMap((c) => {
      const buckets = usageBuckets(c, start, end);
      if (buckets.length === 0) return [];
      const units = buckets.reduce((n, b) => n + b.billable_units, 0);
      const covered = Math.min(free, units);
      free -= covered;
      const price = card?.price_millicents_per_unit ?? APP_PRICE;
      const base = {
        app_id: c.app_id,
        consumer_id: c.id,
        window_start: buckets[0].window_start,
        window_end: iso(Date.parse(buckets.at(-1)!.window_start) + MINUTE),
        currency: card?.currency ?? CURRENCY,
        ...(card ? { platform_tenant_rate_card_id: card.id } : {}),
      };
      return [
        ...(covered
          ? [
              {
                ...base,
                billable_units: covered,
                price_millicents_per_unit: 0,
                amount_millicents: 0,
              },
            ]
          : []),
        {
          ...base,
          billable_units: units - covered,
          price_millicents_per_unit: price,
          amount_millicents: (units - covered) * price,
        },
      ];
    });
    const list = tenantStatements.get(t.id) ?? [];
    const same = list.filter((s) => Date.parse(s.period_start) === start);
    const latest = same.sort((a, b) => b.revision - a.revision)[0];
    const billable = lines.reduce((n, l) => n + l.billable_units, 0);
    if (latest && latest.billable_units === billable) return status(200, latest);
    if (latest?.status === 'draft') latest.status = 'superseded';
    const created: TenantStatement = {
      id: randomUUID(),
      tenant_id: t.id,
      period_start: iso(start),
      period_end: iso(end),
      revision: (latest?.revision ?? 0) + 1,
      status: 'draft',
      currency: card?.currency ?? CURRENCY,
      billable_units: billable,
      unpriced_units: 0,
      amount_millicents: lines.reduce((n, l) => n + l.amount_millicents, 0),
      lines,
      as_of: iso(nextMinute() - 2 * MINUTE),
      created_at: iso(Date.now()),
    };
    tenantStatements.set(t.id, [...list, created]);
    return status(201, created);
  });
  const tenantStatementOf = (id: string, statementId: string) => {
    tenantOf(id);
    const s = (tenantStatements.get(id) ?? []).find((x) => x.id === statementId);
    if (!s) throw new Problem(404, 'not_found', 'No such statement.');
    return s;
  };
  route('GET', '/v1/account/platform-tenants/{id}/usage-statements/{statement_id}', ({ params }) =>
    tenantStatementOf(params.id, params.statement_id)
  );
  route(
    'POST',
    '/v1/account/platform-tenants/{id}/usage-statements/{statement_id}/finalize',
    ({ params }) => {
      const s = tenantStatementOf(params.id, params.statement_id);
      if (s.status === 'finalized') return s;
      if (s.status === 'superseded' || s.unpriced_units > 0)
        throw new Problem(409, 'conflict', 'Only a fully priced draft can be finalized.');
      Object.assign(s, { status: 'finalized', finalized_at: iso(Date.now()) });
      return s;
    }
  );
  route(
    'GET',
    '/v1/account/platform-tenants/{id}/usage-statements/{statement_id}/handoff',
    ({ params }) => {
      tenantStatementOf(params.id, params.statement_id);
      throw new Problem(404, 'not_found', 'No handoff recorded for this statement.');
    }
  );
  route('GET', '/v1/account/platform-tenants/{id}/credentials', ({ params }) => {
    const t = tenantOf(params.id);
    const linked = tenantConsumers.get(t.id) ?? [];
    return {
      keys: linked.flatMap((id) =>
        (keys.get(id) ?? []).map((k) => ({
          id: k.id,
          consumer_id: id,
          name: k.name,
          prefix: k.prefix,
          scopes: k.scopes,
          created_at: k.created_at,
          ...(k.expires_at ? { expires_at: k.expires_at } : {}),
          ...(k.last_used_at ? { last_used_at: k.last_used_at } : {}),
          ...(k.revoked_at ? { revoked_at: k.revoked_at } : {}),
        }))
      ),
    };
  });
}

/** Every path this module answers, for the spec-drift test. */
export function monetizationMockPaths(): string[] {
  const paths: string[] = [];
  class Stub extends Error {
    constructor(_status: number, code: string) {
      super(code);
    }
  }
  registerMonetizationMock({
    route: (_method, template) => void paths.push(template),
    Problem: Stub,
    status: (_code, body) => body,
  });
  return paths;
}
