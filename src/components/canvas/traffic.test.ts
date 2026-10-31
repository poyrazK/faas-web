import { describe, expect, it } from 'vitest';
import { particles } from './traffic';

describe('particles', () => {
  it.each([undefined, 0, -5, Number.NaN])('draws none for %s', (n) => {
    expect(particles(n).count).toBe(0);
  });

  it('never decreases as traffic rises, and caps at four', () => {
    const counts = [1, 24, 240, 2_400, 24_000, 240_000, 24_000_000].map((n) => particles(n).count);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(Math.max(...counts)).toBe(4);
    expect(counts[0]).toBeGreaterThanOrEqual(1);
  });

  it('gives reduced motion a static stroke that still encodes rate', () => {
    expect(particles(undefined).strokeWidth).toBe(1);
    expect(particles(24_000).strokeWidth).toBeGreaterThan(particles(24).strokeWidth);
  });
});

import { edgeLabel } from './traffic';

describe('edgeLabel', () => {
  it('labels a real count and stays silent otherwise', () => {
    expect(edgeLabel(441_600)).toBe('441.6k req / 24h');
    expect(edgeLabel(0)).toBe('0 req / 24h');
    expect(edgeLabel(undefined)).toBeUndefined();
  });
});
