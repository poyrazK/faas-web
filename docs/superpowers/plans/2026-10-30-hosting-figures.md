# Hosting Figures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven labelled Hosting schematics in "Explore the pieces of your backend" with bespoke, wordless, pointer-reactive SVG figures that each act out their feature, alongside Pillars on Scale to zero.

**Architecture:** One pure module (`figures/geometry.ts`) holds every figure's maths as plain functions of `(px, py, active)`. One frame component (`figures/figure-frame.tsx`) turns the pointer into `motion/react` motion values. Seven small figure components wire those motion values through the geometry with `useTransform` onto `motion.*` SVG elements, so a pointer move updates the DOM with no React render.

**Tech Stack:** React 19, `motion/react` 13.1 (`useMotionValue`, `useSpring`, `useTransform`, `useInView`, `useReducedMotion`), Vitest + React Testing Library, Playwright from a sibling worktree for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-30-hosting-figures-design.md`. Read it first. Every coordinate in this plan comes from it.

## Spec deviations decided while planning

These keep the spec's visuals and make them deterministic to test:

1. **The maths lives in one pure module.** Tests assert resting frames and behaviour on `geometry.ts` functions directly, instead of reading motion's internal attribute strings.
2. **"Drawn" strokes grow their geometry instead of using dash offsets.**
   - The Custom domains fill line grows its `x2`.
   - The Logs & traces ticks grow their `x2`.
   - The Source deploys snapshot frame is a path whose `d` traces the rectangle's perimeter up to the drawn fraction, with square corners.
   - Motion treats a `pathLength` prop specially and would override hand-set dash attributes, so this avoids it.
3. **The Source deploys live dot grows its radius** instead of scaling, so there's no transform-origin handling on SVG.
4. **Each animated element carries a `data-part` attribute**, for example `bar`, `core` or `seal`, so tests can find it.
5. **Captions use the site's curly apostrophe** (`app’s`), matching the other copy in `GROUPS`.

## Global Constraints

- Work in `/home/bahadir/GREGALE/.worktrees/faas-web-landing-pillars`, branch `feat/landing-pillars`. Never `cd` to `/home/bahadir/GREGALE/faas-web`.
- Read `CLAUDE.md` and `README.md` in the worktree first.
- Figures are wordless: no `<text>` elements inside any figure.
- Colours: ink is `var(--brand)` and the field is the panel's `var(--background)`. No literal hex in new code, no new colour tokens, no new dependencies.
- Each figure animates at most 60 SVG shape elements (`rect`, `circle`, `path`, `line`).
- Under reduced motion, every figure shows its resting frame (`active = 0`) and nothing drifts.
- Do not edit `src/components/landing/textures/pillars.tsx`.
- Connected work keeps its current `flow` and `orbit` diagrams, unchanged.
- Do not reformat files you did not otherwise change. Run Prettier only on touched files.
- Tests: Vitest + RTL beside the code. Run with `npx vitest run --maxWorkers=8`. A run passes only when the exit code is 0 **and** the summary has no "Errors" line.
- `npm run lint`: 0 errors, no more than the existing 4 warnings.
- **Gate every commit on its checks**, by chaining them with `&&` before `git commit`.
- Commits: conventional (`feat(landing): …`, `test(landing): …`), each with a body that says why. Use the repo's configured git identity. **Do not push.**
- **Do not kill or restart any process.** A dev server for this worktree may already be running on port 3002. Use it if it answers. If it doesn't, start one on a free port and leave it running.

## Review Focus

The inputs most likely to bite a real person that the spec does not spell out. Each has a test in the task named.

1. **Switching features quickly on a phone.** The selected feature's figure unmounts while its touch drift is running. The drift loop must stop on unmount, with no error and no frame left scheduled. Test in Task 2.
2. **A pointer in the gap between Isolated compute cells.** No cell may react. The gaps are part of the picture of isolation. Test in Task 1.
3. **PR previews near the right edge.** For commits right of x 300, the preview node must fork left and stay inside the frame. Test in Task 1.
4. **A pointer exactly between two secret rows.** At most one row may seal at a time, and at the midpoint neither does. Test in Task 1.
5. **Object storage at full sweep.** At the far right, all 24 objects settle exactly in their bucket slots, and no value overshoots. Test in Task 1.

## File Structure

| File                                                                                                                  | Responsibility                                                          | Task |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---- |
| `src/components/landing/figures/geometry.ts` (new)                                                                    | Every figure's maths as pure functions                                  | 1    |
| `src/components/landing/figures/geometry.test.ts` (new)                                                               | Resting frames and behaviour, exactly                                   | 1    |
| `src/components/landing/figures/figure-frame.tsx` (new)                                                               | Pointer → motion values, touch drift, reduced motion, context           | 2    |
| `src/components/landing/figures/figure-frame.test.tsx` (new)                                                          | Frame behaviour and the no-re-render guarantee                          | 2    |
| `src/components/landing/feature-explorer.css`                                                                         | `.feature-figure` sizing (Task 2); old schematic rules removed (Task 5) | 2, 5 |
| `src/components/landing/figures/source-deploys.tsx`, `isolated-compute.tsx`, `custom-domains.tsx` (new)               | Figures A                                                               | 3    |
| `src/components/landing/figures/logs-traces.tsx`, `secrets-config.tsx`, `pr-previews.tsx`, `object-storage.tsx` (new) | Figures B                                                               | 4    |
| `src/components/landing/figures/figures.test.tsx` (new)                                                               | Render, budget, wordless and zero-commit tests for every figure         | 3, 4 |
| `src/components/landing/feature-explorer.tsx`, `feature-explorer.test.tsx`                                            | Wiring, captions, removal of `DeploymentDiagram`                        | 5    |
| `src/components/landing/hosting-diagrams.tsx`                                                                         | Deleted                                                                 | 5    |

---

### Task 1: The figure geometry

**Files:**

- Create: `src/components/landing/figures/geometry.ts`
- Test: `src/components/landing/figures/geometry.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, all exported from `geometry.ts`:
  - `clamp01(v: number): number`, `lerp(a: number, b: number, t: number): number`
  - Source deploys: `DEPLOY_REST: readonly [number, number][]` (12 entries), `deployProgress(px: number, active: number): number`, `deployBar(i: number, p: number): { x: number; y: number; fillOpacity: number }`, `deployFrame(p: number): number`, `deployDotRadius(p: number): number`, `perimeterPath(x: number, y: number, w: number, h: number, t: number): string`
  - Isolated compute: `CELLS: readonly { x: number; y: number }[]` (18 entries), `cellAt(px: number, py: number): number` (−1 for none), `cellCore(index: number, hovered: number, active: number): { size: number; stroke: number }`
  - Custom domains: `RINGS: readonly number[]`, `domainFill(px: number, active: number): number`, `ringRadius(cx: number, px: number, active: number): number`, `shackleLift(fill: number): number`
  - Logs & traces: `SPANS: readonly [number, number, number][]` (7 entries, as x, y, width), `traceCursor(px: number): number`, `spanCrossed(i: number, cursor: number): boolean`
  - Secrets & config: `ROWS: number` (6), `rowCentre(r: number): number`, `rowSeal(r: number, py: number, active: number): number`, `dotX(d: number, seal: number): number`
  - PR previews: `COMMITS: readonly number[]` (9 x positions), `branchCommit(px: number): number`, `branchNodeX(cx: number): number`, `branchHeight(active: number): number`, `branchPath(cx: number, active: number): string`
  - Object storage: `OBJECTS: number` (24), `objectRest(i: number): [number, number]`, `objectSlot(i: number): [number, number]`, `storeFill(px: number, active: number): number`, `objectPos(i: number, fill: number): [number, number]`

- [ ] **Step 1: Write the failing tests**

Create `src/components/landing/figures/geometry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run --maxWorkers=8 src/components/landing/figures/geometry.test.ts
```

Expected: FAIL, because `./geometry` does not exist (an import resolution error).

- [ ] **Step 3: Write the geometry module**

Create `src/components/landing/figures/geometry.ts`:

