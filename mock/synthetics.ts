import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { checks } from './notification-channels';

/**
 * Dev-mock answers for synthetic checks (faas ADR-748,
 * docs/synthetic-checks.md). The definitions are the `checks` map the alert
 * form already reads; this adds one check's results, create, pause or resume,
 * and delete. Routes are registered in `plugin.ts`, one line each.
 *
 * Modelled on faas pkg/api/synthetic_checks.go and handlers_synthetic_*.go:
 * the same bounds, at most 5 per app (422 `synthetic_check_limit_reached`),
 * a taken name is 409 `synthetic_check_invalid`, deleting a check deletes the
 * alert rules that name it, and results are 24h/7d uptime, the 24h p95 of
 * successful runs (0 when none succeeded) and the last 20 runs, newest first.
 * Runs are computed from the check's age and interval, so a new check has
 * none until its first interval passes, and a paused one stops recording.
 */

type S = components['schemas'];
type Check = S['SyntheticCheckResponse'];
type Run = S['SyntheticCheckRun'];
export type MockProblem = { status: number; code: string; detail: string };
export type Answer = { status: number; body?: unknown } | MockProblem;
export const isProblem = (a: Answer): a is MockProblem => 'code' in a;

const problem = (status: number, code: string, detail: string): MockProblem => ({
  status,
  code,
  detail,
});
const ok = (body: unknown, status = 200): Answer => ({ status, body });

const LIMIT = 5;
const NAME = /^[a-z][a-z0-9_-]{0,62}$/;
const PATH = /^\/([^/\s\\][^\s\\]*)?$/;
const INTERVALS = [300, 900, 3600];
const DAY = 86_400_000;
const RECENT = 20;

/** When each paused check stopped running. */
const pausedAt = new Map<string, number>();

/** The first app's health check is watched by a two-failures rule, so the link shows. */
const first = db.apps[0];
const watched = first && checks.get(first.slug)?.[0];
if (watched)
  db.alerts.get(first.slug)?.push({
    id: db.id(),
    app_id: first.id,
    name: `${watched.name} failing`,
    enabled: true,
    metric: 'synthetic_check_consecutive_failures',
    comparison: 'gte',
    threshold: 2,
    window_spec: '1h',
    synthetic_check_id: watched.id,
    webhook_url: 'https://hooks.slack.com/services/T0000/B0000/XXXX',
    webhook_secret_sealed_masked: '***',
    cooldown_minutes: 30,
    action: 'webhook',
    state: 'ok',
    last_evaluated_at: db.iso(60_000),
    created_at: db.iso(4 * DAY),
    updated_at: db.iso(4 * DAY),
  });

const list = (slug: string) => {
  let out = checks.get(slug);
  if (!out) checks.set(slug, (out = []));
  return out;
};

/** Run n of a check: every 97th fails with a 503, every 12th wakes the app. */
function run(check: Check, n: number, at: number): Run {
  const failed = n % 97 === 5;
  const woke = n % 12 === 0;
  return {
    started_at: new Date(at).toISOString(),
    ok: !failed,
    status_code: failed ? 503 : (check.expected_status ?? (check.method === 'HEAD' ? 204 : 200)),
    latency_ms: failed ? 31 : woke ? 780 + (n % 5) * 20 : 60 + ((n * 37) % 80),
    ...(failed ? { error_class: 'status' as const } : {}),
  };
}

/** Every run the check made at or after `since`, newest first. */
function runsSince(check: Check, since: number, now: number): Run[] {
  const step = check.interval_seconds * 1000;
  const created = Date.parse(check.created_at);
  const stop = pausedAt.get(check.id) ?? (check.enabled ? now : created);
  const out: Run[] = [];
  // Run n happens one interval after creation, then every interval.
  for (let n = Math.floor((stop - created) / step); n >= 1; n--) {
    const at = created + n * step;
    if (at < since) break;
    out.push(run(check, n, at));
  }
  return out;
}

function p95(runs: Run[]): number {
  const latencies = runs
    .filter((r) => r.ok)
    .map((r) => r.latency_ms)
    .sort((a, b) => a - b);
  if (!latencies.length) return 0;
  return latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)];
}

const uptime = (runs: Run[]) =>
  runs.length ? (runs.filter((r) => r.ok).length / runs.length) * 100 : null;

