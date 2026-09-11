import { describe, expect, it } from 'vitest';
import {
  availableMetrics,
  buildCard,
  CATALOG,
  chosenCards,
  DEFAULT_IDS,
  type AnalyticsPoint,
  type MetricDef,
} from './analytics-grid';

function points(counts: number[]): AnalyticsPoint[] {
  return counts.map((requests, i) => ({
    start: `2026-09-11T0${i}:00:00.000Z`,
    requests,
    error_requests: 0,
    error_rate_pct: 0,
    cold_boots: 0,
    p50_ms: 10,
    p95_ms: 20,
    p99_ms: 30,
  }));
}

const def = (id: string): MetricDef => CATALOG.find((d) => d.id === id)!;

describe('the catalog', () => {
  it('ships every default', () => {
    for (const id of DEFAULT_IDS) expect(CATALOG.map((d) => d.id)).toContain(id);
  });

  it('offers more than it shows, so the picker is never empty on a fresh grid', () => {
    expect(availableMetrics(DEFAULT_IDS).length).toBeGreaterThan(0);
  });

  it('uses each id once — two cards of one metric would reorder against itself', () => {
    expect(new Set(CATALOG.map((d) => d.id)).size).toBe(CATALOG.length);
  });
});

describe('availableMetrics', () => {
  it('offers only what is not already on the grid', () => {
    const available = availableMetrics(['requests', 'p95']).map((d) => d.id);
    expect(available).not.toContain('requests');
    expect(available).not.toContain('p95');
    expect(available).toContain('p99');
  });

  it('offers nothing once every metric is on the grid', () => {
    expect(availableMetrics(CATALOG.map((d) => d.id))).toEqual([]);
  });
});

describe('chosenCards', () => {
  it('keeps the reader’s order', () => {
    const ids = chosenCards(['p95', 'requests'], points([1, 2, 3, 4]), 'x').map((c) => c.id);
    expect(ids).toEqual(['p95', 'requests']);
  });

  it('skips an id we no longer ship rather than rendering a hole', () => {
    const ids = chosenCards(['retired', 'p50'], points([1, 2, 3, 4]), 'x').map((c) => c.id);
    expect(ids).toEqual(['p50']);
  });

  it('renders an empty grid for a reader who cleared theirs', () => {
    expect(chosenCards([], points([1, 2, 3, 4]), 'x')).toEqual([]);
  });
});

describe('buildCard', () => {
  it('reads its figures off the series, not off a scalar', () => {
    const card = buildCard(def('requests'), points([10, 10, 30, 30]), 'x');
    expect(card.value).toBe('80');
    // 20 in the first half, 60 in the second.
    expect(card.delta).toBeCloseTo(200);
  });

  it('withholds a delta when the window is too short to halve', () => {
    expect(buildCard(def('requests'), points([5, 5]), 'x').delta).toBeNull();
  });

  it('withholds a delta rather than dividing by an empty first half', () => {
    const quiet = buildCard(def('requests'), points([0, 0, 0, 0]), 'x');
    expect(quiet.delta).toBeNull();
    expect(quiet.value).toBe('0');
  });

  it('says what every delta is measured against', () => {
    for (const metric of CATALOG) {
      const card = buildCard(metric, points([1, 2, 3, 4]), 'the 12 hours before');
      if (card.delta !== null) expect(card.caption).toContain('the 12 hours before');
    }
  });

  it('reports an error rate of zero rather than NaN when nothing was served', () => {
    expect(buildCard(def('error_rate'), points([0, 0, 0, 0]), 'x').value).toBe('0.00%');
  });

  it('shows a dash for a latency with no bucket to read', () => {
    expect(buildCard(def('p99'), [], 'x').value).toBe('—');
  });
});
