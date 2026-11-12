import { expect, it } from 'vitest';
import {
  compareRequestHalves,
  incompleteTelemetry,
  metricNumber,
  utcLabel,
} from './analytics-data';
import { chosenCards, type AnalyticsPoint } from './analytics-grid';

const points: AnalyticsPoint[] = Array.from({ length: 7 }, (_, hour) => ({
  start: `2026-11-03T0${hour}:00:00Z`,
  requests: hour === 0 || hour === 6 ? 1000 : hour * 10,
  error_requests: 0,
  cold_boots: 0,
  error_rate_pct: 0,
  p50_ms: 10,
  p95_ms: 40,
  p99_ms: 80,
}));

it('compares equal complete hours and excludes partial edges and an odd middle hour', () => {
  const result = compareRequestHalves(
    points,
    'requests',
    '2026-11-03T00:30:00Z',
    '2026-11-03T06:30:00Z'
  );
  expect(result).toMatchObject({
    hours: 2,
    before: 30,
    after: 90,
    delta: 200,
    firstFrom: points[1].start,
    firstUntil: '2026-11-03T03:00:00.000Z',
    lastFrom: points[4].start,
    lastUntil: '2026-11-03T06:00:00.000Z',
  });
});

it('does not invent percentage changes without a baseline, enough hours or complete telemetry', () => {
  expect(
    compareRequestHalves(points, 'errors', points[0].start, points[6].start)?.delta
  ).toBeNull();
  expect(
    compareRequestHalves(points.slice(0, 3), 'requests', points[0].start, points[6].start)
  ).toBeNull();
  expect(compareRequestHalves(points, 'p95', points[0].start, points[6].start)).toBeNull();
  expect(
    chosenCards(['requests'], points, '', {
      from: points[0].start,
      until: points[6].start,
      incomplete: true,
    })[0].delta
  ).toBeNull();
  expect(incompleteTelemetry({ telemetry_complete: false })).toBe(true);
  expect(incompleteTelemetry({})).toBe(false);
});

it('leaves rates and latency without samples unavailable and formats instants in UTC', () => {
  const empty = { ...points[0], requests: 0 };
  for (const metric of ['p50', 'p95', 'p99', 'error_rate', 'cold_rate'] as const)
    expect(metricNumber(metric, empty)).toBeNull();
  expect(metricNumber('requests', empty)).toBe(0);
  expect(utcLabel('2026-11-03T03:00:00+03:00')).toContain('00:00');
});
