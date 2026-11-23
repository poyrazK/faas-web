import { expect, it } from 'vitest';
import { lastDeploy, projectResident, projectTraffic } from './project-status-data';
import { errorTone } from './project-status';

const row = (request_count: number, over: Record<string, unknown> = {}) => ({
  source: 'prometheus',
  request_count,
  error_rate_pct: 0,
  cold_start_pct: 0,
  latency_p95_ms: 0,
  ...over,
});
const both = new Set(['api', 'worker']);

it('adds counts, weights rates by traffic and names the slowest app', () => {
  const traffic = projectTraffic(
    ['api', 'worker'],
    {
      source: 'prometheus',
      apps: {
        api: row(900, { error_rate_pct: 1, cold_start_pct: 10, latency_p95_ms: 120 }),
        worker: row(100, { error_rate_pct: 11, cold_start_pct: 0, latency_p95_ms: 480 }),
        // Another project's app is not this project's traffic.
        other: row(5000, { error_rate_pct: 50 }),
      },
    },
    both
  );
  expect(traffic.known).toBe(true);
  expect(traffic.totals.requests).toBe(1000);
  expect(traffic.totals.errors).toBe(20);
  expect(traffic.totals.errorRatePct).toBeCloseTo(2);
  expect(traffic.totals.coldRatePct).toBeCloseTo(9);
  expect(traffic.totals.slowest).toEqual({ slug: 'worker', p95Ms: 480 });
});

it('reads an app missing from a healthy rollup as no traffic, not as unknown', () => {
  const traffic = projectTraffic(
    ['api', 'worker'],
    { source: 'prometheus', apps: { api: row(40) } },
    both
  );
  expect(traffic.known).toBe(true);
  expect(traffic.totals.requests).toBe(40);
});

it('is unknown on a degraded rollup, a degraded row, or an app out of reach', () => {
  expect(projectTraffic(['api'], undefined, both).known).toBe(false);
  expect(
    projectTraffic(['api'], { source: 'degraded: prometheus down', apps: {} }, both).known
  ).toBe(false);
  expect(
    projectTraffic(
      ['api'],
      { source: 'prometheus', apps: { api: row(10, { source: 'degraded' }) } },
      both
    ).known
  ).toBe(false);
  // A company's app the account cannot list has no row to trust.
  expect(
    projectTraffic(['api', 'theirs'], { source: 'prometheus', apps: { api: row(10) } }, both).known
  ).toBe(false);
});

it('counts only this project instances that hold memory', () => {
  const ids = new Map([
    ['api', 'a1'],
    ['worker', 'w1'],
  ]);
  const resident = projectResident(['api', 'worker'], ids, {
    instances: [
      { app_id: 'a1', state: 'running', ram_mb: 512 },
      { app_id: 'a1', state: 'RUNNING', ram_mb: 512 },
      { app_id: 'w1', state: 'parked', ram_mb: 256 },
      { app_id: 'zz', state: 'running', ram_mb: 2048 },
    ],
  });
  expect(resident).toEqual({ known: true, count: 2, mb: 1024, apps: 1 });
});

it('does not total a partial instance page or an app it cannot match', () => {
  const ids = new Map([['api', 'a1']]);
  expect(projectResident(['api'], ids, { instances: [], next_before: 'cursor' }).known).toBe(false);
  expect(projectResident(['api'], undefined, { instances: [] }).known).toBe(false);
  expect(projectResident(['api'], ids, undefined).known).toBe(false);
  expect(projectResident(['api', 'worker'], ids, { instances: [] }).known).toBe(false);
  expect(projectResident(['api'], ids, { instances: [] })).toEqual({
    known: true,
    count: 0,
    mb: 0,
    apps: 0,
  });
});

it('finds the latest deploy among the project apps, ignoring never-deployed ones', () => {
  const apps = new Map([
    ['api', { name: 'api', lastDeployedAt: 2000 }],
    ['worker', { name: 'worker', lastDeployedAt: 0 }],
    ['other', { name: 'other', lastDeployedAt: 9000 }],
  ]);
  expect(lastDeploy(['api', 'worker'], apps)).toEqual({ slug: 'api', name: 'api', at: 2000 });
  expect(lastDeploy(['worker', 'missing'], apps)).toBeNull();
});

it('reads an error rate as good, worth a look, or failing', () => {
  expect(errorTone(0)).toBe('good');
  expect(errorTone(1)).toBe('good');
  expect(errorTone(1.01)).toBe('warning');
  expect(errorTone(4.99)).toBe('warning');
  expect(errorTone(5)).toBe('critical');
});
