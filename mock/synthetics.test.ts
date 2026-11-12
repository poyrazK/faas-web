import { expect, it } from 'vitest';
import * as db from './data';
import { checks } from './notification-channels';
import {
  checkResults,
  createCheck,
  deleteCheck,
  getCheck,
  isProblem,
  setEnabled,
  type Answer,
} from './synthetics';

const app = db.apps[0];
const body = (answer: Answer) => {
  if (isProblem(answer)) throw new Error(`${answer.code}: ${answer.detail}`);
  return answer.body as Record<string, unknown> & { results?: Record<string, unknown> };
};
const base = { name: 'x', path: '/healthz', interval_seconds: 300 };

it('reads a seeded check with uptime, p95 and at most 20 recent runs, newest first', () => {
  const seeded = checks.get(app.slug)![0];
  const results = body(getCheck(app.slug, seeded.id)).results as ReturnType<typeof checkResults>;
  // Every 5 minutes for eight days: 288 runs in the last 24 hours.
  expect(results.runs_24h).toBe(288);
  expect(results.uptime_24h_pct).toBeGreaterThan(98);
  expect(results.uptime_24h_pct).toBeLessThan(100);
  expect(results.p95_latency_ms_24h).toBeGreaterThan(0);
  expect(results.recent).toHaveLength(20);
  const times = results.recent.map((r) => Date.parse(r.started_at));
  expect([...times].sort((a, b) => b - a)).toEqual(times);
  for (const run of results.recent)
    expect(run.ok ? !run.error_class : run.error_class).toBeTruthy();
});

it('gives a new check no runs until its first interval passes, with nulls not zeros', () => {
  const made = body(createCheck(app.slug, { ...base, name: 'mock-new', path: '/api/ping?deep=1' }));
  expect(made).toMatchObject({
    method: 'GET',
    timeout_ms: 10000,
    enabled: true,
    url: `https://${app.slug}.gregale.app/api/ping?deep=1`,
  });
  expect(made).not.toHaveProperty('expected_status');
  const results = body(getCheck(app.slug, String(made.id))).results!;
  expect(results).toMatchObject({ runs_24h: 0, uptime_24h_pct: null, p95_latency_ms_24h: 0 });
  expect(deleteCheck(app.slug, String(made.id))).toEqual({ status: 204 });
});

it('stops recording runs while paused and resumes', () => {
  const seeded = checks.get(app.slug)![0];
  const paused = body(setEnabled(app.slug, seeded.id, false));
  expect(paused.enabled).toBe(false);
  const later = Date.now() + 60 * 60_000;
  const during = checkResults(checks.get(app.slug)![0], later);
  expect(Date.parse(during.recent[0].started_at)).toBeLessThanOrEqual(Date.now());
  expect(body(setEnabled(app.slug, seeded.id, true)).enabled).toBe(true);
  expect(setEnabled(app.slug, seeded.id, 'yes')).toMatchObject({ status: 400 });
});

it('refuses what NormalizeCreateSyntheticCheck refuses, a taken name and a sixth check', () => {
  const code = (b: Record<string, unknown>) => (createCheck(app.slug, b) as { code?: string }).code;
  expect(code({ ...base, name: 'Upper' })).toBe('synthetic_check_invalid');
  expect(code({ ...base, method: 'POST' })).toBe('synthetic_check_invalid');
  expect(code({ ...base, path: '//evil.example' })).toBe('synthetic_check_invalid');
  expect(code({ ...base, expected_status: 700 })).toBe('synthetic_check_invalid');
  expect(code({ ...base, timeout_ms: 999 })).toBe('synthetic_check_invalid');
  expect(code({ ...base, interval_seconds: 60 })).toBe('synthetic_check_invalid');
  expect(createCheck(app.slug, { ...base, name: 'health' })).toMatchObject({
    status: 409,
    code: 'synthetic_check_invalid',
  });

  const other = db.apps[1];
  const made: string[] = [];
  while ((checks.get(other.slug) ?? []).length < 5)
    made.push(String(body(createCheck(other.slug, { ...base, name: `fill-${made.length}` })).id));
  expect(createCheck(other.slug, { ...base, name: 'sixth' })).toMatchObject({
    status: 422,
    code: 'synthetic_check_limit_reached',
  });
  for (const id of made) deleteCheck(other.slug, id);
});

it('deletes the alert rules that name the check with it', () => {
  const seeded = checks.get(app.slug)![0];
  expect(db.alerts.get(app.slug)!.some((r) => r.synthetic_check_id === seeded.id)).toBe(true);
  expect(deleteCheck(app.slug, seeded.id)).toEqual({ status: 204 });
  expect(db.alerts.get(app.slug)!.some((r) => r.synthetic_check_id === seeded.id)).toBe(false);
  expect(getCheck(app.slug, seeded.id)).toMatchObject({ status: 404, code: 'not_found' });
});
