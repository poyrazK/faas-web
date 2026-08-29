import { motion, useReducedMotion } from 'motion/react';
import { EASE } from '../reveal';

/**
 * Flow lines — evenly spaced streamlines of a single wind field, placed with
 * Jobard & Lefer's 1997 algorithm (in the manner of Book of Shapes' Flow
 * Lines, reimplemented rather than exported: the site ships no licence).
 *
 * A streamline is traced forward and backward from a seed until it leaves the
 * sheet or comes within `DTEST` of an existing line; new seeds are offered
 * `DSEP` to either side of accepted lines. That one spacing rule is what
 * makes the field read as calm weather instead of scribble — lines never
 * cluster and never cross. The field itself is arithmetic, not noise, and
 * mostly horizontal: this is the gregale, blowing through the section.
 *
 * Deterministic on purpose: generated once at module scope from a seeded
 * PRNG, so the pattern is identical across renders and between server and
 * client. Static paths only — after the scroll-jank hunt, no background here
 * gets per-frame work; the three longest gusts draw themselves once on
 * scroll-in and then hold still.
 */

const W = 880;
const H = 480;
/** Spacing between neighbouring streamlines, in viewBox units. */
const DSEP = 20;
/** A line stops when it comes this close to another. */
const DTEST = 9;
/** Integration step. */
const STEP = 3;
const MAX_STEPS = 360;
const MIN_POINTS = 22;

type Pt = readonly [number, number];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wind direction at (x,y): a gentle undulation about the horizontal. */
function angle(x: number, y: number): number {
  return Math.sin(x * 0.006 + Math.sin(y * 0.011) * 1.4) * 0.85 + Math.sin(y * 0.0045 + 1.3) * 0.45;
}

/** Occupancy grid for the proximity tests, one cell per DTEST. */
type Grid = Map<string, Pt[]>;
const cellOf = (x: number, y: number) => `${Math.floor(x / DTEST)},${Math.floor(y / DTEST)}`;

function near(grid: Grid, x: number, y: number, limit: number): boolean {
  const cx = Math.floor(x / DTEST);
  const cy = Math.floor(y / DTEST);
  const reach = Math.ceil(limit / DTEST);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const pts = grid.get(`${cx + dx},${cy + dy}`);
      if (!pts) continue;
      for (const [px, py] of pts) {
        if ((px - x) ** 2 + (py - y) ** 2 < limit * limit) return true;
      }
    }
  }
  return false;
}

function integrate(grid: Grid, sx: number, sy: number, dir: 1 | -1): Pt[] {
  const out: Pt[] = [];
  let x = sx;
  let y = sy;
  for (let i = 0; i < MAX_STEPS; i++) {
    const a = angle(x, y);
    x += Math.cos(a) * STEP * dir;
    y += Math.sin(a) * STEP * dir;
    if (x < 0 || x > W || y < 0 || y > H) break;
    if (near(grid, x, y, DTEST)) break;
    out.push([x, y]);
  }
  return out;
}

/** All streamlines, longest-first so the gusts can be peeled off the top. */
const LINES: string[] = (() => {
  const rand = mulberry32(350); // the wake budget, why not
  const grid: Grid = new Map();
  const accepted: Pt[][] = [];
  const queue: Pt[] = [[W * 0.5, H * 0.5]];
  // Random fallback seeds keep sparse corners from staying empty once the
  // queue of derived seeds runs dry.
  for (let i = 0; i < 160; i++) queue.push([rand() * W, rand() * H]);

  while (queue.length && accepted.length < 72) {
    const [sx, sy] = queue.shift()!;
    if (near(grid, sx, sy, DSEP)) continue;
    const back = integrate(grid, sx, sy, -1).reverse();
    const fwd = integrate(grid, sx, sy, 1);
    const pts: Pt[] = [...back, [sx, sy], ...fwd];
    if (pts.length < MIN_POINTS) continue;

    accepted.push(pts);
    for (const [x, y] of pts) {
      const key = cellOf(x, y);
      const cell = grid.get(key);
      if (cell) cell.push([x, y]);
      else grid.set(key, [[x, y]]);
    }
    // Offer new seeds DSEP to either side of every few points.
    for (let i = 0; i < pts.length; i += 5) {
      const [x, y] = pts[i];
      const a = angle(x, y);
      queue.push([x - Math.sin(a) * DSEP, y + Math.cos(a) * DSEP]);
      queue.push([x + Math.sin(a) * DSEP, y - Math.cos(a) * DSEP]);
    }
  }

  return accepted
    .sort((a, b) => b.length - a.length)
    .map(
      (pts) =>
        `M${pts
          .filter((_, i) => i % 2 === 0)
          .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`)
          .join('L')}`
    );
})();

const GUSTS = LINES.slice(0, 3);
const FIELD = LINES.slice(3);

export function FlowLines({ className = '' }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    >
      {/* The field. */}
      <g fill="none" stroke="var(--brand)" strokeOpacity={0.12} strokeWidth={1}>
        {FIELD.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {/* The three longest gusts draw themselves on scroll-in — same 3x
          opacity step over the field as the Truchet routes used, for the same
          reason: strong enough to follow, light enough to read through. */}
      <g
        fill="none"
        stroke="var(--brand)"
        strokeOpacity={0.34}
        strokeWidth={1.5}
        strokeLinecap="round"
      >
        {GUSTS.map((d, i) => (
          <motion.path
            key={i}
            d={d}
            initial={reduceMotion ? { pathLength: 1 } : { pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, margin: '-100px 0px' }}
            transition={{ duration: 2.1, delay: 0.2 + i * 0.3, ease: EASE }}
          />
        ))}
      </g>
    </svg>
  );
}
