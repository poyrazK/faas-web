import { describe, expect, it } from 'vitest';
import { describeCronSchedule, isCronSchedule, upcomingCronRuns } from './cron-schedule';

const next = (schedule: string, after: string, count = 3) =>
  upcomingCronRuns(schedule, new Date(after), count)?.map((date) => date.toISOString());

describe('UTC cron previews', () => {
  it('starts strictly after the current instant and rolls over the year', () => {
    expect(next('*/15 * * * *', '2026-12-31T23:45:00Z')).toEqual([
      '2027-01-01T00:00:00.000Z',
      '2027-01-01T00:15:00.000Z',
      '2027-01-01T00:30:00.000Z',
    ]);
    expect(next('* * * * *', '2026-10-08T12:00:59Z', 1)).toEqual(['2026-10-08T12:01:00.000Z']);
  });
  it('supports names, ranges, lists, question marks, and single-value steps', () => {
    expect(next('0 9 ? JAN,MAR MON-FRI/2', '2026-12-31T23:00:00Z')).toEqual([
      '2027-01-01T09:00:00.000Z',
      '2027-01-04T09:00:00.000Z',
      '2027-01-06T09:00:00.000Z',
    ]);
    expect(next('5/20 9-11/2 * * *', '2026-10-08T09:25:00Z')).toEqual([
      '2026-10-08T09:45:00.000Z',
      '2026-10-08T11:05:00.000Z',
      '2026-10-08T11:25:00.000Z',
    ]);
  });
  it('uses OR for restricted days of month/week, AND when either has a wildcard', () => {
    expect(next('0 0 1 * MON', '2026-10-08T00:00:00Z', 1)).toEqual(['2026-10-12T00:00:00.000Z']);
    expect(next('0 0 * * MON', '2026-10-08T00:00:00Z', 1)).toEqual(['2026-10-12T00:00:00.000Z']);
    expect(next('0 0 */2 * MON', '2026-10-08T00:00:00Z', 1)).toEqual(['2026-10-09T00:00:00.000Z']);
    expect(next('0 0 */1 * MON', '2026-10-08T00:00:00Z', 1)).toEqual(['2026-10-12T00:00:00.000Z']);
  });
  it('finds leap days and annual schedules without inventing impossible dates', () => {
    expect(next('0 0 29 FEB *', '2026-10-08T00:00:00Z', 1)).toEqual(['2028-02-29T00:00:00.000Z']);
    expect(next('0 0 1 1 *', '2026-10-08T00:00:00Z')).toEqual([
      '2027-01-01T00:00:00.000Z',
      '2028-01-01T00:00:00.000Z',
      '2029-01-01T00:00:00.000Z',
    ]);
    expect(next('0 0 30 FEB *', '2026-10-08T00:00:00Z')).toEqual([]);
  });
  it.each([
    '',
    '99 * * * *',
    'a b c d e',
    '* * * * 7',
    '0 0 * DEC-JAN MON',
    '0 0 * JAN MON/0',
    '*/0 * * * *',
    '0 0 0 * *',
    '0 0 * * MON--FRI',
  ])('rejects %s', (value) => {
    expect(isCronSchedule(value)).toBe(false);
    expect(next(value, '2026-10-08T00:00:00Z')).toBeUndefined();
  });
  it('describes common schedules without claiming irregular intervals are uniform', () => {
    expect(describeCronSchedule('*/15 * * * *')).toBe('Every 15 minutes');
    expect(describeCronSchedule('0 9 * * MON-FRI')).toBe('Weekdays at 09:00 UTC');
    expect(describeCronSchedule('*/5 * * * *')).toBe('Every 5 minutes');
    expect(describeCronSchedule('*/7 * * * *')).toBe('Custom schedule · UTC');
  });
});