```ts
/**
 * The maths behind the Hosting figures, as plain functions of the pointer.
 *
 * Every figure lives in a 420 × 200 frame. `px` and `py` are the pointer in
 * that frame and `active` runs 0 → 1 while the figure is acted on, so every
 * function returns the figure's resting frame when `active` is 0.
 * Coordinates come from docs/superpowers/specs/2026-10-30-hosting-figures-design.md.
 */

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Source deploys: loose pieces become one image, a snapshot, then live.

export const DEPLOY_REST: readonly [number, number][] = [
  [28, 34],
  [96, 52],
  [52, 74],
  [118, 88],
  [34, 104],
  [84, 118],
  [130, 40],
  [60, 134],
  [104, 150],
  [24, 160],
  [142, 124],
  [72, 96],
];

export const deployProgress = (px: number, active: number) => active * clamp01((px - 40) / 300);

export function deployBar(i: number, p: number) {
  const [rx, ry] = DEPLOY_REST[i];
  return { x: lerp(rx, 230, p), y: lerp(ry, 46 + 9 * i, p), fillOpacity: 0.25 + 0.75 * p };
}

export const deployFrame = (p: number) => clamp01((p - 0.66) / 0.34);
export const deployDotRadius = (p: number) => 6 * clamp01((p - 0.85) / 0.15);

/** The rectangle's perimeter, clockwise from its top-left corner, drawn up to `t`. */
export function perimeterPath(x: number, y: number, w: number, h: number, t: number): string {
  const corners: [number, number][] = [
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ];
  const edges = [w, h, w, h];
  let left = clamp01(t) * 2 * (w + h);
  let d = `M ${x} ${y}`;
  let from: [number, number] = [x, y];
  for (let i = 0; i < 4 && left > 1e-9; i++) {
    const [tx, ty] = corners[i];
    const part = Math.min(1, left / edges[i]);
    const px = from[0] + (tx - from[0]) * part;
    const py = from[1] + (ty - from[1]) * part;
    d += ` L ${+px.toFixed(2)} ${+py.toFixed(2)}`;
    left -= edges[i];
    from = [tx, ty];
  }
  return d;
}

// Isolated compute: one cell reacts, its neighbours stay still.

export const CELLS: readonly { x: number; y: number }[] = Array.from({ length: 18 }, (_, i) => ({
  x: 17 + 66 * (i % 6),
  y: 18 + 58 * Math.floor(i / 6),
}));

export function cellAt(px: number, py: number): number {
  return CELLS.findIndex((c) => px >= c.x && px <= c.x + 56 && py >= c.y && py <= c.y + 48);
}

export function cellCore(index: number, hovered: number, active: number) {
  const k = index === hovered ? active : 0;
  return { size: lerp(12, 30, k), stroke: lerp(1, 2.5, k) };
}

// Custom domains: a path that completes and locks.

export const RINGS: readonly number[] = [150, 214, 278];
export const domainFill = (px: number, active: number) => active * clamp01((px - 84) / 260);
export const ringRadius = (cx: number, px: number, active: number) =>
  14 + 6 * active * Math.max(0, 1 - Math.abs(px - cx) / 48);
export const shackleLift = (fill: number) => -6 * (1 - clamp01((fill - 0.9) / 0.1));

// Logs & traces: a cursor reads one request.

export const SPANS: readonly [number, number, number][] = [
  [24, 24, 300],
  [48, 46, 180],
  [72, 68, 96],
  [132, 90, 120],
  [160, 112, 60],
  [232, 134, 84],
  [256, 156, 40],
];
export const traceCursor = (px: number) => Math.min(324, Math.max(24, px));
export function spanCrossed(i: number, cursor: number): boolean {
  const [x, , w] = SPANS[i];
  return cursor >= x && cursor <= x + w;
}

// Secrets & config: values stay sealed.

export const ROWS = 6;
export const rowCentre = (r: number) => 30 + 28 * r;
export const rowSeal = (r: number, py: number, active: number) =>
  active * Math.max(0, 1 - Math.abs(py - rowCentre(r)) / 14);
export const dotX = (d: number, seal: number) => lerp(132 + 26 * d, 223, seal);

// PR previews: a branch forks and merges.

export const COMMITS: readonly number[] = Array.from({ length: 9 }, (_, k) => 44 + 42 * k);
export const branchCommit = (px: number) =>
  44 + 42 * Math.round(Math.min(8, Math.max(0, (px - 44) / 42)));
/** Right of x 300 the node forks left, or it would leave the frame. */
export const branchNodeX = (cx: number) => (cx > 300 ? cx - 40 : cx + 40);
export const branchHeight = (active: number) => 70 * active;
export function branchPath(cx: number, active: number): string {
  const h = branchHeight(active);
  const nx = branchNodeX(cx);
  const top = +(140 - h).toFixed(2);
  return `M ${cx} 140 C ${cx} ${+(140 - 0.6 * h).toFixed(2)} ${nx} ${top} ${nx} ${top}`;
}

// Object storage: objects leave the runtime for a closed bucket.

export const OBJECTS = 24;
export const objectRest = (i: number): [number, number] => [
  36 + 13 * (i % 6),
  68 + 16 * Math.floor(i / 6),
];
export const objectSlot = (i: number): [number, number] => [
  290 + 12 * (i % 8),
  160 - 12 * Math.floor(i / 8),
];
export const storeFill = (px: number, active: number) => active * clamp01((px - 24) / 360);
export function objectPos(i: number, fill: number): [number, number] {
  const q = clamp01(OBJECTS * fill - i);
  const [rx, ry] = objectRest(i);
  const [sx, sy] = objectSlot(i);
  return [lerp(rx, sx, q), lerp(ry, sy, q)];
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run --maxWorkers=8 src/components/landing/figures/geometry.test.ts
```

Expected: PASS, exit 0, no "Errors" line. If a perimeter string differs only in number formatting (for example `10` against `10.00`), fix the function's formatting, not the expected string.

- [ ] **Step 5: Typecheck, format and commit**

```bash
npx tsc --noEmit && npx prettier --write src/components/landing/figures/geometry.ts src/components/landing/figures/geometry.test.ts && npx vitest run --maxWorkers=8 src/components/landing/figures/geometry.test.ts && git add src/components/landing/figures/geometry.ts src/components/landing/figures/geometry.test.ts && git commit -m "feat(landing): the maths behind the Hosting figures

Each Hosting figure is a function of the pointer: where it is in a 420 by
200 frame and how active the figure is. Keeping that maths in plain
functions lets the resting frame and every behaviour be tested exactly:
cells that ignore the gaps, a PR branch that forks left near the edge,
one secret row sealing at a time, objects landing exactly in their slots."
```

---

### Task 2: The figure frame

**Files:**

- Create: `src/components/landing/figures/figure-frame.tsx`
- Test: `src/components/landing/figures/figure-frame.test.tsx`
- Modify: `src/components/landing/feature-explorer.css` (add `.feature-figure` rules)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces, exported from `figure-frame.tsx`:
  - `VIEW_W = 420`, `VIEW_H = 200`
  - `type FigureState = { px: MotionValue<number>; py: MotionValue<number>; active: MotionValue<number>; pointer: { x: MotionValue<number>; y: MotionValue<number>; target: MotionValue<number> }; reduced: boolean }`
  - `function toFigure(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): [number, number] | null`
  - `function FigureFrame(props: { name: string; children: ReactNode }): JSX.Element`, rendering `div.feature-figure[data-figure=name] > svg[aria-hidden]`
  - `function useFigure(): FigureState`, which throws outside a frame

- [ ] **Step 1: Write the failing tests**

Create `src/components/landing/figures/figure-frame.test.tsx`:

