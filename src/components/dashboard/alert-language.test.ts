import { describe, expect, it } from 'vitest';
import {
  alertActionLabel,
  alertConditionParts,
  alertWindowLabel,
  explainAlertCondition,
} from './alert-language';

const condition = { metric: 'error_rate_pct', comparison: 'gte', threshold: 5, window_spec: '15m' };

describe('plain-language alert conditions', () => {
  it('preserves inclusive comparisons, units and rolling windows', () => {
    expect(explainAlertCondition(condition)).toBe('Error rate is at least 5%');
    expect(alertConditionParts(condition).window).toBe('15 minutes');
    expect(
      explainAlertCondition({ ...condition, metric: 'latency_p95_ms', comparison: 'lt' })
    ).toBe('Latency p95 is below 5 ms');
    expect(alertWindowLabel('1h')).toBe('1 hour');
  });

  it('describes a scaled baseline without treating its multiplier as a percent', () => {
    const result = alertConditionParts({
      ...condition,
      comparison: 'below_baseline',
      threshold: 0.5,
    });
    expect(result).toMatchObject({
      comparison: 'below',
      value: '0.5× the usual value',
      baseline: true,
    });
  });

  it('omits ignored windows and retains unknown metrics and comparisons', () => {
    expect(alertConditionParts({ ...condition, metric: 'slo_budget_burn' })).toMatchObject({
      value: '5× budget',
      window: undefined,
    });
    expect(
      alertConditionParts({ ...condition, metric: 'synthetic_check_consecutive_failures' }).window
    ).toBeUndefined();
    expect(
      explainAlertCondition({
        ...condition,
        metric: 'future_metric',
        comparison: 'future_comparison',
      })
    ).toBe('future_metric is future_comparison 5');
  });

  it('never presents a deployment-changing action as a notification alone', () => {
    expect(alertActionLabel('rollback')).toContain('roll back');
    expect(alertActionLabel('demote')).toContain('hold the canary');
    expect(alertActionLabel('promote')).toContain('promote the canary');
    expect(alertActionLabel('future_action')).toBe('Action: future_action');
  });
});
