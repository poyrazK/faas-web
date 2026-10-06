import { describe, expect, it } from 'vitest';
import { logFilters, logsSearch, validateLogsSearch, validLogDate } from './logs-search';

const instance = 'c'.repeat(32);
describe('log investigation search', () => {
  it('round-trips every archive filter through validated URL parameters', () => {
    const search = {
      app: 'api',
      mode: 'archive' as const,
      level: 'error' as const,
      q: 'timeout & retry=1',
      instance,
      date: '2026-09-28',
    };
    expect(logsSearch(logFilters(validateLogsSearch(search)), search.app)).toEqual(search);
    const encoded = new URLSearchParams(search);
    expect(validateLogsSearch(Object.fromEntries(encoded))).toEqual(search);
  });
  it('rejects malformed levels, modes, IDs, dates and non-string values', () => {
    expect(
      validateLogsSearch({
        app: [],
        level: 'debug',
        mode: 'unknown',
        q: {},
        instance: '../keys',
        date: '2026-02-30',
      })
    ).toEqual({});
    expect(validateLogsSearch({ q: 'x'.repeat(2049) })).toEqual({});
    expect(validateLogsSearch({ date: ['2026-09-28'], instance: ['c'.repeat(32)] })).toEqual({});
  });
  it('accepts real leap days and rejects rollover dates and timestamps', () => {
    expect(validLogDate('2024-02-29')).toBe(true);
    for (const date of [
      '2026-02-29',
      '2026-13-01',
      '2026-09-31',
      '2026-9-1',
      '2026-09-01T00:00:00Z',
    ])
      expect(validLogDate(date)).toBe(false);
  });
  it('preserves unknown app names for an explicit unavailable state', () => {
    expect(validateLogsSearch({ app: 'deleted-app' }).app).toBe('deleted-app');
    expect(validateLogsSearch({ app: '../invalid' }).app).toBe('../invalid');
  });
  it('omits defaults and irrelevant archive fields from live links', () => {
    expect(
      logsSearch({ level: '', grep: '', mode: 'live', instance, date: '2026-09-28' }, 'api')
    ).toEqual({ app: 'api' });
    expect(logFilters({}).mode).toBe('live');
    expect(logFilters({}).instance).toBe('');
  });
});
