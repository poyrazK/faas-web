import { stack, stackOffsetSilhouette, stackOrderNone, area, curveMonotoneX } from 'd3-shape';
import type { AnalyticsPoint } from '../analytics-grid';

/**
 * Pure shaping for the Overview bento. Everything charted here comes from
 * `/v1/apps/{slug}/analytics/timeseries` — hourly, UTC-aligned, zero-filled
 * request records — summed across apps. Counts add up across apps; latency
 * percentiles do not, so a summed point deliberately carries none.
 */

export type SummedPoint = Pick<
  AnalyticsPoint,
  'start' | 'requests' | 'error_requests' | 'cold_boots'
>;

export interface AppSeries {
  slug: string;
  name: string;
  points: SummedPoint[];
}

/**
 * Drop the hour still in progress. Totals count it — those requests happened —
 * but a figure drawn per hour would show it as a sudden fall.
 */
export function completeHours(series: AppSeries[], until: string | undefined): AppSeries[] {
  if (!until) return series;
  const end = Date.parse(until);
  return series.map((app) => ({
    ...app,
    points: app.points.filter((p) => Date.parse(p.start) + 3_600_000 <= end),
  }));
}

/** Bucket-by-bucket sum of every app's hourly series, oldest first. */
export function sumSeries(series: AppSeries[]): SummedPoint[] {
  const byStart = new Map<number, SummedPoint>();
  for (const app of series) {
    for (const point of app.points) {
      const at = Date.parse(point.start);
      const total = byStart.get(at) ?? {
        start: point.start,
        requests: 0,
        error_requests: 0,
        cold_boots: 0,
      };
      total.requests += point.requests;
      total.error_requests += point.error_requests;
      total.cold_boots += point.cold_boots;
      byStart.set(at, total);
    }
  }
  return [...byStart.entries()].sort(([a], [b]) => a - b).map(([, point]) => point);
}

export interface Totals {
  requests: number;
  errors: number;
  coldBoots: number;
  /** null when nothing was requested: a rate over zero requests is unknown, not 0%. */
  errorRatePct: number | null;
}

export function totalsOf(points: SummedPoint[]): Totals {
  const requests = points.reduce((sum, p) => sum + p.requests, 0);
  const errors = points.reduce((sum, p) => sum + p.error_requests, 0);
  const coldBoots = points.reduce((sum, p) => sum + p.cold_boots, 0);
  return { requests, errors, coldBoots, errorRatePct: requests ? (errors / requests) * 100 : null };
}

/* ------------------------------------------------------------------ *
 * Stream
 * ------------------------------------------------------------------ */

export interface StreamPin {
  /** 0..1 across the plot. */
  x: number;
  start: string;
  requests: number;
  kind: 'peak' | 'latest';
}

export interface StreamGeometry {
  bands: { slug: string; name: string; d: string }[];
  pins: StreamPin[];
}

/**
 * A silhouette stream: one band per app, centred, in a `width`×`height` box.
 * The largest app sits first so the brightest band carries the most traffic.
 */
export function streamGeometry(series: AppSeries[], width: number, height: number): StreamGeometry {
  const totals = sumSeries(series);
  if (totals.length < 2) return { bands: [], pins: [] };
  const starts = totals.map((p) => Date.parse(p.start));
  const ordered = [...series].sort(
    (a, b) => totalsOf(b.points).requests - totalsOf(a.points).requests
  );
  const rows = starts.map((at) => {
    const row: Record<string, number> = {};
    for (const app of ordered) {
      row[app.slug] = app.points.find((p) => Date.parse(p.start) === at)?.requests ?? 0;
    }
    return row;
  });
  const layers = stack<Record<string, number>>()
    .keys(ordered.map((a) => a.slug))
    .order(stackOrderNone)
    .offset(stackOffsetSilhouette)(rows);
  const peakTotal = Math.max(1, ...totals.map((p) => p.requests));
  const pad = 8;
  const scaleY = (height - pad * 2) / peakTotal;
  const x = (i: number) => (i / (totals.length - 1)) * width;
  const y = (v: number) => height / 2 - v * scaleY;
  const shape = area<[number, number]>()
    .x((_, i) => x(i))
    .y0((d) => y(d[0]))
    .y1((d) => y(d[1]))
    .curve(curveMonotoneX);
  const bands = layers.map((layer, k) => ({
    slug: ordered[k].slug,
    name: ordered[k].name,
    d: shape(layer.map((d) => [d[0], d[1]] as [number, number])) ?? '',
  }));

  const pins: StreamPin[] = [];
  const peakIndex = totals.reduce(
    (best, p, i) => (p.requests > totals[best].requests ? i : best),
    0
  );
  if (totals[peakIndex].requests > 0) {
    pins.push({
      x: peakIndex / (totals.length - 1),
      start: totals[peakIndex].start,
      requests: totals[peakIndex].requests,
      kind: 'peak',
    });
  }
  const last = totals.length - 1;
  // A peak in the final hour is already pinned; never stack two pins.
  if (last !== peakIndex) {
    pins.push({ x: 1, start: totals[last].start, requests: totals[last].requests, kind: 'latest' });
  }
  return { bands, pins };
}

