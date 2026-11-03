import { describe, expect, it } from 'vitest';
import {
  METRICS,
  availableMetrics,
  baselineRange,
  comparisonsFor,
  describeCondition,
  metricLabel,
  windowsFor,
} from './alert-metrics';

describe('alert metric catalog', () => {
  it('offers the request metrics and about two dozen more', () => {
    expect(METRICS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(METRICS.map((m) => m.value)).size).toBe(METRICS.length);
  });

  it('hides a metric whose capability is off, as apid refuses its rule', () => {
    const none = availableMetrics(() => false).map((m) => m.value);
    expect(none).toContain('error_rate_pct');
    expect(none).not.toContain('slo_budget_burn');
    expect(none).not.toContain('synthetic_check_latency_p95_ms');
    expect(none).not.toContain('log_search_matches');
    expect(none).not.toContain('custom_metric');
    const slos = availableMetrics((id) => id === 'custom-slos').map((m) => m.value);
    expect(slos).toEqual(expect.arrayContaining(['slo_budget_burn', 'slo_budget_remaining_pct']));
    expect(slos).not.toContain('synthetic_check_consecutive_failures');
  });

  it('limits windows where apid does', () => {
    expect(windowsFor('log_search_matches')).toEqual(['5m', '15m', '1h', '6h', '24h']);
    expect(windowsFor('route_monitor_incidents')).not.toContain('7d');
    expect(windowsFor('error_rate_pct')).toContain('15d');
  });

  it('offers baselines only with the flag and only for the metrics ADR-744 covers', () => {
    expect(comparisonsFor('error_rate_pct', false)).toEqual(['gt', 'gte', 'lt', 'lte']);
    expect(comparisonsFor('error_rate_pct', true)).toContain('above_baseline');
    expect(comparisonsFor('error_rate_pct', true)).not.toContain('below_baseline');
    expect(comparisonsFor('request_count', true)).toContain('below_baseline');
    expect(comparisonsFor('latency_p50_ms', true)).not.toContain('above_baseline');
    expect(baselineRange('above_baseline')).toEqual({ min: 1.5, max: 20 });
    expect(baselineRange('below_baseline')).toEqual({ min: 0.05, max: 0.67 });
    expect(baselineRange('gt')).toBeUndefined();
  });

  it('describes a condition with its unit, and a raw metric it does not know', () => {
    expect(describeCondition({ metric: 'error_rate_pct', comparison: 'gt', threshold: 5 })).toBe(
      'Error rate > 5%'
    );
    expect(describeCondition({ metric: 'latency_p95_ms', comparison: 'gte', threshold: 500 })).toBe(
      'Latency p95 ≥ 500 ms'
    );
    expect(
      describeCondition({ metric: 'request_count', comparison: 'below_baseline', threshold: 0.3 })
    ).toBe('Requests 0.3× usual, below');
    expect(metricLabel('event_paused_seconds')).toBe('event_paused_seconds');
  });
});