export function checkResults(check: Check, now = Date.now()): S['SyntheticCheckResults'] {
  const day = runsSince(check, now - DAY, now);
  const week = runsSince(check, now - 7 * DAY, now);
  return {
    uptime_24h_pct: uptime(day),
    uptime_7d_pct: uptime(week),
    runs_24h: day.length,
    p95_latency_ms_24h: p95(day),
    recent: week.slice(0, RECENT),
  };
}

export function getCheck(slug: string, id: string): Answer {
  const check = list(slug).find((c) => c.id === id);
  if (!check) return problem(404, 'not_found', 'no such synthetic check');
  return ok({ ...check, results: checkResults(check) });
}

/** The checks of NormalizeCreateSyntheticCheck, in its order (synthetic_checks.go:81-104). */
function invalid(b: Record<string, unknown>): string | undefined {
  const method = String(b.method ?? 'GET').toUpperCase();
  const timeout = b.timeout_ms === undefined ? 10_000 : Number(b.timeout_ms);
  if (typeof b.name !== 'string' || !NAME.test(b.name))
    return 'name must match [a-z][a-z0-9_-]{0,62}';
  if (method !== 'GET' && method !== 'HEAD') return 'method must be GET or HEAD';
  if (typeof b.path !== 'string' || b.path.length > 512 || !PATH.test(b.path))
    return "path must start with a single / and contain no whitespace or backslashes (at most 512 bytes); the host is always the app's own";
  const expected = b.expected_status === undefined ? 0 : Number(b.expected_status);
  if (expected !== 0 && (expected < 100 || expected > 599))
    return 'expected_status must be an HTTP status between 100 and 599, or omitted for any 2xx';
  if (!(timeout >= 1000 && timeout <= 30_000)) return 'timeout_ms must be between 1000 and 30000';
  if (!INTERVALS.includes(Number(b.interval_seconds)))
    return 'interval_seconds must be one of [300 900 3600]; shorter intervals would keep the app permanently awake';
  return undefined;
}

export function createCheck(slug: string, b: Record<string, unknown>): Answer {
  const reason = invalid(b);
  if (reason) return problem(400, 'synthetic_check_invalid', reason);
  const rows = list(slug);
  if (rows.length >= LIMIT)
    return problem(
      422,
      'synthetic_check_limit_reached',
      `an app can have at most ${LIMIT} synthetic checks; delete one to add another`
    );
  if (rows.some((c) => c.name === b.name))
    return problem(
      409,
      'synthetic_check_invalid',
      'this app already has a synthetic check with that name'
    );
  const path = String(b.path);
  const check: Check = {
    id: randomUUID(),
    name: String(b.name),
    method: String(b.method ?? 'GET').toUpperCase() as Check['method'],
    path,
    url: `https://${slug}.gregale.app${path}`,
    ...(b.expected_status !== undefined ? { expected_status: Number(b.expected_status) } : {}),
    timeout_ms: b.timeout_ms === undefined ? 10_000 : Number(b.timeout_ms),
    interval_seconds: Number(b.interval_seconds) as Check['interval_seconds'],
    enabled: true,
    created_at: new Date().toISOString(),
  };
  rows.push(check);
  rows.sort((a, c) => a.name.localeCompare(c.name));
  return ok(check, 201);
}

export function setEnabled(slug: string, id: string, enabled: unknown): Answer {
  if (typeof enabled !== 'boolean') return problem(400, 'validation_failed', 'enabled is required');
  const check = list(slug).find((c) => c.id === id);
  if (!check) return problem(404, 'not_found', 'no such synthetic check');
  if (!enabled && check.enabled) pausedAt.set(check.id, Date.now());
  if (enabled) pausedAt.delete(check.id);
  check.enabled = enabled;
  return ok(check);
}

/** Deletes the check, its runs and every alert rule that names it. */
export function deleteCheck(slug: string, id: string): Answer {
  const rows = list(slug);
  const at = rows.findIndex((c) => c.id === id);
  if (at < 0) return problem(404, 'not_found', 'no such synthetic check');
  rows.splice(at, 1);
  pausedAt.delete(id);
  const rules = db.alerts.get(slug);
  if (rules)
    db.alerts.set(
      slug,
      rules.filter((r) => r.synthetic_check_id !== id)
    );
  return { status: 204 };
}
