import { describe, expect, it } from 'vitest';
import type { components } from '@/lib/api/schema';
import { matchesRegression, type Regression } from './debug-search';

type Item = components['schemas']['DebugTelemetryRequestItem'];

const regression: Regression = {
  deployment_id: 'dep-1',
  route: 'GET /orders',
  p95_ms: 900,
  p95_base_ms: 300,
  affected_count: 12,
  regression_factor: '3.0',
  first_detected_at: '2026-10-15T10:00:00Z',
  last_detected_at: '2026-10-15T11:00:00Z',
  state: 'active',
};

const item = (over: Partial<Item> = {}): Item => ({
  received_at: '2026-10-15T10:30:00Z',
  cold_boot: false,
  ...over,
});

describe('matchesRegression', () => {
  it('matches a request on the same release and route', () => {
    expect(
      matchesRegression(item({ deployment_id: 'dep-1', route: 'GET /orders' }), regression)
    ).toBe(true);
  });

  it('never matches a collapsed bucket that lacks a release or route', () => {
    expect(matchesRegression(item(), regression)).toBe(false);
    expect(matchesRegression(item({ deployment_id: 'dep-1' }), regression)).toBe(false);
    expect(matchesRegression(item({ route: 'GET /orders' }), regression)).toBe(false);
  });
});
