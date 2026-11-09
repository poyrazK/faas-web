import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  duration,
  healthBands,
  summarizeBands,
  type Band,
  type TimelineEntry,
} from './app-health-timeline';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const H = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW - hours * H).toISOString();

const entry = (
  hoursAgo: number,
  status: TimelineEntry['assessment']['status'],
  kind: TimelineEntry['kind'] = 'transition'
): TimelineEntry => ({ kind, observed_at: ago(hoursAgo), assessment: { status } });

/** Bands as [hoursAgoStart, hoursAgoEnd, state], for readable assertions. */
const shape = (bands: Band[]) =>
  bands.map((b) => [(NOW - b.start) / H, (NOW - b.end) / H, b.state]);

describe('healthBands', () => {
  it('holds each status until the next entry and clips to the window', () => {
    const bands = healthBands({
      // Newest first, as the API sends them.
      entries: [entry(2, 'healthy'), entry(5, 'unhealthy'), entry(30, 'healthy', 'baseline')],
      now: NOW,
      evidenceUntil: NOW + 60_000,
      complete: true,
    });
    expect(shape(bands)).toEqual([
      [24, 5, 'healthy'],
      [5, 2, 'unhealthy'],
      [2, 0, 'healthy'],
    ]);
  });

  it('says "not checked" before the first assessment only when history ends there', () => {
    const entries = [entry(6, 'healthy', 'baseline')];
    expect(
      shape(healthBands({ entries, now: NOW, evidenceUntil: NOW, complete: true }))[0]
    ).toEqual([24, 6, 'unchecked']);
    // Older pages exist: the console simply has not read them.
    expect(
      shape(healthBands({ entries, now: NOW, evidenceUntil: NOW, complete: false }))[0]
    ).toEqual([24, 6, 'unrecorded']);
    // The oldest retained entry is a change, so earlier ones were pruned.
    expect(
      shape(
        healthBands({
          entries: [entry(6, 'healthy')],
          now: NOW,
          evidenceUntil: NOW,
          complete: true,
        })
      )[0]
    ).toEqual([24, 6, 'unrecorded']);
  });

  it('keeps a collection gap apart from an unconfirmed assessment', () => {
    const bands = healthBands({
      entries: [
        entry(4, 'healthy'),
        entry(8, 'unknown', 'gap'),
        entry(12, 'unknown'),
        entry(30, 'healthy', 'baseline'),
      ],
      now: NOW,
      evidenceUntil: NOW,
      complete: true,
    });
    expect(shape(bands)).toEqual([
      [24, 12, 'healthy'],
      [12, 8, 'unconfirmed'],
      [8, 4, 'unchecked'],
      [4, 0, 'healthy'],
    ]);
  });

  it('stops the newest status where its evidence expired', () => {
    const bands = healthBands({
      entries: [entry(10, 'healthy', 'baseline')],
      now: NOW,
      evidenceUntil: NOW - 3 * H,
      complete: true,
    });
    expect(shape(bands)).toEqual([
      [24, 10, 'unchecked'],
      [10, 3, 'healthy'],
      [3, 0, 'unchecked'],
    ]);
  });

  it('merges changes that kept the same status', () => {
    const bands = healthBands({
      entries: [entry(3, 'degraded'), entry(6, 'degraded'), entry(30, 'healthy', 'baseline')],
      now: NOW,
      complete: true,
    });
    expect(shape(bands)).toEqual([
      [24, 6, 'healthy'],
      [6, 0, 'degraded'],
    ]);
  });

  it('covers the window with "no record" when nothing is loaded', () => {
    expect(shape(healthBands({ entries: [], now: NOW, complete: false }))).toEqual([
      [24, 0, 'unrecorded'],
    ]);
  });

  it('ignores unparseable times and clamps future ones to now', () => {
    const bands = healthBands({
      entries: [
        { kind: 'transition', observed_at: 'nope', assessment: { status: 'unhealthy' } },
        { ...entry(-1, 'degraded') },
        entry(30, 'healthy', 'baseline'),
      ],
      now: NOW,
      complete: true,
    });
    expect(shape(bands)).toEqual([[24, 0, 'healthy']]);
  });
});

describe('summarizeBands', () => {
  const band = (from: number, to: number, state: Band['state']): Band => ({
    start: NOW - from * H,
    end: NOW - to * H,
    state,
  });

  it('reads like the mockup: healthy hours, then spells in words', () => {
    const bands = [
      band(24, 22, 'healthy'),
      band(22, 19, 'degraded'),
      band(19, 16, 'healthy'),
      band(16, 13, 'unhealthy'),
      band(13, 10, 'healthy'),
      band(10, 7, 'unchecked'),
      band(7, 4, 'healthy'),
      band(4, 1, 'degraded'),
      band(1, 0, 'healthy'),
    ];
    const summary = summarizeBands(bands);
    expect(summary.sentence).toBe(
      'Healthy for 12 of 24 hours · slow or erroring twice, down once, not checked for 3 hours'
    );
    expect(summary.ariaLabel).toBe(
      'Health over the last 24 hours: healthy 12 hours, slow or erroring 6 hours in 2 spells, down 3 hours, not checked 3 hours'
    );
  });

  it('says "all 24 hours" only when every moment was healthy', () => {
    expect(summarizeBands([band(24, 0, 'healthy')]).sentence).toBe('Healthy for all 24 hours');
    const blip = [band(24, 0.01, 'healthy'), band(0.01, 0, 'degraded')];
    expect(summarizeBands(blip).sentence).toBe(
      'Healthy for 23 of 24 hours · slow or erroring once'
    );
  });

  it('starts with what happened when it was never healthy', () => {
    expect(summarizeBands([band(24, 0, 'unrecorded')]).sentence).toBe('No record for 24 hours');
    expect(summarizeBands([band(24, 0.5, 'unchecked'), band(0.5, 0, 'healthy')]).sentence).toBe(
      'Healthy for 30 minutes of the last 24 hours · not checked for 23 hours'
    );
  });
});

describe('duration', () => {
  it('rounds to words', () => {
    expect(duration(20_000)).toBe('under a minute');
    expect(duration(60_000)).toBe('1 minute');
    expect(duration(59.8 * 60_000)).toBe('59 minutes');
    expect(duration(H)).toBe('1 hour');
    expect(duration(DAY_MS)).toBe('24 hours');
    expect(duration(DAY_MS - 0.4 * H, DAY_MS)).toBe('23 hours');
  });
});
