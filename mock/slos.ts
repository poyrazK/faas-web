import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { slos } from './notification-channels';

/**
 * Dev-mock answers for customer-defined SLOs (faas ADR-747, docs/slos.md).
 * The definitions are the `slos` map the alert form already reads; this adds
 * one SLO's status, create and delete. Routes are registered in `plugin.ts`,
 * one line each.
 *
 * Modelled on faas pkg/api/slos.go and handlers_slos.go: the same closed sets
 * and bounds, at most 10 per app (422 `slo_limit_reached`), a taken name is
 * 409 `slo_invalid`, and deleting an SLO deletes the alert rules that name it.
 * Status follows handlers_slo_status.go: the window starts at the later of
 * `window_days` ago and the creation hour, so a new SLO reads pending until
 * its first hour closes. The seeded latency SLO is burning, so every budget
 * state can be seen.
 */

type S = components['schemas'];
type SLO = S['SLOResponse'];
export type MockProblem = { status: number; code: string; detail: string };
export type Answer = { status: number; body?: unknown } | MockProblem;
export const isProblem = (a: Answer): a is MockProblem => 'code' in a;

const problem = (status: number, code: string, detail: string): MockProblem => ({
  status,
  code,
  detail,
});
const ok = (body: unknown, status = 200): Answer => ({ status, body });

const LIMIT = 10;
const NAME = /^[a-z][a-z0-9_-]{0,62}$/;
const THRESHOLDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000];
const HOUR = 3_600_000;
const REQUESTS_PER_HOUR = 3_400;

/** How each seeded SLO is doing: the share of bad requests and the live burn rates. */
const PROFILE = new Map<string, { badRatio: number; burn1h: number; burn6h: number }>();
for (const list of slos.values())
  for (const slo of list)
    PROFILE.set(
      slo.id,
      slo.sli === 'latency'
        ? { badRatio: 0.0041, burn1h: 2.4, burn6h: 1.6 }
        : { badRatio: 0.0005, burn1h: 0.8, burn6h: 1.1 }
    );

/** The first app's availability SLO is watched by a fast-burn rule, so the link shows. */
const first = db.apps[0];
const watched = first && slos.get(first.slug)?.find((s) => s.sli === 'availability');
if (watched)
  db.alerts.get(first.slug)?.push({
    id: db.id(),
    app_id: first.id,
    name: `${watched.name} burning`,
    enabled: true,
    metric: 'slo_budget_burn',
    comparison: 'gt',
    threshold: 14.4,
    window_spec: '1h',
    slo_id: watched.id,
    webhook_url: 'https://hooks.slack.com/services/T0000/B0000/XXXX',
    webhook_secret_sealed_masked: '***',
    cooldown_minutes: 30,
    action: 'webhook',
    state: 'ok',
    last_evaluated_at: db.iso(60_000),
    created_at: db.iso(5 * 86_400_000),
    updated_at: db.iso(5 * 86_400_000),
  });

const list = (slug: string) => {
  let out = slos.get(slug);
  if (!out) slos.set(slug, (out = []));
  return out;
};

export function sloStatus(slo: SLO, now = Date.now()): S['SLOStatus'] {
  const current = Math.floor(now / HOUR) * HOUR;
  const created = Math.floor(Date.parse(slo.created_at) / HOUR) * HOUR;
  const start = Math.max(current - slo.window_days * 24 * HOUR, created);
  const expected = Math.max(0, Math.round((current - start) / HOUR));
  // A seeded 30-day SLO lost two hours to a metrics outage older than the
  // 14-day recovery, so "fewer recorded than expected" is reachable.
  const recorded = slo.window_days === 30 && expected > 48 ? expected - 2 : expected;
  const profile = PROFILE.get(slo.id) ?? { badRatio: 0, burn1h: 0.2, burn6h: 0.1 };
  const total = recorded * REQUESTS_PER_HOUR;
  const bad = Math.round(total * profile.badRatio);
  const good = total - bad;
  const allowed = 1 - slo.objective_pct / 100;
  return {
    window_start: new Date(start).toISOString(),
    hours_recorded: recorded,
    hours_expected: expected,
    good,
    total,
    attainment_pct: total ? (good / total) * 100 : null,
    budget_remaining_pct: total ? (1 - bad / total / allowed) * 100 : null,
    burn_rate_1h: profile.burn1h,
    burn_rate_6h: profile.burn6h,
    source: 'prometheus',
  };
}

export function getSLO(slug: string, id: string): Answer {
  const slo = list(slug).find((s) => s.id === id);
  if (!slo) return problem(404, 'not_found', 'no such SLO');
  return ok({ ...slo, status: sloStatus(slo) });
}

/** The checks of pkg/api/slos.go ValidateCreateSLO, in its order. */
function invalid(body: Record<string, unknown>): string | undefined {
  if (typeof body.name !== 'string' || !NAME.test(body.name))
    return 'name must match [a-z][a-z0-9_-]{0,62}';
  if (body.sli === 'availability') {
    if (body.latency_threshold_ms !== undefined && body.latency_threshold_ms !== 0)
      return 'latency_threshold_ms applies only to the latency SLI';
  } else if (body.sli === 'latency') {
    if (!THRESHOLDS.includes(Number(body.latency_threshold_ms)))
      return `latency_threshold_ms must be one of [${THRESHOLDS.join(' ')}]`;
  } else return 'sli must be availability or latency';
  const pct = Number(body.objective_pct);
  const bp = Math.round(pct * 100);
  if (!Number.isFinite(pct) || Math.abs(bp - pct * 100) > 1e-6 || bp < 9000 || bp > 9999)
    return 'objective_pct must be between 90.00 and 99.99 with at most two decimals';
  if (body.window_days !== 7 && body.window_days !== 30) return 'window_days must be one of [7 30]';
  return undefined;
}

export function createSLO(slug: string, body: Record<string, unknown>): Answer {
  const reason = invalid(body);
  if (reason) return problem(400, 'slo_invalid', reason);
  const rows = list(slug);
  if (rows.length >= LIMIT)
    return problem(
      422,
      'slo_limit_reached',
      `an app can define at most ${LIMIT} SLOs; delete one to add another`
    );
  if (rows.some((s) => s.name === body.name))
    return problem(409, 'slo_invalid', 'this app already has an SLO with that name');
  const slo: SLO = {
    id: randomUUID(),
    name: String(body.name),
    sli: body.sli as SLO['sli'],
    ...(body.sli === 'latency' ? { latency_threshold_ms: Number(body.latency_threshold_ms) } : {}),
    objective_pct: Number(body.objective_pct),
    window_days: body.window_days as SLO['window_days'],
    created_at: new Date().toISOString(),
  };
  rows.push(slo);
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return ok(slo, 201);
}

/** Deletes the SLO and every alert rule that names it (handlers_slos.go:124-134). */
export function deleteSLO(slug: string, id: string): Answer {
  const rows = list(slug);
  const at = rows.findIndex((s) => s.id === id);
  if (at < 0) return problem(404, 'not_found', 'no such SLO');
  rows.splice(at, 1);
  const rules = db.alerts.get(slug);
  if (rules)
    db.alerts.set(
      slug,
      rules.filter((r) => r.slo_id !== id)
    );
  return { status: 204 };
}
