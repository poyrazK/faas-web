import { describe, expect, it } from 'vitest';
import {
  branchCommit,
  branchHeight,
  branchNodeX,
  branchPath,
  cellAt,
  cellCore,
  CELLS,
  COMMITS,
  deployBar,
  deployDotRadius,
  deployFrame,
  deployProgress,
  DEPLOY_REST,
  domainFill,
  dotX,
  objectPos,
  objectRest,
  objectSlot,
  OBJECTS,
  perimeterPath,
  ringRadius,
  RINGS,
  rowCentre,
  rowSeal,
  ROWS,
  shackleLift,
  spanCrossed,
  SPANS,
  storeFill,
  traceCursor,
} from './geometry';

describe('source deploys', () => {
  it('rests as scattered faint bars with no frame and no live dot', () => {
    const p = deployProgress(400, 0);
    expect(p).toBe(0);
    expect(deployBar(0, p)).toEqual({ x: 28, y: 34, fillOpacity: 0.25 });
    expect(deployBar(11, p)).toEqual({ x: 72, y: 96, fillOpacity: 0.25 });
    expect(deployFrame(p)).toBe(0);
    expect(deployDotRadius(p)).toBe(0);
  });

  it('stacks the bars into the image, closes the snapshot and lights the dot at full progress', () => {
    const p = deployProgress(340, 1);
    expect(p).toBe(1);
    expect(deployBar(0, p)).toEqual({ x: 230, y: 46, fillOpacity: 1 });
    expect(deployBar(11, p)).toEqual({ x: 230, y: 145, fillOpacity: 1 });
    expect(deployFrame(p)).toBe(1);
    expect(deployDotRadius(p)).toBe(6);
  });

  it('draws the snapshot frame only past two thirds and the dot only past 0.85', () => {
    expect(deployFrame(0.66)).toBe(0);
    expect(deployFrame(0.83)).toBeCloseTo(0.5);
    expect(deployDotRadius(0.85)).toBe(0);
    expect(deployDotRadius(0.925)).toBeCloseTo(3);
  });

  it('traces the rectangle perimeter clockwise up to the drawn fraction', () => {
    expect(perimeterPath(0, 0, 10, 5, 0)).toBe('M 0 0');
    expect(perimeterPath(0, 0, 10, 5, 1)).toBe('M 0 0 L 10 0 L 10 5 L 0 5 L 0 0');
    // A third of 30 is 10: exactly the top edge.
    expect(perimeterPath(0, 0, 10, 5, 1 / 3)).toBe('M 0 0 L 10 0');
    expect(perimeterPath(0, 0, 10, 5, 0.5)).toBe('M 0 0 L 10 0 L 10 5');
  });

  it('keeps all twelve rest positions inside the left half', () => {
    expect(DEPLOY_REST).toHaveLength(12);
    for (const [x, y] of DEPLOY_REST) {
      expect(x + 64).toBeLessThanOrEqual(210);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + 5).toBeLessThanOrEqual(200);
    }
  });
});

describe('isolated compute', () => {
  it('lays out a 6 × 3 grid inside the frame', () => {
    expect(CELLS).toHaveLength(18);
    expect(CELLS[0]).toEqual({ x: 17, y: 18 });
    expect(CELLS[17]).toEqual({ x: 347, y: 134 });
  });

  it('finds the cell under the pointer, and none in the gaps', () => {
    expect(cellAt(17 + 28, 18 + 24)).toBe(0);
    expect(cellAt(347 + 10, 134 + 10)).toBe(17);
    // x 76 sits in the 10px gap between columns 0 and 1.
    expect(cellAt(78, 40)).toBe(-1);
    // y 70 sits in the gap between rows 0 and 1.
    expect(cellAt(45, 70)).toBe(-1);
  });

  it('swells only the hovered cell, scaled by active', () => {
    expect(cellCore(4, 4, 1)).toEqual({ size: 30, stroke: 2.5 });
    expect(cellCore(4, 4, 0)).toEqual({ size: 12, stroke: 1 });
    expect(cellCore(3, 4, 1)).toEqual({ size: 12, stroke: 1 });
    expect(cellCore(4, -1, 1)).toEqual({ size: 12, stroke: 1 });
  });
});

