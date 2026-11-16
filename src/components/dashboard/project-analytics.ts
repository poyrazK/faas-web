/**
 * A project's own analytics totals, built from its apps' figures.
 *
 * The account summary (`/v1/account/slo`) has no per-project form, so inside a
 * project the totals come from each app's row of `/v1/apps/metrics` over the
 * same window. Only what honestly adds up is added:
 * - requests and estimated errors are counts, so they sum;
 * - error rate and cold-start rate are ratios of those sums, weighted by
 *   traffic, never an average of the apps' percentages;
 * - response-time percentiles cannot be combined at all, so the project gets
 *   its slowest app's p95 instead of a made-up project p95;
 * - throttled requests come from each app's own summary (`/v1/apps/{slug}/slo`)
 *   and sum, for up to `MAX_THROTTLE_APPS` apps.
 * One app with unavailable figures makes the totals unknown rather than
 * quietly smaller.
 */

export interface AppFigures {
  source: string;
  request_count: number;
  error_rate_pct: number;
  cold_start_pct: number;
  latency_p95_ms: number;
}

export interface ProjectTotals {
  /** False when any app's figures are unavailable: totals would be partial. */
  known: boolean;
  /** Apps whose figures are unavailable (degraded metrics). */
  unavailable: number;
  apps: number;
  requests: number;
  /** Estimated from each app's request count and 5xx rate. */
  errors: number;
  errorRatePct: number | null;
  coldRatePct: number | null;
  /** The app with the highest p95 among apps that served requests. */
  slowest: { slug: string; p95Ms: number } | null;
}

export function projectTotals(rows: [slug: string, figures: AppFigures][]): ProjectTotals {
  const measured = rows.filter(([, row]) => row.source === 'prometheus');
  const requests = measured.reduce((n, [, row]) => n + row.request_count, 0);
  const errors = measured.reduce(
    (n, [, row]) => n + (row.request_count * row.error_rate_pct) / 100,
    0
  );
  const cold = measured.reduce(
    (n, [, row]) => n + (row.request_count * row.cold_start_pct) / 100,
    0
  );
  const slowest = measured
    .filter(([, row]) => row.request_count > 0 && row.latency_p95_ms > 0)
    .reduce<ProjectTotals['slowest']>(
      (worst, [slug, row]) =>
        !worst || row.latency_p95_ms > worst.p95Ms ? { slug, p95Ms: row.latency_p95_ms } : worst,
      null
    );
  return {
    known: measured.length === rows.length,
    unavailable: rows.length - measured.length,
    apps: rows.length,
    requests,
    errors: Math.round(errors),
    errorRatePct: requests > 0 ? (errors / requests) * 100 : null,
    coldRatePct: requests > 0 ? (cold / requests) * 100 : null,
    slowest,
  };
}

/** Each app's summary is one request; past this many the project total is not attempted. */
export const MAX_THROTTLE_APPS = 20;

export type ThrottleState =
  | { kind: 'loading' }
  | { kind: 'known'; total: number }
  | { kind: 'unknown'; reason: 'too-many' | 'unavailable' };

export function projectThrottled(
  apps: number,
  results: {
    isPending: boolean;
    error: unknown;
    data?: { source: string; throttled_total: number };
  }[]
): ThrottleState {
  if (apps > MAX_THROTTLE_APPS) return { kind: 'unknown', reason: 'too-many' };
  if (results.some((r) => r.isPending && !r.error)) return { kind: 'loading' };
  if (results.some((r) => r.error || !r.data || r.data.source !== 'prometheus'))
    return { kind: 'unknown', reason: 'unavailable' };
  return { kind: 'known', total: results.reduce((n, r) => n + r.data!.throttled_total, 0) };
}
