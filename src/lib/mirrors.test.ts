import { describe, expect, it } from 'vitest';
import { mirrorSummaryRows } from './mirrors';

/** Seven numbers become labelled rows; latency carries its unit and sign, the window is humanised. */
describe('mirrorSummaryRows', () => {
  it('labels every field with units', () => {
    const rows = mirrorSummaryRows({
      total_invocations: 1200,
      status_diff_count: 3,
      schema_diff_count: 0,
      body_diff_count: 12,
      mean_latency_diff_ms: -4,
      p99_latency_diff_ms: 31,
      crash_count: 1,
      window_seconds: 3600,
    });
    expect(rows).toEqual([
      ['Window', '1 h'],
      ['Mirrored requests', '1,200'],
      ['Status differs', '3'],
      ['Schema differs', '0'],
      ['Body differs', '12'],
      ['Mean latency Δ', '−4 ms'],
      ['p99 latency Δ', '+31 ms'],
      ['Crashes', '1'],
    ]);
  });

  it('humanises sub-hour windows', () => {
    const rows = mirrorSummaryRows({
      total_invocations: 0,
      status_diff_count: 0,
      schema_diff_count: 0,
      body_diff_count: 0,
      mean_latency_diff_ms: 0,
      p99_latency_diff_ms: 0,
      crash_count: 0,
      window_seconds: 300,
    });
    expect(rows[0]).toEqual(['Window', '5 min']);
    expect(rows[5]).toEqual(['Mean latency Δ', '+0 ms']);
  });
});