describe('custom domains', () => {
  it('rests with an empty fill, plain rings and a lifted shackle', () => {
    const f = domainFill(300, 0);
    expect(f).toBe(0);
    for (const cx of RINGS) expect(ringRadius(cx, cx, 0)).toBe(14);
    expect(shackleLift(f)).toBe(-6);
  });

  it('fills to the pointer, widens the nearest ring, and closes the lock at the app', () => {
    expect(domainFill(214, 1)).toBeCloseTo(0.5);
    expect(ringRadius(214, 214, 1)).toBe(20);
    expect(ringRadius(150, 214, 1)).toBe(14);
    expect(domainFill(344, 1)).toBe(1);
    expect(shackleLift(1)).toBeCloseTo(0);
    expect(shackleLift(0.9)).toBe(-6);
  });
});

describe('logs and traces', () => {
  it('keeps the cursor on the trace and crosses the right spans', () => {
    expect(traceCursor(0)).toBe(24);
    expect(traceCursor(400)).toBe(324);
    expect(SPANS).toHaveLength(7);
    const crossed = SPANS.map((_, i) => spanCrossed(i, 170));
    // Span 2 ends at 168, just short of the cursor.
    expect(crossed).toEqual([true, true, false, true, true, false, false]);
  });
});

describe('secrets and config', () => {
  it('seals only the row under the pointer, and none at the midpoint', () => {
    expect(ROWS).toBe(6);
    expect(rowSeal(2, rowCentre(2), 1)).toBe(1);
    expect(rowSeal(1, rowCentre(2), 1)).toBe(0);
    const midpoint = (rowCentre(2) + rowCentre(3)) / 2;
    expect(rowSeal(2, midpoint, 1)).toBe(0);
    expect(rowSeal(3, midpoint, 1)).toBe(0);
    expect(rowSeal(2, rowCentre(2), 0)).toBe(0);
  });

  it('gathers the dots to the centre as the row seals', () => {
    expect(dotX(0, 0)).toBe(132);
    expect(dotX(7, 0)).toBe(314);
    expect(dotX(0, 1)).toBe(223);
    expect(dotX(7, 1)).toBe(223);
  });
});

describe('pr previews', () => {
  it('rests flat and forks from the nearest commit', () => {
    expect(COMMITS).toEqual([44, 86, 128, 170, 212, 254, 296, 338, 380]);
    expect(branchCommit(0)).toBe(44);
    expect(branchCommit(150)).toBe(170);
    expect(branchCommit(999)).toBe(380);
    expect(branchHeight(0)).toBe(0);
    expect(branchPath(170, 0)).toBe('M 170 140 C 170 140 210 140 210 140');
  });

  it('forks left near the right edge so the node stays in frame', () => {
    expect(branchNodeX(296)).toBe(336);
    expect(branchNodeX(338)).toBe(298);
    expect(branchNodeX(380)).toBe(340);
    for (const cx of COMMITS) expect(branchNodeX(cx) + 22).toBeLessThanOrEqual(420);
    expect(branchPath(338, 1)).toBe('M 338 140 C 338 98 298 70 298 70');
  });
});

describe('object storage', () => {
  it('rests with every object in the app frame and the bucket empty', () => {
    expect(OBJECTS).toBe(24);
    expect(storeFill(400, 0)).toBe(0);
    expect(objectPos(0, 0)).toEqual(objectRest(0));
    expect(objectRest(0)).toEqual([36, 68]);
    expect(objectRest(23)).toEqual([101, 116]);
  });

  it('settles every object exactly in its slot at full sweep, without overshoot', () => {
    const f = storeFill(9999, 1);
    expect(f).toBe(1);
    for (let i = 0; i < OBJECTS; i++) expect(objectPos(i, f)).toEqual(objectSlot(i));
    expect(objectSlot(0)).toEqual([290, 160]);
    expect(objectSlot(23)).toEqual([374, 136]);
  });

  it('moves objects in order as the fill grows', () => {
    const half = 0.5;
    expect(objectPos(0, half)).toEqual(objectSlot(0));
    expect(objectPos(23, half)).toEqual(objectRest(23));
  });
});
