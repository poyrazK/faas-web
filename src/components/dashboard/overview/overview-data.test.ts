import { describe, expect, it } from 'vitest';
import {
  coldBootTicks,
  completeHours,
  dayMarks,
  errorTicks,
  fieldRows,
  gaugeTicks,
  streamGeometry,
  sumSeries,
  totalsOf,
  type AppSeries,
  type SummedPoint,
} from './overview-data';

const hourly = (values: [number, number, number][], from = '2026-11-08T22:00:00Z'): SummedPoint[] =>
  values.map(([requests, error_requests, cold_boots], i) => ({
    start: new Date(Date.parse(from) + i * 3_600_000).toISOString(),
    requests,
    error_requests,
    cold_boots,
  }));

const api: AppSeries = {
  slug: 'api',
  name: 'api',
  points: hourly([
    [100, 1, 1],
    [300, 3, 0],
    [200, 2, 2],
  ]),
};
const etl: AppSeries = {
  slug: 'etl',
  name: 'etl',
  points: hourly([
    [0, 0, 0],
    [40, 20, 1],
    [10, 0, 0],
  ]),
};

describe('sumSeries / totalsOf', () => {
  it('adds counts hour by hour across apps, oldest first', () => {
    const total = sumSeries([etl, api]);
    expect(total.map((p) => p.requests)).toEqual([100, 340, 210]);
    expect(total.map((p) => p.error_requests)).toEqual([1, 23, 2]);
    expect(total[0].start).toBe('2026-11-08T22:00:00.000Z');
  });

  it('reports no error rate over zero requests instead of 0%', () => {
    expect(totalsOf(hourly([[0, 0, 0]])).errorRatePct).toBeNull();
    expect(totalsOf(api.points)).toEqual({
      requests: 600,
      errors: 6,
      coldBoots: 3,
      errorRatePct: 1,
    });
  });
});

describe('completeHours', () => {
  it('drops the hour still in progress and keeps every whole hour', () => {
    const [trimmed] = completeHours([api], '2026-11-09T00:30:00Z');
    expect(trimmed.points.map((p) => p.start)).toEqual([
      '2026-11-08T22:00:00.000Z',
      '2026-11-08T23:00:00.000Z',
    ]);
    expect(completeHours([api], '2026-11-09T01:00:00Z')[0].points).toHaveLength(3);
    expect(completeHours([api], undefined)).toEqual([api]);
  });
});

describe('streamGeometry', () => {
  it('draws one band per app, busiest first', () => {
    const geometry = streamGeometry([etl, api], 1000, 200);
    expect(geometry.bands.map((b) => b.slug)).toEqual(['api', 'etl']);
    expect(geometry.bands.every((b) => b.d.startsWith('M'))).toBe(true);
  });

  it('pins the peak hour and the latest hour, never twice on the same hour', () => {
    const pins = streamGeometry([api, etl], 1000, 200).pins;
    expect(pins).toEqual([
      expect.objectContaining({ kind: 'peak', requests: 340, x: 0.5 }),
      expect.objectContaining({ kind: 'latest', requests: 210, x: 1 }),
    ]);
    const rising: AppSeries = {
      ...api,
      points: hourly([
        [1, 0, 0],
        [2, 0, 0],
        [9, 0, 0],
      ]),
    };
    expect(streamGeometry([rising], 1000, 200).pins.map((p) => p.kind)).toEqual(['peak']);
  });

  it('has nothing to draw from fewer than two hours', () => {
    expect(streamGeometry([{ ...api, points: api.points.slice(0, 1) }], 1000, 200).bands).toEqual(
      []
    );
  });
});

describe('ticks', () => {
  it('leaves request-less hours empty and marks error hours at 5% or more', () => {
    const ticks = errorTicks(
      hourly([
        [0, 0, 0],
        [100, 1, 0],
        [100, 10, 0],
      ])
    );
    expect(ticks.map((t) => t.height === 0)).toEqual([true, false, false]);
    expect(ticks.map((t) => t.hot)).toEqual([false, false, true]);
    expect(ticks[0].label).toMatch(/no requests/);
  });

  it('marks the busiest cold-boot hour', () => {
    expect(coldBootTicks(api.points).map((t) => t.hot)).toEqual([false, false, true]);
  });

  it('lights the gauge up to the used fraction and clamps it', () => {
    expect(gaugeTicks(0.5, 5).map((t) => t.lit)).toEqual([true, true, true, false, false]);
    expect(gaugeTicks(0, 5).some((t) => t.lit)).toBe(false);
    expect(gaugeTicks(3, 5).every((t) => t.lit)).toBe(true);
    expect(gaugeTicks(1, 5).map((t) => t.angle)).toEqual([-90, -45, 0, 45, 90]);
  });
});

describe('fieldRows', () => {
  it('marks idle hours hollow and error hours amber, otherwise scales brightness', () => {
    const [, etlRow] = fieldRows([api, etl]);
    expect(etlRow.cells.map((c) => c.kind)).toEqual(['empty', 'errors', 'traffic']);
    const [apiRow] = fieldRows([api, etl]);
    const levels = apiRow.cells.map((c) => (c.kind === 'traffic' ? c.level : -1));
    expect(levels[1]).toBe(1);
    expect(levels[0]).toBeCloseTo(Math.sqrt(100 / 300));
  });

  it('ignores the error share of an hour with too few requests to mean it', () => {
    const quiet: AppSeries = { ...etl, points: hourly([[4, 4, 0]]) };
    expect(fieldRows([quiet])[0].cells[0].kind).toBe('traffic');
  });
});

describe('dayMarks', () => {
  it('labels the first hour and every UTC midnight', () => {
    expect(dayMarks(api.points).map((m) => m.index)).toEqual([0, 2]);
  });
});
