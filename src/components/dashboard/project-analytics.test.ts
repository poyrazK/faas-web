import { describe, expect, it } from 'vitest';
import {
  MAX_THROTTLE_APPS,
  projectThrottled,
  projectTotals,
  type AppFigures,
} from './project-analytics';

const app = (over: Partial<AppFigures> = {}): AppFigures => ({
  source: 'prometheus',
  request_count: 0,
  error_rate_pct: 0,
  cold_start_pct: 0,
  latency_p95_ms: 0,
  ...over,
});

describe('projectTotals', () => {
  it('adds counts and weights rates by traffic, never averaging percentages', () => {
    const totals = projectTotals([
      [
        'api',
        app({ request_count: 9_900, error_rate_pct: 1, cold_start_pct: 2, latency_p95_ms: 120 }),
      ],
      [
        'etl',
        app({ request_count: 100, error_rate_pct: 50, cold_start_pct: 40, latency_p95_ms: 900 }),
      ],
    ]);
    expect(totals.requests).toBe(10_000);
    expect(totals.errors).toBe(149); // 99 + 50
    // An average of the two rates would say 25.5%.
    expect(totals.errorRatePct).toBeCloseTo(1.49);
    expect(totals.coldRatePct).toBeCloseTo(2.38); // (198 + 40) / 10,000
    expect(totals).toMatchObject({ known: true, unavailable: 0, apps: 2 });
  });

  it('names the slowest app by p95 instead of combining percentiles', () => {
    const totals = projectTotals([
      ['api', app({ request_count: 10, latency_p95_ms: 169 })],
      ['idle', app({ request_count: 0, latency_p95_ms: 4_000 })],
      ['img', app({ request_count: 5, latency_p95_ms: 111 })],
    ]);
    expect(totals.slowest).toEqual({ slug: 'api', p95Ms: 169 });
  });

  it('is unknown, not smaller, when any app’s figures are unavailable', () => {
    const totals = projectTotals([
      ['api', app({ request_count: 10 })],
      ['etl', app({ source: 'degraded: prometheus unavailable', request_count: 0 })],
    ]);
    expect(totals).toMatchObject({ known: false, unavailable: 1 });
  });

  it('has no rates without traffic', () => {
    const totals = projectTotals([['api', app()]]);
    expect(totals).toMatchObject({
      requests: 0,
      errorRatePct: null,
      coldRatePct: null,
      slowest: null,
    });
  });
});

describe('projectThrottled', () => {
  const ok = (throttled_total: number) => ({
    isPending: false,
    error: null,
    data: { source: 'prometheus', throttled_total },
  });

  it('sums each app’s throttled requests', () => {
    expect(projectThrottled(2, [ok(3), ok(20)])).toEqual({ kind: 'known', total: 23 });
  });

  it('waits while any app is loading, and is unknown when one fails or is degraded', () => {
    expect(projectThrottled(2, [ok(1), { isPending: true, error: null }])).toEqual({
      kind: 'loading',
    });
    expect(projectThrottled(2, [ok(1), { isPending: false, error: new Error('x') }])).toEqual({
      kind: 'unknown',
      reason: 'unavailable',
    });
    expect(
      projectThrottled(1, [
        { isPending: false, error: null, data: { source: 'degraded: x', throttled_total: 0 } },
      ])
    ).toEqual({ kind: 'unknown', reason: 'unavailable' });
  });

  it('does not attempt a total past the app cap', () => {
    expect(projectThrottled(MAX_THROTTLE_APPS + 1, [])).toEqual({
      kind: 'unknown',
      reason: 'too-many',
    });
  });
});
