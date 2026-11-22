import { describe, expect, it } from 'vitest';
import { dailyUsage, dayDetail, dayLabel } from './usage-daily';

const at = (iso: string) => Date.parse(iso);

describe('dailyUsage', () => {
  it('lays the month out day by day from the 1st to the last rollup', () => {
    const result = dailyUsage(
      [
        { date: '2026-11-03', gb_hours: 2, top_app_slug: 'api', top_app_gb_hours: 1.5 },
        { date: '2026-11-01', gb_hours: 1 },
      ],
      '2026-11',
      at('2026-11-04T09:00:00Z')
    );
    expect(result.days.map((d) => [d.date, d.gbHours, d.reported])).toEqual([
      ['2026-11-01', 1, true],
      ['2026-11-02', 0, false],
      ['2026-11-03', 2, true],
    ]);
    expect(result.rolledUp).toBe(3);
    expect(result.missing).toBe(1);
    expect(result.fromFirst).toBe(true);
    expect(result.peak).toMatchObject({ date: '2026-11-03', topAppSlug: 'api' });
  });

  it("drops another month's rows rather than summing them in", () => {
    const result = dailyUsage(
      [
        { date: '2026-10-31', gb_hours: 9 },
        { date: '2026-11-01', gb_hours: 1 },
      ],
      '2026-11',
      at('2026-11-01T12:00:00Z')
    );
    expect(result.days.map((d) => d.date)).toEqual(['2026-11-01']);
    expect(result.rolledUp).toBe(1);
  });

  it('starts at the window edge when 30 days no longer reach the 1st', () => {
    // On the 31st the trailing 30 days begin on the 2nd (faas pgstore.go
    // UsageDailyForAccount: day >= today - 29).
    const result = dailyUsage(
      [
        { date: '2026-10-02', gb_hours: 1 },
        { date: '2026-10-31', gb_hours: 1 },
      ],
      '2026-10',
      at('2026-10-31T08:00:00Z')
    );
    expect(result.fromFirst).toBe(false);
    expect(result.days[0].date).toBe('2026-10-02');
    expect(result.days).toHaveLength(30);
  });

  it('is empty without rollups or with a malformed month', () => {
    expect(dailyUsage(undefined, '2026-11').days).toEqual([]);
    expect(dailyUsage([], '2026-11').days).toEqual([]);
    expect(dailyUsage([{ date: '2026-11-01', gb_hours: 1 }], 'November').days).toEqual([]);
  });

  it('names the earliest of equal days as the biggest', () => {
    const result = dailyUsage(
      [
        { date: '2026-11-01', gb_hours: 2 },
        { date: '2026-11-02', gb_hours: 2 },
      ],
      '2026-11',
      at('2026-11-02T12:00:00Z')
    );
    expect(result.peak?.date).toBe('2026-11-01');
  });
});

describe('dayLabel', () => {
  it('names the UTC calendar day', () => {
    expect(dayLabel('2026-11-02')).toBe('Nov 2');
  });
});

describe('dayDetail', () => {
  const usage = dailyUsage(
    [
      { date: '2026-11-01', gb_hours: 0.1 },
      { date: '2026-11-02', gb_hours: 0.2, top_app_slug: 'api', top_app_gb_hours: 0.15 },
      { date: '2026-11-04', gb_hours: 0.9, top_app_slug: 'engine', top_app_gb_hours: 0.66 },
    ],
    '2026-11',
    at('2026-11-04T09:00:00Z')
  );
  const now = at('2026-11-04T09:00:00Z');

  it('reads a day: its hours, the app behind them, against a usual day and the month so far', () => {
    expect(dayDetail(usage, 3, { now, includedGbHours: 10 })).toEqual({
      title: 'Wed, Nov 4 · today so far',
      gbHours: 0.9,
      reported: true,
      top: { slug: 'engine', gbHours: 0.66, pct: 73 },
      versus: null,
      monthSoFar: 1.2,
      allowancePct: 12,
    });
  });

  it('compares a finished day with a usual one', () => {
    expect(dayDetail(usage, 3, { now: at('2026-11-05T01:00:00Z') })).toMatchObject({
      title: 'Wed, Nov 4',
      versus: '2.2× a usual day',
    });
  });

  it('calls a small day quieter, and a middling one usual', () => {
    expect(dayDetail(usage, 0, { now }).versus).toBe('Quieter than a usual day');
    expect(dayDetail(usage, 1, { now }).versus).toBe('Quieter than a usual day');
    const flat = dailyUsage(
      [
        { date: '2026-11-01', gb_hours: 1 },
        { date: '2026-11-02', gb_hours: 1.1 },
      ],
      '2026-11',
      at('2026-11-03T00:00:00Z')
    );
    expect(dayDetail(flat, 1, { now: at('2026-11-03T00:00:00Z') }).versus).toBe(
      'About a usual day'
    );
  });

  it('says a day without a rollup has none, rather than reading it as zero use', () => {
    expect(dayDetail(usage, 2, { now })).toMatchObject({
      title: 'Tue, Nov 3',
      reported: false,
      top: null,
      versus: null,
      monthSoFar: 0.3,
    });
  });
});
