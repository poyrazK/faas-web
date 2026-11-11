import { describe, expect, it } from 'vitest';
import { fleetMetrics } from './overview-stats-data';

const row = (
  request_count: number,
  error_rate_pct: number,
  wake_p95_ms = 0,
  wake_samples?: number
) => ({
  request_count,
  error_rate_pct,
  wake_p95_ms,
  wake_samples,
});

describe('fleetMetrics', () => {
  it('weights the error rate by traffic', () => {
    const m = fleetMetrics([row(10_000, 1), row(10, 100)]);
    expect(m.requests).toBe(10_010);
    expect(m.errored).toBe(110);
    expect(m.errorPct).toBeCloseTo(1.1, 1);
  });

  it('has no error rate when nothing was served', () => {
    expect(fleetMetrics([row(0, 0)]).errorPct).toBeNull();
    expect(fleetMetrics([]).errorPct).toBeNull();
  });

  it('takes the fleet wake p95 only from a row with enough samples', () => {
    expect(fleetMetrics([row(1, 0, 0), row(1, 0, 218, 40)]).wakeP95Ms).toBe(218);
    expect(fleetMetrics([row(1, 0, 218, 3)]).wakeP95Ms).toBeNull();
    expect(fleetMetrics([row(1, 0, 218)]).wakeP95Ms).toBe(218);
  });
});
