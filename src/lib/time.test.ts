import { describe, expect, it } from 'vitest';
import { absoluteTime, parseTime, relativeTime } from './time';

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('reads "just now" within a minute either side', () => {
    expect(relativeTime(NOW, NOW)).toBe('just now');
    expect(relativeTime(NOW - 59_999, NOW)).toBe('just now');
    expect(relativeTime(NOW + 59_999, NOW)).toBe('just now');
  });

  it('counts the past in minutes, hours and days', () => {
    expect(relativeTime(NOW - 60_000, NOW)).toBe('1m ago');
    expect(relativeTime(NOW - 5 * MIN, NOW)).toBe('5m ago');
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe('3h ago');
    expect(relativeTime(NOW - 2 * DAY, NOW)).toBe('2d ago');
  });

  it('counts the future the same way, with "in"', () => {
    expect(relativeTime(NOW + 60_000, NOW)).toBe('in 1m');
    expect(relativeTime(NOW + 5 * MIN, NOW)).toBe('in 5m');
    expect(relativeTime(NOW + 3 * HOUR, NOW)).toBe('in 3h');
    expect(relativeTime(NOW + 2 * DAY, NOW)).toBe('in 2d');
  });

  it('rounds like the existing formatter at the unit boundaries', () => {
    expect(relativeTime(NOW - 90_000, NOW)).toBe('2m ago');
    expect(relativeTime(NOW - (HOUR - 1), NOW)).toBe('60m ago');
    expect(relativeTime(NOW - HOUR, NOW)).toBe('1h ago');
    expect(relativeTime(NOW - DAY, NOW)).toBe('1d ago');
  });

  it('defaults to the real clock', () => {
    expect(relativeTime(Date.now() - 5 * MIN)).toBe('5m ago');
    expect(relativeTime(Date.now() + 3 * DAY + MIN)).toBe('in 3d');
  });
});

describe('absoluteTime', () => {
  it('formats date, time and zone', () => {
    expect(
      absoluteTime(Date.UTC(2026, 9, 20, 14, 3, 5), { locale: 'en-US', timeZone: 'UTC' })
    ).toBe('Oct 20, 2026, 2:03:05 PM UTC');
  });

  it('honours the requested zone', () => {
    expect(
      absoluteTime(Date.UTC(2026, 9, 20, 14, 3, 5), {
        locale: 'en-US',
        timeZone: 'Europe/Istanbul',
      })
    ).toContain('5:03:05 PM');
  });
});

describe('parseTime', () => {
  it('parses ISO strings, numbers and dates to epoch milliseconds', () => {
    expect(parseTime('2026-10-20T14:03:05Z')).toBe(Date.UTC(2026, 9, 20, 14, 3, 5));
    expect(parseTime(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(parseTime(new Date(1_700_000_000_000))).toBe(1_700_000_000_000);
  });

  it('returns undefined for missing, empty, invalid or non-positive input', () => {
    expect(parseTime(undefined)).toBeUndefined();
    expect(parseTime(null)).toBeUndefined();
    expect(parseTime('')).toBeUndefined();
    expect(parseTime('not a date')).toBeUndefined();
    expect(parseTime(0)).toBeUndefined();
    expect(parseTime(-5)).toBeUndefined();
    expect(parseTime(Number.NaN)).toBeUndefined();
    expect(parseTime(new Date('nope'))).toBeUndefined();
    expect(parseTime('0001-01-01T00:00:00Z')).toBeUndefined();
  });
});
