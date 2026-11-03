import { describe, expect, it } from 'vitest';
import { costMonths, monthLabel } from './billing-costs';

describe('costMonths', () => {
  it('offers the report month back to the month retention started, newest first', () => {
    expect(costMonths('2026-11-01T00:00:00Z', '2026-08-10T06:00:00Z')).toEqual([
      '2026-11',
      '2026-10',
      '2026-09',
      '2026-08',
    ]);
  });

  it('crosses a year boundary', () => {
    expect(costMonths('2027-02-01T00:00:00Z', '2026-11-01T00:00:00Z')).toEqual([
      '2027-02',
      '2027-01',
      '2026-12',
      '2026-11',
    ]);
  });

  it('offers only the report month when retention started in it, after it, or is unreadable', () => {
    expect(costMonths('2026-11-01T00:00:00Z', '2026-11-20T00:00:00Z')).toEqual(['2026-11']);
    expect(costMonths('2026-11-01T00:00:00Z', '2027-01-01T00:00:00Z')).toEqual(['2026-11']);
    expect(costMonths('2026-11-01T00:00:00Z', 'not a time')).toEqual(['2026-11']);
  });

  it('is bounded, so a zero retention start cannot build thousands of options', () => {
    const months = costMonths('2026-11-01T00:00:00Z', '0001-01-01T00:00:00Z');
    expect(months).toHaveLength(120);
    expect(months[0]).toBe('2026-11');
  });

  it('offers nothing for an unreadable report month', () => {
    expect(costMonths('', '2026-08-01T00:00:00Z')).toEqual([]);
  });
});

describe('monthLabel', () => {
  it('names the UTC month', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(monthLabel('2027-01')).toBe('January 2027');
  });
});
