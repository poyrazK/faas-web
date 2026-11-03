import { describe, expect, it } from 'vitest';
import { dailyUsage, dayLabel } from './usage-daily';

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