/* ------------------------------------------------------------------ *
 * Ticks
 * ------------------------------------------------------------------ */

export interface Tick {
  /** 0..100, for a CSS height. */
  height: number;
  hot: boolean;
  label: string;
}

const hourLabel = (start: string) =>
  new Date(start).toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/** Error rate per hour. A request-less hour has no rate and draws as an empty stub. */
export function errorTicks(points: SummedPoint[], hotPct = 5): Tick[] {
  const rates = points.map((p) => (p.requests ? (p.error_requests / p.requests) * 100 : null));
  const max = Math.max(hotPct, ...rates.map((r) => r ?? 0));
  return points.map((p, i) => {
    const rate = rates[i];
    return {
      height: rate == null ? 0 : Math.max(8, Math.sqrt(rate / max) * 100),
      hot: rate != null && rate >= hotPct,
      label: `${hourLabel(p.start)} UTC · ${rate == null ? 'no requests' : `${rate.toFixed(2)}% errors`}`,
    };
  });
}

/** Cold boots per hour, the busiest hour marked. */
export function coldBootTicks(points: SummedPoint[]): Tick[] {
  const max = Math.max(1, ...points.map((p) => p.cold_boots));
  return points.map((p) => ({
    height: p.cold_boots ? Math.max(6, (p.cold_boots / max) * 100) : 0,
    hot: p.cold_boots === max && p.cold_boots > 0,
    label: `${hourLabel(p.start)} UTC · ${p.cold_boots} cold ${p.cold_boots === 1 ? 'boot' : 'boots'}`,
  }));
}

/** A half-ring of `count` ticks, -90° (left) to 90° (right); lit up to `fraction`. */
export function gaugeTicks(fraction: number, count = 41): { angle: number; lit: boolean }[] {
  const clamped = Math.min(1, Math.max(0, fraction));
  return Array.from({ length: count }, (_, i) => ({
    angle: -90 + (180 * i) / (count - 1),
    lit: count > 1 && i / (count - 1) <= clamped && clamped > 0,
  }));
}

/* ------------------------------------------------------------------ *
 * Hour field
 * ------------------------------------------------------------------ */

export type FieldCell =
  | { kind: 'empty'; title: string }
  | { kind: 'errors'; title: string }
  | { kind: 'traffic'; level: number; title: string };

/** Hours whose error share is at least this, with enough requests to mean it. */
export const FIELD_ERROR_PCT = 5;
const FIELD_ERROR_MIN_REQUESTS = 20;

/**
 * One row per app, one cell per hour. Brightness is relative to the busiest
 * app-hour on screen (square-root, so a small app is still visible).
 */
export function fieldRows(
  series: AppSeries[]
): { slug: string; name: string; cells: FieldCell[] }[] {
  const max = Math.max(1, ...series.flatMap((app) => app.points.map((p) => p.requests)));
  return series.map((app) => ({
    slug: app.slug,
    name: app.name,
    cells: app.points.map((p): FieldCell => {
      const when = `${app.name} · ${hourLabel(p.start)} UTC ${new Date(p.start).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' })}`;
      if (p.requests === 0) return { kind: 'empty', title: `${when} · no requests` };
      const share = (p.error_requests / p.requests) * 100;
      if (p.requests >= FIELD_ERROR_MIN_REQUESTS && share >= FIELD_ERROR_PCT) {
        return { kind: 'errors', title: `${when} · ${share.toFixed(1)}% errors` };
      }
      return {
        kind: 'traffic',
        level: Math.sqrt(p.requests / max),
        title: `${when} · ${p.requests.toLocaleString('en')} requests`,
      };
    }),
  }));
}

/** UTC day boundaries inside a series, for the field's column headings. */
export function dayMarks(points: SummedPoint[]): { index: number; label: string }[] {
  const marks: { index: number; label: string }[] = [];
  points.forEach((p, i) => {
    const at = new Date(p.start);
    if (i === 0 || at.getUTCHours() === 0) {
      marks.push({
        index: i,
        label: at.toLocaleDateString('en-GB', {
          timeZone: 'UTC',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
      });
    }
  });
  return marks;
}
