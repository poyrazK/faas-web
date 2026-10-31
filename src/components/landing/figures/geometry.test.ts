import { describe, expect, it } from 'vitest';
import {
  COMPUTE,
  DEPLOYS,
  DOMAINS,
  PREVIEWS,
  SECRETS,
  STORAGE,
  STORAGE_LEVELS,
  STORAGE_RISE,
  STORAGE_ROWS,
  TRACE_SPANS,
  TRACES,
  box,
  branchY,
  capsule,
  circle,
  computeLift,
  current,
  deployStroke,
  hash,
  influence,
  sealSize,
  slotFill,
  spanHeight,
} from './geometry';

const FIELDS = { DEPLOYS, COMPUTE, DOMAINS, TRACES, SECRETS, PREVIEWS, STORAGE };

describe('influence', () => {
  it('is nothing at rest, full under the pointer, and gone at the radius', () => {
    expect(influence(100, 50, 100, 50, 0)).toBe(0);
    expect(influence(100, 50, 100, 50, 1)).toBe(1);
    expect(influence(100, 50, 100, 50, 0.4)).toBeCloseTo(0.4);
    expect(influence(170, 50, 100, 50, 1, 70)).toBe(0);
    expect(influence(300, 50, 100, 50, 1, 70)).toBe(0);
  });

  it('falls off smoothly with distance', () => {
    const near = influence(110, 50, 100, 50, 1, 70);
    const mid = influence(130, 50, 100, 50, 1, 70);
    const far = influence(160, 50, 100, 50, 1, 70);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });
});