```tsx
import { Profiler } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FigureFrame, toFigure, useFigure, type FigureState } from './figure-frame';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  useReducedMotion: () => motion.reduced,
}));

const COARSE = '(hover: none), (pointer: coarse)';
let seen: FigureState | null = null;
function Probe() {
  seen = useFigure();
  return null;
}

function stubRect(el: HTMLElement, width = 504, height = 200) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function mount() {
  const view = render(
    <div tabIndex={0} data-testid="host">
      <FigureFrame name="probe">
        <Probe />
      </FigureFrame>
    </div>
  );
  const frame = view.container.querySelector<HTMLElement>('[data-figure="probe"]')!;
  stubRect(frame);
  return { ...view, frame, host: view.getByTestId('host') };
}

function setCoarse(on: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: on && query === COARSE,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
}

beforeEach(() => {
  motion.reduced = false;
  seen = null;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('toFigure', () => {
  it('maps client points into the 420 × 200 frame under meet, with the letterbox', () => {
    const wide = { left: 0, top: 0, width: 504, height: 200 };
    expect(toFigure(252, 100, wide)).toEqual([210, 100]);
    expect(toFigure(42, 0, wide)).toEqual([0, 0]);
    const tall = { left: 0, top: 0, width: 420, height: 300 };
    expect(toFigure(210, 150, tall)).toEqual([210, 100]);
  });

  it('clamps points outside the frame and refuses an unmeasured box', () => {
    const wide = { left: 0, top: 0, width: 504, height: 200 };
    expect(toFigure(1000, 500, wide)).toEqual([420, 200]);
    expect(toFigure(-50, -50, wide)).toEqual([0, 0]);
    expect(toFigure(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe('FigureFrame', () => {
  it('renders a named, decorative SVG frame', () => {
    const { frame } = mount();
    const svg = frame.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 420 200');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  });

  it('starts at rest in the centre', () => {
    mount();
    expect(seen!.pointer.x.get()).toBe(210);
    expect(seen!.pointer.y.get()).toBe(100);
    expect(seen!.pointer.target.get()).toBe(0);
  });

  it('follows the pointer while over the frame and lets go when it leaves', () => {
    const { frame } = mount();
    fireEvent.pointerEnter(frame, { clientX: 294, clientY: 50 });
    fireEvent.pointerMove(frame, { clientX: 294, clientY: 50 });
    expect(seen!.pointer.x.get()).toBe(252);
    expect(seen!.pointer.y.get()).toBe(50);
    expect(seen!.pointer.target.get()).toBe(1);
    fireEvent.pointerLeave(frame);
    expect(seen!.pointer.target.get()).toBe(0);
  });

  it('centres and wakes on keyboard focus of the panel, and rests on blur', () => {
    const { frame, host } = mount();
    fireEvent.pointerMove(frame, { clientX: 294, clientY: 50 });
    fireEvent.focusIn(host);
    expect(seen!.pointer.x.get()).toBe(210);
    expect(seen!.pointer.y.get()).toBe(100);
    expect(seen!.pointer.target.get()).toBe(1);
    fireEvent.focusOut(host);
    expect(seen!.pointer.target.get()).toBe(0);
  });

  it('stays at rest under reduced motion', () => {
    motion.reduced = true;
    const { frame, host } = mount();
    fireEvent.pointerMove(frame, { clientX: 294, clientY: 50 });
    fireEvent.focusIn(host);
    expect(seen!.pointer.target.get()).toBe(0);
    expect(seen!.pointer.x.get()).toBe(210);
    expect(seen!.reduced).toBe(true);
  });

  it('ignores touch on a coarse pointer and does not drift out of view', async () => {
    setCoarse(true);
    const { frame } = mount();
    fireEvent.pointerMove(frame, { pointerType: 'touch', clientX: 294, clientY: 50 });
    expect(seen!.pointer.x.get()).toBe(210);
    // The setup's IntersectionObserver never intersects: no drift.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(seen!.pointer.x.get()).toBe(210);
    expect(seen!.pointer.target.get()).toBe(0);
  });

  it('drifts on a coarse pointer in view, and stops cleanly when unmounted mid-drift', async () => {
    setCoarse(true);
    const observers: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observers.push(callback);
        }
        observe(target: Element) {
          for (const cb of observers)
            cb(
              [{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver
            );
        }
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      }
    );
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = mount();
    await waitFor(() => expect(seen!.pointer.target.get()).toBe(1));
    await waitFor(() => expect(seen!.pointer.x.get()).not.toBe(210));
    expect(() => unmount()).not.toThrow();
    expect(cancel).toHaveBeenCalled();
  });

  it('moves without a single React commit', async () => {
    let commits = 0;
    const view = render(
      <Profiler id="figure" onRender={() => (commits += 1)}>
        <FigureFrame name="probe">
          <Probe />
        </FigureFrame>
      </Profiler>
    );
    const frame = view.container.querySelector<HTMLElement>('[data-figure="probe"]')!;
    stubRect(frame);
    await act(async () => {});
    const before = commits;
    fireEvent.pointerEnter(frame, { clientX: 50, clientY: 100 });
    for (let i = 0; i < 50; i++)
      fireEvent.pointerMove(frame, { clientX: 50 + 8 * i, clientY: 100 });
    fireEvent.pointerLeave(frame);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(commits).toBe(before);
  });

  it('refuses useFigure outside a frame', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/inside a FigureFrame/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run --maxWorkers=8 src/components/landing/figures/figure-frame.test.tsx
```

Expected: FAIL, because `./figure-frame` does not exist.

- [ ] **Step 3: Write the frame**

Create `src/components/landing/figures/figure-frame.tsx`:

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  type MotionValue,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'motion/react';

export const VIEW_W = 420;
export const VIEW_H = 200;
const REST_X = VIEW_W / 2;
const REST_Y = VIEW_H / 2;
// Tuned to settle like Pillars, the texture these figures sit beside.
const POINTER_SPRING = { stiffness: 300, damping: 30 };
const ACTIVE_SPRING = { stiffness: 400, damping: 40 };
const COARSE = '(hover: none), (pointer: coarse)';
// Pillars' ambient path, so touch screens drift the same way.
const DRIFT_SPEED = 1.5;
const DRIFT_W = (2 * Math.PI) / 4.5;
const REMEASURE_MS = 250;

export type FigureState = {
  /** Pointer x in the 420 × 200 frame, spring-smoothed. */
  px: MotionValue<number>;
  /** Pointer y in the 420 × 200 frame, spring-smoothed. */
  py: MotionValue<number>;
  /** 0 at rest, 1 while the figure is acted on, spring-settled. */
  active: MotionValue<number>;
  /** The unsmoothed input behind the springs. */
  pointer: { x: MotionValue<number>; y: MotionValue<number>; target: MotionValue<number> };
  reduced: boolean;
};

const FigureContext = createContext<FigureState | null>(null);

export function useFigure(): FigureState {
  const state = useContext(FigureContext);
  if (!state) throw new Error('useFigure must be used inside a FigureFrame');
  return state;
}

/** Maps a client point into the frame under `xMidYMid meet`, clamped to it. */
export function toFigure(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): [number, number] | null {
  const s = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
  if (!(s > 0)) return null;
  const x = (clientX - rect.left - (rect.width - VIEW_W * s) / 2) / s;
  const y = (clientY - rect.top - (rect.height - VIEW_H * s) / 2) / s;
  return [Math.min(VIEW_W, Math.max(0, x)), Math.min(VIEW_H, Math.max(0, y))];
}

/**
 * The shared stage for a Hosting figure: a 200px-tall, decorative SVG whose
 * pointer becomes motion values. Figures derive their attributes from those
 * values with `useTransform`, so moving the pointer never renders React.
 */
