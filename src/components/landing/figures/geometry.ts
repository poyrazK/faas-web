/**
 * Pure maths for the Hosting figures. Each figure is a dense texture in the
 * Pillars recipe: a field of small marks, batched into a few paths per row,
 * that answers the pointer with one soft radial falloff and settles back.
 *
 * A field is `{ rows, row(r, x, y, a) }`: given the spring-smoothed pointer
 * (x, y) in the 420 × 200 frame and `a` (0 at rest, 1 while acted on), `row`
 * returns that row's path data keyed by layer. At `a = 0` every field draws
 * its resting frame, wherever the pointer was.
 */
export type Layer = {
  /** The key `row` returns this layer's path data under. */
  key: string;
  fill?: string;
  stroke?: string;
  opacity?: number;
};

export type Field = {
  /** The figure's `data-figure` name. */
  name: string;
  rows: number;
  /** Drawn in this order within each row, rows top to bottom. */
  layers: readonly Layer[];
  row: (r: number, x: number, y: number, a: number) => Record<string, string>;
};

const BRAND = 'var(--brand)';
const SURFACE = 'var(--background)';

const RADIUS = 70;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const n = (v: number) => +v.toFixed(2);

/** How strongly the pointer at (x, y) acts on a point at (x0, y0): Pillars' 1.5 falloff. */
export function influence(
  x0: number,
  y0: number,
  x: number,
  y: number,
  a: number,
  radius = RADIUS
) {
  if (a < 0.001) return 0;
  const d = Math.hypot(x0 - x, y0 - y) / radius;
  return d >= 1 ? 0 : a * Math.pow(1 - d, 1.5);
}

/** Deterministic 0..1 noise per cell: organic, but identical on every render. */
export function hash(i: number, j: number) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A horizontal capsule (fully rounded rectangle) as a path segment. */
export function capsule(x: number, y: number, w: number, h: number) {
  const r = Math.min(h, w) / 2;
  const body = Math.max(0, w - 2 * r);
  return `M${n(x + r)} ${n(y)}h${n(body)}a${n(r)} ${n(r)} 0 0 1 0 ${n(2 * r)}h${n(-body)}a${n(r)} ${n(r)} 0 0 1 0 ${n(-2 * r)}z`;
}

