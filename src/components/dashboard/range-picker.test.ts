import { describe, expect, it } from 'vitest';
import { monthGrid, PRESETS, rangeHalfLabel, rangeLabel, toLocalInput } from './range-picker';

describe('monthGrid', () => {
  it('pads to whole weeks so the columns stay under their weekday', () => {
    for (const [year, month] of [
      [2026, 8],
      [2026, 1],
      [2024, 1],
    ] as const) {
      const cells = monthGrid(year, month);
      expect(cells.length % 7).toBe(0);
    }
  });

  it('starts the month on its real weekday', () => {
    // 1 September 2026 is a Tuesday, so two leading blanks.
    const cells = monthGrid(2026, 8);
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBeNull();
    expect(cells[2]?.getDate()).toBe(1);
  });

  it('covers a leap February', () => {
    const days = monthGrid(2024, 1).filter(Boolean);
    expect(days).toHaveLength(29);
  });
});

describe('rangeLabel', () => {
  it('names a preset', () => {
    expect(rangeLabel({ kind: 'preset', value: '24h' })).toBe('Last 24 hours');
  });

  it('falls back to the raw value for a window the server clamped us to', () => {
    // The server answers with its own `since`, which need not be one of ours.
    expect(rangeLabel({ kind: 'preset', value: '72h' })).toBe('72h');
  });
});

describe('rangeHalfLabel', () => {
  it('gives every preset something to compare against', () => {
    for (const preset of PRESETS) {
      expect(rangeHalfLabel({ kind: 'preset', value: preset.value })).toBe(preset.half);
    }
  });

  it('describes a custom range without claiming a duration it does not know', () => {
    expect(
      rangeHalfLabel({
        kind: 'custom',
        since: '2026-09-01T00:00:00Z',
        until: '2026-09-02T00:00:00Z',
      })
    ).toBe('the first half of this range');
  });
});

describe('toLocalInput', () => {
  it('writes the local clock, which is what datetime-local reads', () => {
    const d = new Date(2026, 8, 5, 7, 4);
    expect(toLocalInput(d)).toBe('2026-09-05T07:04');
  });
});