export function FigureFrame({ name, children }: { name: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = Boolean(useReducedMotion());
  const x = useMotionValue(REST_X);
  const y = useMotionValue(REST_Y);
  const target = useMotionValue(0);
  const px = useSpring(x, POINTER_SPRING);
  const py = useSpring(y, POINTER_SPRING);
  const active = useSpring(target, ACTIVE_SPRING);
  const inView = useInView(ref, { amount: 0.2 });
  const [coarse, setCoarse] = useState(false);
  const rect = useRef<DOMRect | null>(null);
  const measuredAt = useRef(0);

  const state = useMemo<FigureState>(
    () => ({ px, py, active, pointer: { x, y, target }, reduced }),
    [px, py, active, x, y, target, reduced]
  );

  useEffect(() => {
    const query = matchMedia(COARSE);
    const sync = () => setCoarse(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  // Keyboard focus on the detail panel wakes the figure from its centre.
  useEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;
    const host = root.closest('[tabindex]') ?? root.parentElement ?? root;
    const onFocus = () => {
      x.set(REST_X);
      y.set(REST_Y);
      target.set(1);
    };
    const onBlur = () => target.set(0);
    host.addEventListener('focusin', onFocus);
    host.addEventListener('focusout', onBlur);
    return () => {
      host.removeEventListener('focusin', onFocus);
      host.removeEventListener('focusout', onBlur);
    };
  }, [reduced, x, y, target]);

  // Touch screens have no hover, so the figure acts on itself while in view.
  const drifting = !reduced && coarse && inView;
  useEffect(() => {
    if (!drifting) return;
    const phase = Math.random() * 2 * Math.PI;
    let clock = 0;
    let last = 0;
    let frame = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      clock += dt * DRIFT_SPEED;
      const t = clock;
      x.set(
        REST_X +
          REST_X *
            (0.76 * Math.sin(DRIFT_W * t + phase) +
              0.2 * Math.sin(1.93 * DRIFT_W * t + 1.2 + phase))
      );
      y.set(
        REST_Y +
          REST_Y *
            (0.72 * Math.sin(0.75 * DRIFT_W * t + 0.8 + phase) +
              0.2 * Math.sin(1.37 * DRIFT_W * t + 2.1 + phase))
      );
      target.set(1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      target.set(0);
    };
  }, [drifting, x, y, target]);

  const ignore = (e: PointerEvent) => reduced || (coarse && e.pointerType === 'touch');
  const measure = () => {
    if (!ref.current) return;
    rect.current = ref.current.getBoundingClientRect();
    measuredAt.current = performance.now();
  };
  const onPointerEnter = (e: PointerEvent) => {
    if (!ignore(e)) measure();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (ignore(e)) return;
    if (!rect.current || performance.now() - measuredAt.current > REMEASURE_MS) measure();
    const point = rect.current && toFigure(e.clientX, e.clientY, rect.current);
    if (!point) return;
    x.set(point[0]);
    y.set(point[1]);
    target.set(1);
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (!ignore(e)) target.set(0);
  };

  return (
    <FigureContext.Provider value={state}>
      <div
        ref={ref}
        data-figure={name}
        className="feature-figure"
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerLeave}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="var(--brand)"
          strokeWidth={1}
        >
          {children}
        </svg>
      </div>
    </FigureContext.Provider>
  );
}
```

Then, in `src/components/landing/feature-explorer.css`, add directly before the `.feature-pillars {` rule:

```css
.feature-figure {
  position: relative;
  width: 100%;
  height: 200px;
}
.feature-figure svg {
  display: block;
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run --maxWorkers=8 src/components/landing/figures/figure-frame.test.tsx
```

Expected: PASS, exit 0, no "Errors" line.

- If the in-view drift test fails only because jsdom never runs `requestAnimationFrame`, confirm that cause by logging `typeof requestAnimationFrame` in the test. Then replace the drift loop's `requestAnimationFrame` calls with motion's `frame.update` and `cancelFrame`, and re-run. Do not weaken the assertion.
- If the zero-commit test fails, find which state changes during pointer handling. No handler may call a React setter.

- [ ] **Step 5: Typecheck, lint, format and commit**

```bash
npx tsc --noEmit && npm run lint && npx prettier --write src/components/landing/figures/figure-frame.tsx src/components/landing/figures/figure-frame.test.tsx src/components/landing/feature-explorer.css && npx vitest run --maxWorkers=8 src/components/landing/figures/figure-frame.test.tsx && git add src/components/landing/figures/figure-frame.tsx src/components/landing/figures/figure-frame.test.tsx src/components/landing/feature-explorer.css && git commit -m "feat(landing): a shared frame that turns the pointer into motion values

Every Hosting figure sits in the same 420 by 200 decorative frame. The
frame maps the pointer into it, smooths it with springs tuned to settle
like Pillars, wakes on keyboard focus, drifts on its own on touch screens
while in view, and stays at rest under reduced motion. Because the pointer
only ever sets motion values, moving it commits nothing to React, and a
Profiler test holds that line."
```

---

### Task 3: Figures A, Source deploys, Isolated compute and Custom domains

**Files:**

- Create: `src/components/landing/figures/source-deploys.tsx`, `isolated-compute.tsx`, `custom-domains.tsx`
- Test: `src/components/landing/figures/figures.test.tsx`

**Interfaces:**

- Consumes from Task 1: `DEPLOY_REST`, `deployProgress`, `deployBar`, `deployFrame`, `deployDotRadius`, `perimeterPath`, `CELLS`, `cellAt`, `cellCore`, `RINGS`, `domainFill`, `ringRadius`, `shackleLift`, `lerp`. From Task 2: `FigureFrame`, `useFigure`.
- Produces: `SourceDeploysFigure()`, `IsolatedComputeFigure()`, `CustomDomainsFigure()`, each rendering its own `FigureFrame`.

- [ ] **Step 1: Write the failing figure tests**

Create `src/components/landing/figures/figures.test.tsx`:

```tsx
import { Profiler, type ComponentType } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SourceDeploysFigure } from './source-deploys';
import { IsolatedComputeFigure } from './isolated-compute';
import { CustomDomainsFigure } from './custom-domains';

const FIGURES: [string, ComponentType][] = [
  ['source-deploys', SourceDeploysFigure],
  ['isolated-compute', IsolatedComputeFigure],
  ['custom-domains', CustomDomainsFigure],
];

function frameOf(container: HTMLElement, name: string) {
  return container.querySelector<HTMLElement>(`[data-figure="${name}"]`)!;
}

describe('Hosting figures', () => {
  it.each(FIGURES)('%s is a wordless, decorative field within budget', (name, Figure) => {
    const { container } = render(<Figure />);
    const svg = frameOf(container, name).querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelectorAll('text')).toHaveLength(0);
    const shapes = svg.querySelectorAll('rect, circle, path, line').length;
    expect(shapes).toBeGreaterThan(0);
    expect(shapes).toBeLessThanOrEqual(60);
  });

  it.each(FIGURES)('%s moves under the pointer without a React commit', async (name, Figure) => {
    let commits = 0;
    const { container } = render(
      <Profiler id={name} onRender={() => (commits += 1)}>
        <Figure />
      </Profiler>
    );
    const frame = frameOf(container, name);
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 504,
      height: 200,
      right: 504,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    await act(async () => {});
    const before = commits;
    fireEvent.pointerEnter(frame, { clientX: 60, clientY: 60 });
    for (let i = 0; i < 50; i++)
      fireEvent.pointerMove(frame, { clientX: 60 + 8 * i, clientY: 60 + i });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(commits).toBe(before);
  });

  it('source deploys rests as scattered bars with no live dot', () => {
    const { container } = render(<SourceDeploysFigure />);
    const bars = container.querySelectorAll('[data-part="bar"]');
    expect(bars).toHaveLength(12);
    expect(bars[0]).toHaveAttribute('x', '28');
    expect(bars[0]).toHaveAttribute('y', '34');
    expect(container.querySelector('[data-part="dot"]')).toHaveAttribute('r', '0');
    expect(container.querySelector('[data-part="frame"]')).toHaveAttribute('d', 'M 218 34');
  });

  it('isolated compute rests as an even grid', () => {
    const { container } = render(<IsolatedComputeFigure />);
    expect(container.querySelectorAll('[data-part="cell"]')).toHaveLength(18);
    const cores = container.querySelectorAll('[data-part="core"]');
    expect(cores).toHaveLength(18);
    for (const core of cores) expect(core).toHaveAttribute('width', '12');
  });

  it('custom domains rests with an empty fill and plain rings', () => {
    const { container } = render(<CustomDomainsFigure />);
    expect(container.querySelector('[data-part="fill"]')).toHaveAttribute('x2', '84');
    const rings = container.querySelectorAll('[data-part="ring"]');
    expect(rings).toHaveLength(3);
    for (const ring of rings) expect(ring).toHaveAttribute('r', '14');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run --maxWorkers=8 src/components/landing/figures/figures.test.tsx
```

Expected: FAIL, because the three figure modules do not exist.

- [ ] **Step 3: Write Source deploys**

Create `src/components/landing/figures/source-deploys.tsx`:

```tsx
import { type MotionValue, motion, useTransform } from 'motion/react';
import {
  DEPLOY_REST,
  deployBar,
  deployDotRadius,
  deployFrame,
  deployProgress,
  perimeterPath,
} from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** Loose pieces become one image, then a snapshot, then live. */
export function SourceDeploysFigure() {
  return (
    <FigureFrame name="source-deploys">
      <SourceDeploys />
    </FigureFrame>
  );
}

function SourceDeploys() {
  const { px, active } = useFigure();
  const p = useTransform([px, active], ([x, a]: number[]) => deployProgress(x, a));
  const frame = useTransform(p, (v) => perimeterPath(218, 34, 88, 128, deployFrame(v)));
  const dot = useTransform(p, deployDotRadius);
  return (
    <>
      {DEPLOY_REST.map((_, i) => (
        <Bar key={i} i={i} p={p} />
      ))}
      <motion.path data-part="frame" d={frame} />
      <motion.circle data-part="dot" cx={336} cy={98} r={dot} fill="var(--brand)" stroke="none" />
    </>
  );
}

function Bar({ i, p }: { i: number; p: MotionValue<number> }) {
  const x = useTransform(p, (v) => deployBar(i, v).x);
  const y = useTransform(p, (v) => deployBar(i, v).y);
  const fillOpacity = useTransform(p, (v) => deployBar(i, v).fillOpacity);
  return (
    <motion.rect
      data-part="bar"
      x={x}
      y={y}
      width={64}
      height={5}
      rx={2}
      fill="var(--brand)"
      fillOpacity={fillOpacity}
    />
  );
}
```

- [ ] **Step 4: Write Isolated compute**

Create `src/components/landing/figures/isolated-compute.tsx`:

```tsx
import { type MotionValue, motion, useTransform } from 'motion/react';
import { CELLS, cellAt, cellCore } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** One cell reacts; its neighbours stay perfectly still. */
export function IsolatedComputeFigure() {
  return (
    <FigureFrame name="isolated-compute">
      <IsolatedCompute />
    </FigureFrame>
  );
}

function IsolatedCompute() {
  const { px, py } = useFigure();
  const hovered = useTransform([px, py], ([x, y]: number[]) => cellAt(x, y));
  return (
    <>
      {CELLS.map((_, i) => (
        <Cell key={i} index={i} hovered={hovered} />
      ))}
    </>
  );
}

function Cell({ index, hovered }: { index: number; hovered: MotionValue<number> }) {
  const { active } = useFigure();
  const { x, y } = CELLS[index];
  const state = useTransform([hovered, active], ([h, a]: number[]) => cellCore(index, h, a));
  const strokeWidth = useTransform(state, (s) => s.stroke);
  const size = useTransform(state, (s) => s.size);
  const coreX = useTransform(size, (s) => x + (56 - s) / 2);
  const coreY = useTransform(size, (s) => y + (48 - s) / 2);
  return (
    <>
      <motion.rect
        data-part="cell"
        x={x}
        y={y}
        width={56}
        height={48}
        rx={8}
        strokeWidth={strokeWidth}
      />
      <motion.rect
        data-part="core"
        x={coreX}
        y={coreY}
        width={size}
        height={size}
        rx={2}
        fill="var(--brand)"
        stroke="none"
      />
    </>
  );
}
```

- [ ] **Step 5: Write Custom domains**

Create `src/components/landing/figures/custom-domains.tsx`:

```tsx
import { motion, useTransform } from 'motion/react';
import { RINGS, domainFill, lerp, ringRadius, shackleLift } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** A path from the hostname to the app completes, and the lock closes. */
export function CustomDomainsFigure() {
  return (
    <FigureFrame name="custom-domains">
      <CustomDomains />
    </FigureFrame>
  );
}

function CustomDomains() {
  const { px, active } = useFigure();
  const fill = useTransform([px, active], ([x, a]: number[]) => domainFill(x, a));
  const fillEnd = useTransform(fill, (f) => lerp(84, 344, f));
  const lift = useTransform(fill, shackleLift);
  return (
    <>
      {[24, 38, 52, 66].map((x) => (
        <line key={x} x1={x} y1={100} x2={x + 8} y2={100} strokeWidth={2} />
      ))}
      <line x1={84} y1={100} x2={344} y2={100} strokeDasharray="2 6" strokeOpacity={0.5} />
      <motion.line data-part="fill" x1={84} y1={100} x2={fillEnd} y2={100} strokeWidth={1.5} />
      {RINGS.map((cx) => (
        <Ring key={cx} cx={cx} />
      ))}
      <rect x={344} y={82} width={52} height={36} rx={6} fill="var(--brand)" stroke="none" />
      <rect x={360} y={62} width={20} height={14} rx={2} fill="var(--brand)" stroke="none" />
      <motion.path
        data-part="shackle"
        d="M 364 62 V 56 A 6 6 0 0 1 376 56 V 62"
        strokeWidth={2}
        style={{ y: lift }}
      />
    </>
  );
}

function Ring({ cx }: { cx: number }) {
  const { px, active } = useFigure();
  const r = useTransform([px, active], ([x, a]: number[]) => ringRadius(cx, x, a));
  return <motion.circle data-part="ring" cx={cx} cy={100} r={r} fill="var(--background)" />;
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
npx vitest run --maxWorkers=8 src/components/landing/figures/figures.test.tsx
```

Expected: PASS for all three figures, exit 0, no "Errors" line.

- If an attribute assertion fails only on number formatting (for example `"28.0"`), read how motion serialises the attribute, and assert the numeric value with `Number(el.getAttribute('x'))`.
- If a zero-commit test fails, a figure is reading a motion value with `.get()` during render or calling a setter. Fix the figure.

- [ ] **Step 7: Typecheck, lint, format and commit**

```bash
npx tsc --noEmit && npm run lint && npx prettier --write src/components/landing/figures/source-deploys.tsx src/components/landing/figures/isolated-compute.tsx src/components/landing/figures/custom-domains.tsx src/components/landing/figures/figures.test.tsx && npx vitest run --maxWorkers=8 src/components/landing/figures/figures.test.tsx && git add src/components/landing/figures/source-deploys.tsx src/components/landing/figures/isolated-compute.tsx src/components/landing/figures/custom-domains.tsx src/components/landing/figures/figures.test.tsx && git commit -m "feat(landing): figures for source deploys, isolated compute and domains

Source deploys gathers twelve loose bars into one stacked image, closes a
snapshot frame around it and lights a live dot as the pointer moves right.
Isolated compute swells only the cell under the pointer while the other
seventeen stay still. Custom domains fills the path to the app and closes
the lock when it arrives. All three are wordless and move without React
commits."
```

---

### Task 4: Figures B, Logs & traces, Secrets & config, PR previews and Object storage

**Files:**

- Create: `src/components/landing/figures/logs-traces.tsx`, `secrets-config.tsx`, `pr-previews.tsx`, `object-storage.tsx`
- Modify: `src/components/landing/figures/figures.test.tsx`

**Interfaces:**

- Consumes from Task 1: `SPANS`, `traceCursor`, `spanCrossed`, `ROWS`, `rowCentre`, `rowSeal`, `dotX`, `COMMITS`, `branchCommit`, `branchNodeX`, `branchHeight`, `branchPath`, `OBJECTS`, `storeFill`, `objectPos`. From Task 2: `FigureFrame`, `useFigure`.
- Produces: `LogsTracesFigure()`, `SecretsConfigFigure()`, `PrPreviewsFigure()`, `ObjectStorageFigure()`.

- [ ] **Step 1: Extend the figure tests**

In `src/components/landing/figures/figures.test.tsx`, add after the existing imports:

```tsx
import { LogsTracesFigure } from './logs-traces';
import { SecretsConfigFigure } from './secrets-config';
import { PrPreviewsFigure } from './pr-previews';
import { ObjectStorageFigure } from './object-storage';
```

Add four rows to `FIGURES`:

```tsx
  ['logs-traces', LogsTracesFigure],
  ['secrets-config', SecretsConfigFigure],
  ['pr-previews', PrPreviewsFigure],
  ['object-storage', ObjectStorageFigure],
```

Append inside `describe('Hosting figures', …)`:

```tsx
it('logs and traces rests with a faint waterfall and no ticks', () => {
  const { container } = render(<LogsTracesFigure />);
  expect(container.querySelectorAll('[data-part="span"]')).toHaveLength(7);
  const ticks = container.querySelectorAll('[data-part="tick"]');
  expect(ticks).toHaveLength(7);
  for (const tick of ticks) expect(tick).toHaveAttribute('x2', '352');
});

it('secrets and config rests as six rows of dots with nothing sealed', () => {
  const { container } = render(<SecretsConfigFigure />);
  expect(container.querySelectorAll('[data-part="dot"]')).toHaveLength(48);
  const seals = container.querySelectorAll('[data-part="seal"]');
  expect(seals).toHaveLength(6);
  for (const seal of seals) expect(seal).toHaveAttribute('fill-opacity', '0');
});

it('pr previews rests as a straight line of commits with no visible node', () => {
  const { container } = render(<PrPreviewsFigure />);
  expect(container.querySelectorAll('[data-part="commit"]')).toHaveLength(9);
  expect(container.querySelector('[data-part="node"]')).toHaveAttribute('stroke-opacity', '0');
});

it('object storage rests with every object in the app frame', () => {
  const { container } = render(<ObjectStorageFigure />);
  const objects = container.querySelectorAll('[data-part="object"]');
  expect(objects).toHaveLength(24);
  expect(objects[0]).toHaveAttribute('x', '36');
  expect(objects[0]).toHaveAttribute('y', '68');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run --maxWorkers=8 src/components/landing/figures/figures.test.tsx
```

Expected: FAIL, because the four new modules do not exist.

- [ ] **Step 3: Write Logs & traces**

Create `src/components/landing/figures/logs-traces.tsx`:

```tsx
import { type MotionValue, motion, useTransform } from 'motion/react';
import { SPANS, spanCrossed, traceCursor } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** A cursor reads one request: the spans it crosses fill, and log ticks appear. */
export function LogsTracesFigure() {
  return (
    <FigureFrame name="logs-traces">
      <LogsTraces />
    </FigureFrame>
  );
}

function LogsTraces() {
  const { px, active } = useFigure();
  const cursor = useTransform(px, traceCursor);
  return (
    <>
      {SPANS.map((_, i) => (
        <Span key={i} i={i} cursor={cursor} />
      ))}
      <motion.line
        data-part="cursor"
        x1={cursor}
        y1={16}
        x2={cursor}
        y2={184}
        strokeOpacity={active}
      />
    </>
  );
}

function Span({ i, cursor }: { i: number; cursor: MotionValue<number> }) {
  const { active } = useFigure();
  const [x, y, w] = SPANS[i];
  const lit = useTransform([cursor, active], ([c, a]: number[]) => a * (spanCrossed(i, c) ? 1 : 0));
  const fillOpacity = useTransform(lit, (v) => 0.12 + 0.88 * v);
  const tickEnd = useTransform(lit, (v) => 352 + 40 * v);
  const tickY = 31 + 22 * i;
  return (
    <>
      <motion.rect
        data-part="span"
        x={x}
        y={y}
        width={w}
        height={14}
        rx={3}
        fill="var(--brand)"
        fillOpacity={fillOpacity}
      />
      <motion.line
        data-part="tick"
        x1={352}
        y1={tickY}
        x2={tickEnd}
        y2={tickY}
        strokeWidth={2}
        strokeOpacity={lit}
      />
    </>
  );
}
```

- [ ] **Step 4: Write Secrets & config**

Create `src/components/landing/figures/secrets-config.tsx`:

```tsx
import { type MotionValue, motion, useTransform } from 'motion/react';
import { ROWS, dotX, rowCentre, rowSeal } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** Values stay sealed: the hovered row's dots gather into one solid block. */
export function SecretsConfigFigure() {
  return (
    <FigureFrame name="secrets-config">
      {Array.from({ length: ROWS }, (_, r) => (
        <Row key={r} r={r} />
      ))}
    </FigureFrame>
  );
}

function Row({ r }: { r: number }) {
  const { py, active } = useFigure();
  const yc = rowCentre(r);
  const seal = useTransform([py, active], ([y, a]: number[]) => rowSeal(r, y, a));
  return (
    <>
      <rect
        x={40}
        y={yc - 4}
        width={60}
        height={8}
        rx={2}
        fill="var(--brand)"
        fillOpacity={0.6}
        stroke="none"
      />
      {Array.from({ length: 8 }, (_, d) => (
        <Dot key={d} d={d} yc={yc} seal={seal} />
      ))}
      <motion.rect
        data-part="seal"
        x={191}
        y={yc - 7}
        width={64}
        height={14}
        rx={4}
        fill="var(--brand)"
        stroke="none"
        fillOpacity={seal}
      />
    </>
  );
}

function Dot({ d, yc, seal }: { d: number; yc: number; seal: MotionValue<number> }) {
  const cx = useTransform(seal, (m) => dotX(d, m));
  const fillOpacity = useTransform(seal, (m) => 1 - 0.9 * m);
  return (
    <motion.circle
      data-part="dot"
      cx={cx}
      cy={yc}
      r={4}
      fill="var(--brand)"
      stroke="none"
      fillOpacity={fillOpacity}
    />
  );
}
```

- [ ] **Step 5: Write PR previews**

Create `src/components/landing/figures/pr-previews.tsx`:

```tsx
import { motion, useTransform } from 'motion/react';
import { COMMITS, branchCommit, branchHeight, branchNodeX, branchPath } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** A branch forks from the nearest commit to a preview, and merges back. */
export function PrPreviewsFigure() {
  return (
    <FigureFrame name="pr-previews">
      <PrPreviews />
    </FigureFrame>
  );
}

function PrPreviews() {
  const { px, active } = useFigure();
  const cx = useTransform(px, branchCommit);
  const d = useTransform([cx, active], ([c, a]: number[]) => branchPath(c, a));
  const nodeX = useTransform(cx, (c) => branchNodeX(c) - 22);
  const nodeY = useTransform(active, (a) => 140 - branchHeight(a) - 30);
  const dotX = useTransform(cx, branchNodeX);
  const dotY = useTransform(active, (a) => 140 - branchHeight(a) - 15);
  return (
    <>
      <line x1={24} y1={140} x2={396} y2={140} />
      {COMMITS.map((x) => (
        <circle
          key={x}
          data-part="commit"
          cx={x}
          cy={140}
          r={4}
          fill="var(--brand)"
          stroke="none"
        />
      ))}
      <motion.path data-part="branch" d={d} />
      <motion.rect
        data-part="node"
        x={nodeX}
        y={nodeY}
        width={44}
        height={30}
        rx={5}
        fill="var(--background)"
        strokeOpacity={active}
      />
      <motion.circle
        cx={dotX}
        cy={dotY}
        r={3}
        fill="var(--brand)"
        stroke="none"
        fillOpacity={active}
      />
    </>
  );
}
```

- [ ] **Step 6: Write Object storage**

Create `src/components/landing/figures/object-storage.tsx`:

```tsx
import { type MotionValue, motion, useTransform } from 'motion/react';
import { OBJECTS, objectPos, storeFill } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** Objects leave the app for a bucket whose lid never opens. */
export function ObjectStorageFigure() {
  return (
    <FigureFrame name="object-storage">
      <ObjectStorage />
    </FigureFrame>
  );
}

function ObjectStorage() {
  const { px, active } = useFigure();
  const fill = useTransform([px, active], ([x, a]: number[]) => storeFill(x, a));
  return (
    <>
      <rect x={24} y={56} width={96} height={88} rx={8} />
      <path d="M 280 40 V 168 Q 280 176 288 176 H 384 Q 392 176 392 168 V 40" />
      <rect
        data-part="lid"
        x={272}
        y={32}
        width={128}
        height={6}
        rx={2}
        fill="var(--brand)"
        stroke="none"
      />
      {Array.from({ length: OBJECTS }, (_, i) => (
        <StoredObject key={i} i={i} fill={fill} />
      ))}
    </>
  );
}

function StoredObject({ i, fill }: { i: number; fill: MotionValue<number> }) {
  const x = useTransform(fill, (f) => objectPos(i, f)[0]);
  const y = useTransform(fill, (f) => objectPos(i, f)[1]);
  return (
    <motion.rect
      data-part="object"
      x={x}
      y={y}
      width={10}
      height={10}
      rx={2}
      fill="var(--brand)"
      stroke="none"
    />
  );
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

```bash
npx vitest run --maxWorkers=8 src/components/landing/figures/figures.test.tsx src/components/landing/figures/geometry.test.ts src/components/landing/figures/figure-frame.test.tsx
```

Expected: PASS for all seven figures, the frame and the geometry, exit 0, no "Errors" line. Secrets & config renders exactly 60 shapes: 6 key bars, 48 dots and 6 seals.

- [ ] **Step 8: Typecheck, lint, format and commit**

```bash
npx tsc --noEmit && npm run lint && npx prettier --write src/components/landing/figures/logs-traces.tsx src/components/landing/figures/secrets-config.tsx src/components/landing/figures/pr-previews.tsx src/components/landing/figures/object-storage.tsx src/components/landing/figures/figures.test.tsx && npx vitest run --maxWorkers=8 src/components/landing/figures/figures.test.tsx && git add src/components/landing/figures/logs-traces.tsx src/components/landing/figures/secrets-config.tsx src/components/landing/figures/pr-previews.tsx src/components/landing/figures/object-storage.tsx src/components/landing/figures/figures.test.tsx && git commit -m "feat(landing): figures for traces, secrets, previews and object storage

Logs and traces reads a waterfall with a cursor that fills the spans it
crosses and ticks out their log lines. Secrets gathers the hovered row's
dots into one sealed block and never reveals anything. PR previews forks a
branch to a preview node and lowers it back as a merge, turning left near
the edge. Object storage moves objects from the app into a bucket whose lid
never opens."
```

---

### Task 5: Wire the figures in and retire the schematics

**Files:**

- Modify: `src/components/landing/feature-explorer.tsx`
- Modify: `src/components/landing/feature-explorer.test.tsx`
- Modify: `src/components/landing/feature-explorer.css` (old rules removed by script)
- Delete: `src/components/landing/hosting-diagrams.tsx`

**Interfaces:**

- Consumes from Tasks 3–4: the seven `*Figure` components. Also `Pillars`, already imported.
- Produces: the section shows a bespoke figure for every Hosting feature.

- [ ] **Step 1: Write the failing section tests**

In `src/components/landing/feature-explorer.test.tsx`, change the assertion inside `it('draws scale to zero as the interactive pillars field, and only there', …)`:

```tsx
expect(compute.querySelector('svg.hosting-diagram')).not.toBeNull();
```

to:

```tsx
expect(compute.querySelector('[data-figure="isolated-compute"]')).not.toBeNull();
```

and append inside `describe('feature explorer', …)`:

```tsx
it.each([
  ['Source deploys', 'source-deploys', 'An illustrated path from commit to running app.'],
  ['Isolated compute', 'isolated-compute', 'Your app. Its own runtime boundary.'],
  ['Custom domains', 'custom-domains', 'Your domain, routed to your app over TLS.'],
  ['Logs & traces', 'logs-traces', 'Illustrative spans, not measured request timings.'],
  ['Secrets & config', 'secrets-config', 'Values sealed, never shown back.'],
  ['PR previews', 'pr-previews', 'A separate preview, before the merge.'],
  ['Object storage', 'object-storage', 'Private buckets, outside your app’s runtime.'],
] as const)('draws %s as its own figure with its caption', async (name, figure, caption) => {
  const user = userEvent.setup();
  renderFeatures();
  await user.click(await screen.findByRole('tab', { name }));
  const panel = screen.getByRole('tabpanel', { name });
  expect(panel.querySelector(`[data-figure="${figure}"]`)).not.toBeNull();
  expect(panel).toHaveTextContent(caption);
});

it('keeps the connected-work diagrams as they were', async () => {
  const user = userEvent.setup();
  renderFeatures();
  await user.click(await screen.findByRole('tab', { name: /connected work/i }));
  const panel = screen.getByRole('tabpanel', { name: 'Service connections' });
  expect(panel.querySelector('svg.feature-diagram')).not.toBeNull();
  expect(panel.querySelector('[data-figure]')).toBeNull();
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run --maxWorkers=8 src/components/landing/feature-explorer.test.tsx
```

Expected: FAIL, because no Hosting panel has a `[data-figure]` yet and three captions differ. The Scale to zero and connected-work tests should already pass.

- [ ] **Step 3: Wire the figures in `feature-explorer.tsx`**

Replace the import line:

```tsx
import { HostingDiagram, type HostingDiagramKind } from './hosting-diagrams';
```

with:

```tsx
import { SourceDeploysFigure } from './figures/source-deploys';
import { IsolatedComputeFigure } from './figures/isolated-compute';
import { CustomDomainsFigure } from './figures/custom-domains';
import { LogsTracesFigure } from './figures/logs-traces';
import { SecretsConfigFigure } from './figures/secrets-config';
import { PrPreviewsFigure } from './figures/pr-previews';
import { ObjectStorageFigure } from './figures/object-storage';
```

Replace the `Diagram` type line:

```tsx
type Diagram = 'deploy' | 'flow' | 'orbit' | 'pillars' | HostingDiagramKind;
```

with:

```tsx
type Diagram =
  | 'deploy'
  | 'compute'
  | 'pillars'
  | 'domain'
  | 'trace'
  | 'secrets'
  | 'previews'
  | 'objects'
  | 'flow'
  | 'orbit';
```

Change three captions in `GROUPS`:

- `caption: 'Your domain → your application',` becomes `caption: 'Your domain, routed to your app over TLS.',`
- `caption: 'Configuration outside your source.',` becomes `caption: 'Values sealed, never shown back.',`
- The Object storage feature's `caption:` line becomes `caption: 'Private buckets, outside your app’s runtime.',`. Read the current line first and replace it whatever it says.

In `FeatureDiagram`, replace these two lines:

```tsx
if (kind === 'deploy') return <DeploymentDiagram />;
```

and

```tsx
if (kind !== 'flow' && kind !== 'orbit') return <HostingDiagram kind={kind} />;
```

The first becomes:

```tsx
if (kind === 'deploy') return <SourceDeploysFigure />;
if (kind === 'compute') return <IsolatedComputeFigure />;
if (kind === 'domain') return <CustomDomainsFigure />;
if (kind === 'trace') return <LogsTracesFigure />;
if (kind === 'secrets') return <SecretsConfigFigure />;
if (kind === 'previews') return <PrPreviewsFigure />;
if (kind === 'objects') return <ObjectStorageFigure />;
```

and delete the second line entirely. Keep the existing `if (kind === 'pillars') …` block and the `flow` and `orbit` SVG below it unchanged.

Delete the whole `DeploymentDiagram` function, from its doc comment `/** An illustrative deployment, never presented as live account activity. */` through its closing `}`.

- [ ] **Step 4: Delete the schematics and their CSS**

```bash
git rm -q src/components/landing/hosting-diagrams.tsx
```

Create the cleanup script outside the repo, at `/tmp/claude-1000/-home-bahadir-GREGALE/230573a6-25b5-453d-bdda-4f1be5583772/scratchpad/strip_old_diagram_css.py`. If that path isn't writable, use any scratch directory outside the worktree. The contents:

```python
"""Remove every CSS rule and selector that belongs to the retired Hosting schematics.

Drops selectors containing `hosting-` or `deployment-` from each selector list,
removes rules left with no selectors and `@keyframes hosting-*`, and recurses
into `@media` blocks, dropping any that end up empty. Run Prettier afterwards.
"""
import re
import sys

OLD = re.compile(r'(hosting-|deployment-)')


def close_of(text: str, open_at: int) -> int:
    depth = 0
    for k in range(open_at, len(text)):
        if text[k] == '{':
            depth += 1
        elif text[k] == '}':
            depth -= 1
            if depth == 0:
                return k + 1
    raise ValueError('unbalanced braces')


def strip(text: str) -> str:
    out, p = [], 0
    while True:
        b = text.find('{', p)
        if b < 0:
            out.append(text[p:])
            return ''.join(out)
        e = close_of(text, b)
        head, body = text[p:b], text[b:e]
        selector = head.strip()
        lead = head[: len(head) - len(head.lstrip())]
        if selector.startswith('@keyframes'):
            if not OLD.search(selector):
                out.append(head + body)
        elif selector.startswith('@media'):
            inner = strip(body[1:-1])
            if inner.strip():
                out.append(head + '{' + inner + '}')
        else:
            keep = [s.strip() for s in selector.split(',') if not OLD.search(s)]
            if keep:
                out.append(lead + ', '.join(keep) + ' ' + body)
        p = e


path = sys.argv[1]
cleaned = re.sub(r'\n{3,}', '\n\n', strip(open(path).read()))
open(path, 'w').write(cleaned)
```

Run it and format:

```bash
python3 /tmp/claude-1000/-home-bahadir-GREGALE/230573a6-25b5-453d-bdda-4f1be5583772/scratchpad/strip_old_diagram_css.py src/components/landing/feature-explorer.css && npx prettier --write src/components/landing/feature-explorer.css && grep -c "hosting-\|deployment-" src/components/landing/feature-explorer.css; git diff --stat src/components/landing/feature-explorer.css
```

Expected:

- The `grep -c` prints `0`.
- The diff shows about 199 lines removed and 1 changed: the reduced-motion selector list now ends at `.feature-connection path[data-animate='true'] {`.
- Every `.feature-figure`, `.feature-pillars` and `.feature-diagram` rule is still present.

This script was validated against the file while writing the plan.

- [ ] **Step 5: Run the section and figure tests**

```bash
grep -rn "hosting-diagrams\|HostingDiagram\|DeploymentDiagram" src || echo "no references left"
npx vitest run --maxWorkers=8 src/components/landing/feature-explorer.test.tsx src/components/landing/figures src/components/landing/textures
```

Expected: `no references left`, then PASS, exit 0, no "Errors" line.

- [ ] **Step 6: Typecheck, lint, format and commit**

```bash
npx tsc --noEmit && npm run lint && npx prettier --write src/components/landing/feature-explorer.tsx src/components/landing/feature-explorer.test.tsx && npx vitest run --maxWorkers=8 src/components/landing/feature-explorer.test.tsx && git add src/components/landing/feature-explorer.tsx src/components/landing/feature-explorer.test.tsx src/components/landing/feature-explorer.css && git commit -m "feat(landing): every Hosting feature gets its own figure

The Hosting group now reads as one family: Pillars on Scale to zero and a
bespoke wordless figure on each of the other seven, all reacting to the
pointer. Captions follow the figures where they changed meaning. The
labelled schematics, the deployment diagram and their two hundred lines of
CSS are gone; Connected work keeps its diagrams."
```

The `git rm` from Step 4 is already staged, so it lands in this commit.

---

### Task 6: Verify the branch in a real browser

No code changes unless a check fails.

**Files:** none.

**Interfaces:**

- Consumes: Tasks 1–5 committed.
- Produces: a verification report.

- [ ] **Step 1: Run the full gate**

Run each and record the result:

```bash
npx tsc --noEmit
```

```bash
npm run lint
```

```bash
npx prettier --check $(git ls-files '*.ts' '*.tsx' '*.css' '*.json' '*.md')
```

```bash
npx vitest run --maxWorkers=8
```

```bash
npm run build
```

Expected: tsc exit 0; lint 0 errors and 4 warnings; Prettier clean; vitest exit 0 with no "Errors" line (record the file and test counts); build succeeds. If one fails, fix it in the task that owns the file, commit there, and rerun all five.

- [ ] **Step 2: Find the dev server**

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://localhost:3002/
```

Expected: `200`. If it doesn't answer, start `npx vite --port 3003 --strictPort` in the background and use 3003 below. Never kill or restart the existing server.

- [ ] **Step 3: Sweep every figure at four-times CPU slowdown**

Write this script to the scratchpad as `hosting-figures-walk.mjs`. It imports Playwright from a sibling worktree, so nothing is installed. Run it with `node <path> <shots-dir> <port>`.

```js
const { chromium } =
  await import('/home/bahadir/GREGALE/.worktrees/faas-web-mock-buckets/node_modules/playwright/index.mjs');
const [shots, port = '3002'] = process.argv.slice(2);
const FEATURES = [
  ['Source deploys', 'source-deploys'],
  ['Isolated compute', 'isolated-compute'],
  ['Scale to zero', null],
  ['Custom domains', 'custom-domains'],
  ['Logs & traces', 'logs-traces'],
  ['Secrets & config', 'secrets-config'],
  ['PR previews', 'pr-previews'],
  ['Object storage', 'object-storage'],
];
const browser = await chromium.launch();
for (const [width, height, label] of [
  [1366, 900, 'desktop'],
  [390, 844, 'mobile'],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  const cdp = await page.context().newCDPSession(page);
  if (label === 'desktop') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`http://localhost:${port}/#why`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__long.push(Math.round(e.duration));
    }).observe({ type: 'longtask' });
  });
  for (const [tab, name] of FEATURES) {
    await page.getByRole('tab', { name: tab }).click();
    const fig = page.locator(name ? `[data-figure="${name}"]` : '[data-texture="pillars"]');
    await fig.waitFor();
    await fig.scrollIntoViewIfNeeded();
    const box = await fig.boundingBox();
    await page.screenshot({ path: `${shots}/${label}-${name ?? 'pillars'}-rest.png`, clip: box });
    await page.evaluate(() => (window.__long = []));
    if (label === 'desktop') {
      const until = Date.now() + 2000;
      let i = 0;
      while (Date.now() < until) {
        const t = (i % 41) / 40;
        await page.mouse.move(
          box.x + box.width * t,
          box.y + box.height * (0.2 + 0.6 * ((i % 7) / 6))
        );
        i += 1;
      }
      await page.screenshot({
        path: `${shots}/${label}-${name ?? 'pillars'}-active.png`,
        clip: box,
      });
    }
    const long = await page.evaluate(() => window.__long);
    console.log(
      label,
      name ?? 'pillars',
      `${Math.round(box.width)}x${Math.round(box.height)}`,
      'long tasks >50ms:',
      JSON.stringify(long)
    );
  }
  console.log(label, 'page errors:', JSON.stringify(errors));
  await page.close();
}
await browser.close();
```

Expected:

- Every figure prints `long tasks >50ms: []` on desktop.
- Both runs print `page errors: []`.
- On mobile, each figure is at most 390px wide.

Report any long task with the figure that caused it. Do not tune animation constants to make a number pass without saying so.

- [ ] **Step 4: Look at the screenshots**

Open each `*-rest.png` and `*-active.png` and compare it with the spec's description of that figure, for example "a straight line of commits" at rest and "a branch arcing up to a framed node" when active. Record any mismatch.

- [ ] **Step 5: Report**

Report the gate results with counts, each figure's long-task result and size, the screenshot comparison, and anything noticed but not changed. Then hand over to superpowers:finishing-a-development-branch.