/** A circle as a path segment; nothing when it has no radius. */
export function circle(cx: number, cy: number, r: number) {
  if (r <= 0) return '';
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0`;
}

/** An axis-aligned rectangle as a path segment; nothing when it is empty. */
export function box(x: number, y: number, w: number, h: number) {
  if (w <= 0 || h <= 0) return '';
  return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;
}

/** A quadrilateral through four corners as a path segment. */
function quad(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
) {
  return `M${n(ax)} ${n(ay)}L${n(bx)} ${n(by)}L${n(cx)} ${n(cy)}L${n(dx)} ${n(dy)}Z`;
}

// Source deploys: a flow field of short strokes leaning along a smooth current.
// Near the pointer they align to the deploy direction (right), longer and bolder.

/** The resting current, an angle in radians; smooth, so neighbours lean together. */
export function current(x: number, y: number) {
  return (
    1.1 * Math.sin(x * 0.019 + 1.4 * Math.sin(y * 0.031)) + 0.7 * Math.cos(y * 0.026 - x * 0.012)
  );
}

export function deployStroke(cx: number, cy: number, x: number, y: number, a: number) {
  const k = influence(cx, cy, x, y, a, 100);
  return { angle: current(cx, cy) * (1 - k), length: 5.5 + 4 * k, width: 1.2 + 2 * k };
}

export const DEPLOYS: Field = {
  name: 'source-deploys',
  rows: 20,
  layers: [{ key: 'strokes', fill: BRAND }],
  row(r, x, y, a) {
    let strokes = '';
    const cy = 5 + r * 10;
    for (let c = 0; c < 42; c++) {
      const cx = 5 + c * 10;
      const { angle, length, width } = deployStroke(cx, cy, x, y, a);
      const [ux, uy] = [(Math.cos(angle) * length) / 2, (Math.sin(angle) * length) / 2];
      const [ox, oy] = [(-Math.sin(angle) * width) / 2, (Math.cos(angle) * width) / 2];
      strokes += quad(
        cx - ux + ox,
        cy - uy + oy,
        cx + ux + ox,
        cy + uy + oy,
        cx + ux - ox,
        cy + uy - oy,
        cx - ux - ox,
        cy - uy - oy
      );
    }
    return { strokes };
  },
};

// Isolated compute: a dense isometric field of separate microVM boxes, offset
// every other row and drawn back to front. The pointer lifts the boxes near it.

const BOX_W = 16;
const BOX_H = 8;
const BOX_STEP_X = 30;
const BOX_STEP_Y = 17;
const BOX_BODY = 96; // bodies hang behind the rows in front, so only tops and edges show
const BOX_PEAK = 24;
const BOX_REACH = 3.2; // in cells

const boxX = (r: number, c: number) =>
  c * BOX_STEP_X + (r % 2 ? BOX_STEP_X / 2 : 0) - BOX_STEP_X / 2;
const boxY = (r: number) => r * BOX_STEP_Y - BOX_H;

export function computeLift(r: number, c: number, x: number, y: number, a: number) {
  if (a < 0.001) return 0;
  const d = Math.hypot((boxX(r, c) - x) / BOX_STEP_X, (boxY(r) - y) / BOX_STEP_Y);
  return d >= BOX_REACH ? 0 : BOX_PEAK * a * Math.pow(1 - d / BOX_REACH, 1.5);
}

export const COMPUTE: Field = {
  name: 'isolated-compute',
  rows: 14,
  layers: [
    { key: 'left', fill: SURFACE, stroke: BRAND },
    { key: 'right', fill: SURFACE, stroke: BRAND },
    { key: 'top', fill: BRAND, stroke: BRAND },
  ],
  row(r, x, y, a) {
    let left = '';
    let right = '';
    let top = '';
    const hw = BOX_W / 2;
    const hh = BOX_H / 2;
    for (let c = 0; c < 16; c++) {
      const X = boxX(r, c);
      const Y = boxY(r) - computeLift(r, c, x, y, a);
      top += quad(X, Y - hh, X + hw, Y, X, Y + hh, X - hw, Y);
      left += quad(X - hw, Y, X, Y + hh, X, Y + hh + BOX_BODY, X - hw, Y + BOX_BODY);
      right += quad(X, Y + hh, X + hw, Y, X + hw, Y + BOX_BODY, X, Y + hh + BOX_BODY);
    }
    return { left, right, top };
  },
};

// Custom domains: a route mesh of hairline streets with a ring at every
// junction. Near the pointer junctions seal and the streets thicken into routes.

const MESH = 20;
const RING = 2.6;
const STREET = 0.6;

function routeWidth(k: number) {
  const t = STREET + 1.6 * k;
  return t > STREET + 0.02 ? t : 0;
}

export const DOMAINS: Field = {
  name: 'custom-domains',
  rows: 10,
  layers: [
    { key: 'street', fill: BRAND, opacity: 0.32 },
    { key: 'route', fill: BRAND },
    { key: 'ring', fill: SURFACE, stroke: BRAND },
    { key: 'dot', fill: BRAND },
  ],
  row(r, x, y, a) {
    let street = '';
    let route = '';
    let ring = '';
    let dot = '';
    const cy = 10 + r * MESH;
    for (let c = 0; c < 21; c++) {
      const cx = 10 + c * MESH;
      const k = influence(cx, cy, x, y, a, 85);
      ring += circle(cx, cy, RING);
      dot += circle(cx, cy, (RING + 0.6) * k);
      if (c < 20) {
        const t = routeWidth((k + influence(cx + MESH, cy, x, y, a, 85)) / 2);
        street += box(cx, cy - STREET / 2, MESH, STREET);
        route += box(cx, cy - t / 2, MESH, t);
      }
      if (r < 9) {
        const t = routeWidth((k + influence(cx, cy + MESH, x, y, a, 85)) / 2);
        street += box(cx - STREET / 2, cy, STREET, MESH);
        route += box(cx - t / 2, cy, t, MESH);
      }
    }
    return { street, route, ring, dot };
  },
};

// Logs & traces: a barcode of hairline spans, row after row, that swell into
// solid bars where the pointer reads.

const TRACE_GAP = 3;

/** Each row's spans as [x, width], tiling the row edge to edge. */
export const TRACE_SPANS = Array.from({ length: 10 }, (_, r) => {
  const spans: [number, number][] = [];
  let x = -hash(r, 99) * 20;
  for (let i = 0; x < 420 + TRACE_GAP; i++) {
    const w = 4 + Math.pow(hash(r, i), 2) * 44;
    spans.push([x, w]);
    x += w + TRACE_GAP;
  }
  return spans;
});

export const spanHeight = (k: number) => 1 + 9 * k;

export const TRACES: Field = {
  name: 'logs-traces',
  rows: 10,
  layers: [{ key: 'spans', fill: BRAND }],
  row(r, x, y, a) {
    let spans = '';
    const cy = 10 + r * 20;
    for (const [sx, w] of TRACE_SPANS[r]) {
      const h = spanHeight(influence(sx + w / 2, cy, x, y, a, 85));
      spans += box(sx, cy - h / 2, w, h);
    }
    return { spans };
  },
};

// Secrets & config: a fine dot matrix whose dots fuse into sealed bands.

export const sealSize = (k: number) => ({ w: 2.4 + 8.2 * k, h: 2.4 + 3.6 * k });

export const SECRETS: Field = {
  name: 'secrets-config',
  rows: 20,
  layers: [{ key: 'dots', fill: BRAND }],
  row(r, x, y, a) {
    let dots = '';
    const cy = 5 + r * 10;
    for (let c = 0; c < 42; c++) {
      const cx = 5 + c * 10;
      const { w, h } = sealSize(influence(cx, cy, x, y, a, 75));
      dots += capsule(cx - w / 2, cy - h / 2, w, h);
    }
    return { dots };
  },
};

// PR previews: parallel lines that part around the pointer, opening a preview
// beside the main line. Lines above go up, lines below go down; none cross.

const BRANCH = 22;

export function branchY(sx: number, y0: number, x: number, y: number, a: number) {
  const k = influence(sx, y0, x, y, a, 90);
  return y0 + BRANCH * k * Math.tanh((y0 - y) / 6);
}

export const PREVIEWS: Field = {
  name: 'pr-previews',
  rows: 20,
  layers: [{ key: 'line', stroke: BRAND }],
  row(i, x, y, a) {
    const y0 = 5 + i * 10;
    let line = '';
    for (let sx = -6; sx <= 426; sx += 6)
      line += `${line ? 'L' : 'M'}${n(sx)} ${n(branchY(sx, y0, x, y, a))}`;
    return { line };
  },
};

// Object storage: a skyline of buckets, each a column of slots with objects
// stacked from the floor. Near the pointer more objects drop in.

export const STORAGE_ROWS = 16;
export const STORAGE_RISE = 7;
const SLOT_STEP = 12;
const SLOT = 8;

/** Resting stack height per bucket, in slots: a smooth skyline with a little grain. */
export const STORAGE_LEVELS = Array.from({ length: 35 }, (_, c) =>
  Math.max(
    0,
    Math.round(2.6 + 3.2 * Math.sin(c * 0.36) * Math.cos(c * 0.13 + 1) + 1.4 * (hash(c, 3) - 0.5))
  )
);

/** How full a slot is (0..1), counted from the floor, given the pointer's pull on its bucket. */
export function slotFill(c: number, fromFloor: number, k: number) {
  return clamp(STORAGE_LEVELS[c] + STORAGE_RISE * k - fromFloor, 0, 1);
}

export const STORAGE: Field = {
  name: 'object-storage',
  rows: STORAGE_ROWS,
  layers: [
    { key: 'slot', stroke: BRAND, opacity: 0.35 },
    { key: 'object', fill: BRAND },
  ],
  row(r, x, y, a) {
    let slot = '';
    let object = '';
    const top = 4 + r * SLOT_STEP + (SLOT_STEP - SLOT) / 2;
    for (let c = 0; c < STORAGE_LEVELS.length; c++) {
      const left = c * SLOT_STEP + (SLOT_STEP - SLOT) / 2;
      // A bucket answers to the pointer's distance across, not up and down.
      const fill = slotFill(c, STORAGE_ROWS - 1 - r, influence(left + SLOT / 2, y, x, y, a));
      if (fill < 1) slot += box(left, top, SLOT, SLOT);
      object += box(left, top + SLOT * (1 - fill), SLOT, SLOT * fill);
    }
    return { slot, object };
  },
};
