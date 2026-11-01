/**
 * Pure maths for the Traffic field: the last 24 hours as an isometric field
 * of pillars, one column per hour. The front row is the measurement (height
 * proportional to that hour's requests); the rows behind it echo the same
 * hour for depth, stepping back to the north-east. Only the front row carries
 * marks: a red base for the hour's share of errors, a hollow cap for a cold start. Each row is batched into
 * a few path strings, so the field costs a handful of DOM nodes.
 */
import { formatMs } from '@/lib/mock-data';

export type HourPoint = {
  requests: number;
  error_requests: number;
  error_rate_pct: number;
  cold_boots: number;
  p95_ms: number;
};

export const COLS = 24;
export const ROWS = 6;
export const VIEW_W = 960;
export const VIEW_H = 192;

const R = 12;
const X0 = R + 2;
const ROW_DX = 14;
const ROW_DY = 12;
// Headroom above the tallest pillar is exactly the lift, so no height goes unused.
const BASE_Y = 184;
const RY = 4.5;
const MIN_H = 4;
const MAX_H = 150;
const LIFT = 26;
const REACH = 3.2;
const ECHO = 0.14;

// Columns spread so the deepest row's last pillar ends at the frame's edge.
const STEP_X = (VIEW_W - X0 - R - 2 - ROW_DX * (ROWS - 1)) / (COLS - 1);

const n = (v: number) => +v.toFixed(2);

/** The newest 24 hourly buckets, oldest first; hours the series lacks are null. */
export function lastDay<T>(points: readonly T[]): (T | null)[] {
  const day = points.slice(-COLS);
  return [...Array<null>(COLS - day.length).fill(null), ...day];
}

/** A pillar's resting height: the front row is the hour's share of the busiest hour. */
export function pillarHeight(requests: number, busiest: number, row: number) {
  if (!(busiest > 0) || !(requests > 0)) return MIN_H;
  return MIN_H + MAX_H * (requests / busiest) * (1 - ECHO * row);
}

/** How far the pointer, resting on hour `px`, raises the pillar at (col, row). */
export function lift(col: number, row: number, px: number, a: number) {
  if (a < 0.001) return 0;
  const d = Math.abs(col - px) + row * 0.35;
  return d >= REACH ? 0 : LIFT * a * Math.pow(1 - d / REACH, 1.5);
}

/** The front-row hour under a frame x, as a float, so the lift can glide between hours. */
export function hourAt(x: number) {
  return Math.min(COLS - 1, Math.max(0, (x - X0) / STEP_X));
}

/** The whole hour under a frame x. */
export const columnAt = (x: number) => Math.round(hourAt(x));

const cap = (x: number, y: number) =>
  `M${n(x - R)} ${n(y)}a${R} ${RY} 0 1 0 ${2 * R} 0a${R} ${RY} 0 1 0 ${-2 * R} 0`;
const column = (x: number, top: number, bottom: number) =>
  `M${n(x - R)} ${n(top)}V${n(bottom)}A${R} ${RY} 0 0 0 ${n(x + R)} ${n(bottom)}V${n(top)}Z`;

/** One row's path data: bodies, solid caps, and on the front row error bands and cold-start rings. */
export function rowPaths(row: number, day: readonly (HourPoint | null)[], px: number, a: number) {
  const busiest = Math.max(0, ...day.map((h) => h?.requests ?? 0));
  const bottom = BASE_Y - row * ROW_DY;
  let bodies = '';
  let caps = '';
  let errors = '';
  let cold = '';
  day.forEach((hour, c) => {
    if (!hour) return;
    const x = X0 + c * STEP_X + row * ROW_DX;
    const h = pillarHeight(hour.requests, busiest, row) + lift(c, row, px, a);
    const top = bottom - h;
    bodies += column(x, top, bottom);
    if (row === 0 && hour.cold_boots > 0) cold += cap(x, top);
    else caps += cap(x, top);
    if (row === 0 && hour.error_requests > 0 && hour.requests > 0) {
      // Strictly proportional: a 0.4% hour is a sliver, an 11% hour is a band.
      // The readout still gives every hour's exact rate.
      const band = (h - MIN_H) * (hour.error_requests / hour.requests);
      if (band >= 0.5) errors += column(x, bottom - band, bottom);
    }
  });
  return { bodies, caps, errors, cold };
}

const count = (v: number) => v.toLocaleString('en-US');

/** What the header says while the pointer or keyboard rests on an hour. */
export function hourReadout(hour: HourPoint | null, hoursAgo: number) {
  // The newest bucket is still filling, so it is shorter than the hour it will be.
  const when = hoursAgo === 0 ? 'This hour so far' : `${hoursAgo}h ago`;
  if (!hour) return `${when} · not recorded`;
  if (!(hour.requests > 0)) return `${when} · no requests`;
  const errors =
    hour.error_requests > 0 ? `${hour.error_rate_pct.toFixed(2)}% errors` : 'no errors';
  const cold =
    hour.cold_boots > 0
      ? ` · ${hour.cold_boots} cold start${hour.cold_boots === 1 ? '' : 's'}`
      : '';
  return `${when} · ${count(hour.requests)} requests · ${errors} · p95 ${formatMs(hour.p95_ms)}${cold}`;
}
