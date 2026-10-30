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

/** 0 → 1 over the last part of progress; `(1 - start)` cancels exactly at p = 1. */
const tail = (p: number, start: number) => clamp01((p - start) / (1 - start));
export const deployFrame = (p: number) => tail(p, 0.66);
export const deployDotRadius = (p: number) => 6 * tail(p, 0.85);

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

/** Keyboard focus point: the centre of column 3, row 1; the grid's own centre is a gap. */
export const COMPUTE_FOCUS = [243, 100] as const;

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
/** Keyboard focus point: row 2's seal; the frame's centre falls between rows 2 and 3. */
export const SECRETS_FOCUS = [223, 86] as const;
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
