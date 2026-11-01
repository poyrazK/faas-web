import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
type Kind = 'gauge' | 'counter';
type Stored = { value: number; observedAt: number; kind: Kind };

/** apid's CustomMetricFreshnessSeconds and MaxCustomMetricsPerApp (pkg/api/limits.go). */
export const FRESHNESS_SECONDS = 300;
export const MAX_METRICS = 5;
/** apid's CustomMetricSeriesSteps. */
const STEPS: Record<string, { step: string; ms: number; hours: number }> = {
  '1h': { step: '1m', ms: 60_000, hours: 1 },
  '6h': { step: '5m', ms: 300_000, hours: 6 },
  '24h': { step: '15m', ms: 900_000, hours: 24 },
  '7d': { step: '1h', ms: 3_600_000, hours: 168 },
  '15d': { step: '2h', ms: 7_200_000, hours: 360 },
};

/**
 * The first app has a fresh backlog gauge, a gauge whose pusher stopped an
 * hour ago, and an OTLP counter; every other app starts with none.
 */
export const store = new Map<string, Map<string, Stored>>(
  db.apps.map((a, i): [string, Map<string, Stored>] => [
    a.slug,
    new Map(
      i === 0 && !db.EMPTY
        ? [
            ['orders_pending', { value: 1284, observedAt: Date.now() - 40_000, kind: 'gauge' }],
            ['ocr_backlog', { value: 7, observedAt: Date.now() - 3_600_000, kind: 'gauge' }],
            [
              'payments_failed',
              { value: 31_204, observedAt: Date.now() - 25_000, kind: 'counter' },
            ],
          ]
        : []
    ),
  ])
);

const metricsOf = (slug: string) => {
  let m = store.get(slug);
  if (!m) store.set(slug, (m = new Map()));
  return m;
};

export function pushMetric(slug: string, name: string, value: number, at = Date.now()) {
  const prior = metricsOf(slug).get(name);
  metricsOf(slug).set(name, { value, observedAt: at, kind: prior?.kind ?? 'gauge' });
}

export function listFor(slug: string): S['CustomMetricListResponse'] {
  const now = Date.now();
  return {
    metrics: [...metricsOf(slug)].map(([name, m]) => ({
      name,
      value: m.value,
      observed_at: new Date(m.observedAt).toISOString(),
      stale: now - m.observedAt > FRESHNESS_SECONDS * 1000,
      kind: m.kind,
    })),
    freshness_seconds: FRESHNESS_SECONDS,
    max_metrics: MAX_METRICS,
  };
}

/**
 * History as apid's Prometheus query returns it: only fresh pushes were
 * exported, so nothing is recorded after a pusher stops; counters come back
 * as a per-second rate.
 */
export function seriesFor(
  slug: string,
  name: string,
  range: string
): S['CustomMetricSeriesResponse'] {
  const { step, ms, hours } = STEPS[range];
  const m = metricsOf(slug).get(name);
  const kind: Kind = m?.kind ?? 'gauge';
  const now = Date.now();
  const lastRecorded = m ? m.observedAt + FRESHNESS_SECONDS * 1000 : 0;
  const points: S['CustomMetricSeriesPoint'][] = [];
  for (let t = now - hours * 3_600_000; t <= now; t += ms) {
    if (!m || t > lastRecorded) continue;
    const phase = t / 3_600_000;
    const wave = 0.6 + 0.4 * Math.sin(phase / 3) + 0.1 * Math.sin(phase * 2.3);
    const value = kind === 'counter' ? 0.02 + 0.015 * Math.abs(Math.sin(phase)) : m.value * wave;
    points.push({ at: new Date(Math.floor(t / ms) * ms).toISOString(), value });
  }
  return { app_id: slug, name, kind, range: range as never, step, source: 'prometheus', points };
}
