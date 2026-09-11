import { describe, expect, it } from 'vitest';
import { applyOrder, buildCards, move, type AnalyticsPoint } from './analytics-grid';

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

describe('move', () => {
  it('reorders without mutating its input', () => {
    const list = ['a', 'b', 'c'];
    expect(move(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('returns the same array for a no-op or an out-of-range move', () => {
    const list = ['a', 'b'];
    expect(move(list, 1, 1)).toBe(list);
    expect(move(list, 0, 5)).toBe(list);
    expect(move(list, -1, 0)).toBe(list);
  });
});

describe('applyOrder', () => {
  const cards = buildCards(points([1, 2, 3, 4]), 'the hours before');

  it('puts a stored order first and keeps membership out of it', () => {
    const ordered = applyOrder(cards, ['p95', 'requests']);
    expect(ordered.slice(0, 2).map((c) => c.id)).toEqual(['p95', 'requests']);
    // Every card still renders — a stored order decides sequence, never which
    // cards exist, so shipping a new card reaches people who have reordered.
    expect(ordered).toHaveLength(cards.length);
  });

  it('drops a stored id that no longer exists', () => {
    const ordered = applyOrder(cards, ['retired-card', 'p50']);
    expect(ordered.map((c) => c.id)).not.toContain('retired-card');
    expect(ordered[0].id).toBe('p50');
  });

  it('is the identity when nothing is stored', () => {
    expect(applyOrder(cards, []).map((c) => c.id)).toEqual(cards.map((c) => c.id));
  });
});

describe('buildCards', () => {
  it('reads its figures off the series, not off a scalar', () => {
    const cards = buildCards(points([10, 10, 30, 30]), 'the hours before');
    const requests = cards.find((c) => c.id === 'requests')!;
    expect(requests.value).toBe('80');
    // 20 in the first half, 60 in the second.
    expect(requests.delta).toBeCloseTo(200);
  });

  it('withholds a delta when the window is too short to halve', () => {
    expect(buildCards(points([5, 5]), 'x').find((c) => c.id === 'requests')!.delta).toBeNull();
  });

  it('withholds a delta rather than dividing by an empty first half', () => {
    const quiet = buildCards(points([0, 0, 0, 0]), 'x').find((c) => c.id === 'requests')!;
    expect(quiet.delta).toBeNull();
    expect(quiet.value).toBe('0');
  });

  it('says what the delta is measured against, in every caption that has one', () => {
    for (const card of buildCards(points([1, 2, 3, 4]), 'the 12 hours before')) {
      if (card.delta !== null) expect(card.caption).toContain('the 12 hours before');
    }
  });

  it('reports an error rate of zero rather than NaN when nothing was served', () => {
    expect(buildCards(points([0, 0, 0, 0]), 'x').find((c) => c.id === 'error_rate')!.value).toBe(
      '0.00%'
    );
  });
});
