import { describe, expect, it } from 'vitest';
import {
  COLS,
  ROWS,
  VIEW_W,
  columnAt,
  hourReadout,
  lastDay,
  lift,
  pillarHeight,
  rowPaths,
  type HourPoint,
} from './traffic-pillars-geometry';

const point = (over: Partial<HourPoint> = {}): HourPoint => ({
  requests: 0,
  error_requests: 0,
  error_rate_pct: 0,
  cold_boots: 0,
  p95_ms: 0,
  ...over,
});

describe('lastDay', () => {
  it('keeps the newest 24 hours, oldest first', () => {
    const points = Array.from({ length: 30 }, (_, i) => point({ requests: i }));
    const day = lastDay(points);
    expect(day).toHaveLength(COLS);
    expect(day[0]?.requests).toBe(6);
    expect(day[23]?.requests).toBe(29);
  });

  it('pads a short series on the old side with empty hours', () => {
    const day = lastDay([point({ requests: 5 })]);
    expect(day).toHaveLength(COLS);
    expect(day.slice(0, 23).every((h) => h === null)).toBe(true);
    expect(day[23]?.requests).toBe(5);
  });
});

describe('pillarHeight', () => {
  it('makes the front pillar proportional to the busiest hour', () => {
    expect(pillarHeight(1000, 1000, 0)).toBeCloseTo(154);
    expect(pillarHeight(500, 1000, 0)).toBeCloseTo(79);
  });

  it('parks every pillar at the floor when nothing was requested', () => {
    for (let r = 0; r < ROWS; r++) expect(pillarHeight(0, 0, r)).toBe(4);
    expect(pillarHeight(0, 1000, 0)).toBe(4);
  });

  it('echoes the hour behind the front row, never taller than it', () => {
    for (let r = 1; r < ROWS; r++)
      expect(pillarHeight(800, 1000, r)).toBeLessThan(pillarHeight(800, 1000, 0));
  });
});

describe('lift', () => {
  it('is nothing at rest and full at the hovered hour of the front row', () => {
    expect(lift(10, 0, 10, 0)).toBe(0);
    expect(lift(10, 0, 10, 1)).toBe(26);
  });

  it('falls off across neighbouring hours and back rows', () => {
    expect(lift(11, 0, 10, 1)).toBeLessThan(lift(10, 0, 10, 1));
    expect(lift(10, 2, 10, 1)).toBeLessThan(lift(10, 0, 10, 1));
    expect(lift(16, 0, 10, 1)).toBe(0);
  });
});

describe('columnAt', () => {
  it('maps a pointer across the frame to the hour under it', () => {
    expect(columnAt(0)).toBe(0);
    expect(columnAt(VIEW_W)).toBe(23);
    expect(columnAt(-50)).toBe(0);
    expect(columnAt(VIEW_W + 50)).toBe(23);
    const mid = columnAt(VIEW_W / 2);
    expect(mid).toBeGreaterThanOrEqual(10);
    expect(mid).toBeLessThanOrEqual(13);
  });
});

describe('rowPaths', () => {
  const day = Array.from({ length: COLS }, (_, i) =>
    point({
      requests: 100 + i * 10,
      error_requests: i === 5 ? 50 : 0,
      error_rate_pct: i === 5 ? 33 : 0,
      cold_boots: i === 7 ? 2 : 0,
    })
  );

  it('rests the same wherever the pointer was', () => {
    for (let r = 0; r < ROWS; r++) expect(rowPaths(r, day, 0, 0)).toEqual(rowPaths(r, day, 23, 0));
  });

  it('marks errors and cold starts on the front row only', () => {
    expect(rowPaths(0, day, 0, 0).errors).not.toBe('');
    expect(rowPaths(0, day, 0, 0).cold).not.toBe('');
    for (let r = 1; r < ROWS; r++) {
      expect(rowPaths(r, day, 0, 0).errors).toBe('');
      expect(rowPaths(r, day, 0, 0).cold).toBe('');
    }
  });

  it('sizes the error band to the share of errors, so a rare error is no band', () => {
    const rare = Array.from({ length: COLS }, () =>
      point({ requests: 1000, error_requests: 1, error_rate_pct: 0.1 })
    );
    expect(rowPaths(0, rare, 0, 0).errors).toBe('');
  });

  it('draws nothing for an hour the series does not cover', () => {
    const short = lastDay([point({ requests: 5 })]);
    const front = rowPaths(0, short, 0, 0);
    expect(front.caps.match(/M/g)).toHaveLength(1);
  });

  it('lifts pillars near the hovered hour', () => {
    expect(rowPaths(0, day, 12, 1)).not.toEqual(rowPaths(0, day, 12, 0));
  });
});

describe('hourReadout', () => {
  it('names the hour and its numbers', () => {
    expect(
      hourReadout(point({ requests: 880, error_requests: 9, error_rate_pct: 1.02, p95_ms: 240 }), 6)
    ).toBe('6h ago · 880 requests · 1.02% errors · p95 240ms');
  });

  it('calls the newest, still-filling bucket this hour so far', () => {
    expect(hourReadout(point({ requests: 12, p95_ms: 30 }), 0)).toBe(
      'This hour so far · 12 requests · no errors · p95 30ms'
    );
  });

  it('adds cold starts when the hour had any', () => {
    expect(hourReadout(point({ requests: 3, p95_ms: 30, cold_boots: 2 }), 1)).toBe(
      '1h ago · 3 requests · no errors · p95 30ms · 2 cold starts'
    );
  });

  it('does not claim a latency for an hour without requests', () => {
    expect(hourReadout(point(), 4)).toBe('4h ago · no requests');
  });

  it('says plainly when the series does not cover the hour', () => {
    expect(hourReadout(null, 20)).toBe('20h ago · not recorded');
  });
});
