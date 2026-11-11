/**
 * The account's figures from `/v1/apps/metrics`, one row per app. These are
 * platform snapshots over the chosen range, not series, so they are shown as
 * numbers and never drawn as lines.
 */
export interface FleetMetrics {
  requests: number;
  /** Errored share of all requests (0–100), or null when nothing was served. */
  errorPct: number | null;
  errored: number;
  /** Fleet-wide wake p95, or null when too few wakes were sampled to mean it. */
  wakeP95Ms: number | null;
}

/** Wakes needed before a p95 means anything. */
const MIN_WAKE_SAMPLES = 20;

/** The fields read from each app's row of `/v1/apps/metrics`. */
interface MetricsRow {
  request_count: number;
  error_rate_pct: number;
  wake_p95_ms: number;
  wake_samples?: number;
}

export function fleetMetrics(rows: MetricsRow[]): FleetMetrics {
  const requests = rows.reduce((sum, row) => sum + row.request_count, 0);
  // Weighted by traffic, not a mean of percentages: one idle app at 100%
  // must not outweigh a busy one at 0.01%.
  const errored = Math.round(
    rows.reduce((sum, row) => sum + row.request_count * (row.error_rate_pct / 100), 0)
  );
  // The wake histogram is unlabelled upstream — every row carries the same
  // fleet figure, so the first one with enough samples is the figure.
  const wake = rows.find(
    (row) =>
      row.wake_p95_ms > 0 &&
      (row.wake_samples === undefined || row.wake_samples >= MIN_WAKE_SAMPLES)
  );
  return {
    requests,
    errorPct: requests > 0 ? (errored / requests) * 100 : null,
    errored,
    wakeP95Ms: wake?.wake_p95_ms ?? null,
  };
}
