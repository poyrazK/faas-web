import { describe, expect, it } from 'vitest';
import { biggestDay, monthToDateSeries, trendChart } from './usage-trend';

/**
 * `/v1/usage/summary` returns `daily` as the trailing 30 UTC days, while the
 * allowance resets on the UTC calendar month. The running total is only honest
 * when the window reaches back to the 1st; a day with no rollup row is a day
 * with no usage, so it does not break the total.
 */

const NOW = Date.parse('2026-10-09T15:00:00Z');

function day(date: string, gb_hours: number, top_app_slug?: string, top_app_gb_hours?: number) {
  return { date, gb_hours, top_app_slug, top_app_gb_hours };
}

describe('monthToDateSeries', () => {
  it('keeps only the billing month and accumulates in date order', () => {
    const series = monthToDateSeries(
      [day('2026-10-03', 4), day('2026-09-29', 9), day('2026-10-01', 1.5), day('2026-10-02', 2)],
      '2026-10',
      NOW
    );

    expect(series.complete).toBe(true);
    expect(series.points.map((p) => [p.date, p.dayGbHours, p.cumulativeGbHours])).toEqual([
      ['2026-10-01', 1.5, 1.5],
      ['2026-10-02', 2, 3.5],
      ['2026-10-03', 4, 7.5],
    ]);
  });

  it('treats a missing first day as no usage while the window still covers it', () => {
    const series = monthToDateSeries([day('2026-10-05', 3)], '2026-10', NOW);

    expect(series.complete).toBe(true);
    expect(series.points.map((p) => p.cumulativeGbHours)).toEqual([3]);
  });

  it('is incomplete once the 30-day window no longer reaches the 1st', () => {
    // On 31 Oct the trailing window is 2–31 Oct: the 1st's usage is unknown.
    const series = monthToDateSeries(
      [day('2026-10-02', 1), day('2026-10-31', 2)],
      '2026-10',
      Date.parse('2026-10-31T08:00:00Z')
    );

    expect(series.complete).toBe(false);
  });

  it('carries the top app through for each day', () => {
    const series = monthToDateSeries([day('2026-10-01', 5, 'api', 4.5)], '2026-10', NOW);

    expect(series.points[0]).toMatchObject({ topAppSlug: 'api', topAppGbHours: 4.5 });
  });

  it('returns nothing to draw for a missing month or no rollups', () => {
    expect(monthToDateSeries(undefined, '2026-10', NOW).points).toEqual([]);
    expect(monthToDateSeries([day('2026-10-01', 1)], undefined, NOW).points).toEqual([]);
    expect(monthToDateSeries([day('2026-10-01', 1)], 'not-a-month', NOW).points).toEqual([]);
  });
});

describe('trendChart', () => {
  const points = monthToDateSeries(
    [day('2026-10-01', 1), day('2026-10-02', 2)],
    '2026-10',
    NOW
  ).points;

  it('draws the allowance as a constant series so it shares the y-axis', () => {
    const chart = trendChart(points, 50);

    expect(Object.keys(chart.config)).toEqual(['used', 'included']);
    expect(chart.data.map((row) => row.included)).toEqual([50, 50]);
    expect(chart.data.map((row) => row.used)).toEqual([1, 3]);
  });

  it('omits the allowance line when the plan includes none', () => {
    const chart = trendChart(points, 0);

    expect(Object.keys(chart.config)).toEqual(['used']);
    expect(chart.data.every((row) => !('included' in row))).toBe(true);
  });

  it('labels each point by its UTC day', () => {
    expect(trendChart(points, 50).data.map((row) => row.day)).toEqual(['Oct 1', 'Oct 2']);
  });
});

describe('biggestDay', () => {
  it('names the day that added the most, with its top app', () => {
    const { points } = monthToDateSeries(
      [day('2026-10-01', 2, 'web', 1), day('2026-10-02', 9, 'api', 7.5), day('2026-10-03', 3)],
      '2026-10',
      NOW
    );

    expect(biggestDay(points)).toMatchObject({
      date: '2026-10-02',
      dayGbHours: 9,
      topAppSlug: 'api',
      topAppGbHours: 7.5,
    });
  });

  it('has nothing to name without points', () => {
    expect(biggestDay([])).toBeUndefined();
  });
});