describe('hash', () => {
  it('is deterministic and stays in [0, 1)', () => {
    for (let i = 0; i < 40; i++)
      for (let j = 0; j < 40; j++) {
        const v = hash(i, j);
        expect(v).toBe(hash(i, j));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
  });
});

describe('shape segments', () => {
  it('draws nothing for an empty shape', () => {
    expect(box(0, 0, 0, 4)).toBe('');
    expect(box(0, 0, 4, 0)).toBe('');
    expect(circle(4, 4, 0)).toBe('');
  });

  it('rounds a capsule fully at its ends', () => {
    expect(capsule(0, 0, 10, 4)).toBe('M2 0h6a2 2 0 0 1 0 4h-6a2 2 0 0 1 0 -4z');
    expect(capsule(0, 0, 4, 4)).toBe('M2 0h0a2 2 0 0 1 0 4h0a2 2 0 0 1 0 -4z');
  });
});

describe('every field', () => {
  it.each(Object.entries(FIELDS))('%s rests the same wherever the pointer was', (_, field) => {
    for (let r = 0; r < field.rows; r++)
      expect(field.row(r, 20, 30, 0)).toEqual(field.row(r, 400, 180, 0));
  });

  it.each(Object.entries(FIELDS))('%s changes only near the pointer', (_, field) => {
    const rest = Array.from({ length: field.rows }, (_, r) => field.row(r, 0, 0, 0));
    const woken = Array.from({ length: field.rows }, (_, r) => field.row(r, 210, 190, 1));
    expect(woken).not.toEqual(rest);
    // The top row is out of reach of a pointer at the bottom edge.
    expect(woken[0]).toEqual(rest[0]);
  });
});

describe('source deploys', () => {
  it('rests as short strokes leaning along the current', () => {
    expect(deployStroke(55, 45, 0, 0, 0)).toEqual({
      angle: current(55, 45),
      length: 5.5,
      width: 1.2,
    });
  });

  it('aligns to the deploy direction under the pointer, longer and bolder', () => {
    const stroke = deployStroke(205, 95, 205, 95, 1);
    expect(stroke.angle).toBeCloseTo(0);
    expect(stroke.length).toBeCloseTo(9.5);
    expect(stroke.width).toBeCloseTo(3.2);
  });

  it('leans neighbours together: the current is smooth', () => {
    expect(Math.abs(current(105, 95) - current(115, 95))).toBeLessThan(0.3);
  });
});

describe('isolated compute', () => {
  it('lifts nothing at rest and lifts a box fully under the pointer', () => {
    expect(computeLift(5, 7, 205, 77, 0)).toBe(0);
    expect(computeLift(4, 7, 195, 60, 1)).toBe(24);
    expect(computeLift(4, 7, 195, 60, 0.5)).toBe(12);
  });
});

describe('custom domains', () => {
  it('draws no routes and no sealed junctions at rest', () => {
    for (let r = 0; r < DOMAINS.rows; r++) {
      const row = DOMAINS.row(r, 0, 0, 0);
      expect(row.route).toBe('');
      expect(row.dot).toBe('');
      expect(row.street).not.toBe('');
      expect(row.ring).not.toBe('');
    }
  });

  it('seals junctions and draws routes around the pointer', () => {
    const row = DOMAINS.row(4, 210, 90, 1);
    expect(row.route).not.toBe('');
    expect(row.dot).not.toBe('');
  });
});

describe('logs and traces', () => {
  it('tiles every row edge to edge with spans of plausible widths', () => {
    for (const spans of TRACE_SPANS) {
      expect(spans[0][0]).toBeLessThanOrEqual(0);
      const [lx, lw] = spans[spans.length - 1];
      expect(lx + lw).toBeGreaterThanOrEqual(420);
      for (const [, w] of spans) {
        expect(w).toBeGreaterThanOrEqual(4);
        expect(w).toBeLessThanOrEqual(48);
      }
    }
  });

  it('rests as hairlines and swells to bars under the pointer', () => {
    expect(spanHeight(0)).toBe(1);
    expect(spanHeight(1)).toBe(10);
  });
});

describe('secrets and config', () => {
  it('rests as round dots and fuses neighbours into a band when sealed', () => {
    expect(sealSize(0)).toEqual({ w: 2.4, h: 2.4 });
    const sealed = sealSize(1);
    expect(sealed.w).toBeGreaterThan(10); // wider than the 10-unit pitch
    expect(sealed.h).toBeLessThan(sealed.w);
  });
});

describe('pr previews', () => {
  it('rests as straight lines', () => {
    for (const y0 of [5, 95, 195]) expect(branchY(150, y0, 0, 0, 0)).toBe(y0);
  });

  it('parts the lines around the pointer without crossing them', () => {
    for (const [x, y] of [
      [210, 100],
      [60, 37],
      [400, 190],
      [210, 5],
    ])
      for (let sx = 0; sx <= 420; sx += 6) {
        let previous = -Infinity;
        for (let i = 0; i < PREVIEWS.rows; i++) {
          const sy = branchY(sx, 5 + 10 * i, x, y, 1);
          expect(sy).toBeGreaterThan(previous);
          previous = sy;
        }
      }
    expect(branchY(210, 85, 210, 100, 1)).toBeLessThan(85);
    expect(branchY(210, 115, 210, 100, 1)).toBeGreaterThan(115);
  });
});

describe('object storage', () => {
  it('rests as a skyline that a full rise never pushes past the top', () => {
    expect(STORAGE_LEVELS.length).toBe(35);
    expect(Math.min(...STORAGE_LEVELS)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...STORAGE_LEVELS) + STORAGE_RISE).toBeLessThanOrEqual(STORAGE_ROWS);
    expect(new Set(STORAGE_LEVELS).size).toBeGreaterThan(3);
  });

  it('fills slots up to the level and raises the stack under the pointer', () => {
    const level = STORAGE_LEVELS[10];
    expect(slotFill(10, level - 1, 0)).toBe(1);
    expect(slotFill(10, level, 0)).toBe(0);
    expect(slotFill(10, level + STORAGE_RISE - 1, 1)).toBe(1);
    expect(slotFill(10, level, 0.5 / STORAGE_RISE)).toBeCloseTo(0.5);
  });
});
