import type { AnalyticsPoint } from './analytics-grid';
import { metricNumber } from './analytics-data';
import type { DetailMetric } from './metric-detail-search';
import type { DebugSearch } from './debug-search';

/**
 * The popup's plain-English layer: what the window is called, whether the
 * figure is normal, and where to look next. Everything here reads real
 * figures; nothing averages hourly percentiles or invents an account series.
 */

export const POPUP_WINDOWS = ['1h', '24h', '7d'] as const;

const UNIT: Record<string, [string, string]> = {
  m: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  d: ['day', 'days'],
};

/** "Last 24 hours" for a preset; an exact timestamp window is "Custom window". */
export function windowLabel(since: string): string {
  const match = /^(\d+)([mhd])$/.exec(since);
  if (!match) return 'Custom window';
  const n = Number(match[1]);
  const [one, many] = UNIT[match[2]];
  return n === 1 ? `Last ${one}` : `Last ${n} ${many}`;
}

const minutes = (since: string) => {
  const match = /^(\d+)([mhd])$/.exec(since);
  return match ? Number(match[1]) * { m: 1, h: 60, d: 1440 }[match[2] as 'm' | 'h' | 'd'] : 0;
};

/** 1h · 24h · 7d, plus the preset the opener passed when it's another one, in order. */
export function windowOptions(since: string): string[] {
  const options: string[] = [...POPUP_WINDOWS];
  if (minutes(since) && !options.includes(since)) options.push(since);
  return options.sort((a, b) => minutes(a) - minutes(b));
}

export type Tone = 'good' | 'warning' | 'critical' | 'neutral';
export type Verdict = { tone: Tone; label: string } | null;

/**
 * A count's change across equal groups of complete hours (`compareRequestHalves`).
 * Within ±15% reads as steady. Latency and rates get no before/after verdict.
 * "No failures" is decided by the window's total, never by the halves: they
 * leave out the current partial hour, where an incident shows up first.
 */
export function countVerdict(
  metric: DetailMetric,
  comparison: { before: number; after: number; delta: number | null } | null,
  total?: number | null
): Verdict {
  const errors = metric === 'errors';
  if (errors && total === 0) return { tone: 'good', label: 'No failures' };
  if (!comparison || !['requests', 'errors', 'cold_boots'].includes(metric)) return null;
  if (errors && comparison.before === 0 && comparison.after > 0)
    return { tone: 'warning', label: 'New failures' };
  if (comparison.delta === null) return null;
  if (Math.abs(comparison.delta) < 15) return { tone: 'neutral', label: 'Steady' };
  const up = comparison.delta > 0;
  if (errors)
    return up
      ? { tone: 'warning', label: 'More failures than earlier' }
      : { tone: 'good', label: 'Fewer failures than earlier' };
  return { tone: 'neutral', label: up ? 'Busier than earlier' : 'Quieter than earlier' };
}

/** An error rate on fixed bands. */
export function rateVerdict(pct: number | null | undefined): Verdict {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct === 0) return { tone: 'good', label: 'No failures' };
  if (pct < 1) return { tone: 'good', label: 'Healthy' };
  if (pct < 5) return { tone: 'warning', label: 'Worth a look' };
  return { tone: 'critical', label: 'High' };
}

/**
 * The hour with the most of this metric: the busiest, the most failures,
 * the slowest. Hours with no requests have no rate or latency and are skipped.
 * A count that never left zero has no busiest hour.
 */
export function busiestHour(
  metric: DetailMetric,
  points: AnalyticsPoint[]
): { index: number; start: string; value: number } | null {
  let best: { index: number; start: string; value: number } | null = null;
  for (const [index, point] of points.entries()) {
    const value = metricNumber(metric, point);
    if (value == null || !Number.isFinite(value)) continue;
    if (!best || value > best.value) best = { index, start: point.start, value };
  }
  return best && best.value > 0 ? best : null;
}

export const DEBUG_WINDOW = (since: string): NonNullable<DebugSearch['debugWindow']> => {
  const m = minutes(since);
  if (!m) return '24h';
  if (m <= 60) return '1h';
  if (m <= 360) return '6h';
  if (m <= 1440) return '24h';
  return '72h';
};

/** The Debugger's requests view, narrowed to what the popup was showing. */
export function debuggerSearch(metric: DetailMetric, since: string, route?: string) {
  const filter: DebugSearch['debugFilter'] =
    metric === 'errors' || metric === 'error_rate'
      ? 'failed'
      : metric === 'p50' || metric === 'p95' || metric === 'p99'
        ? 'slow'
        : metric === 'cold_boots' || metric === 'cold_rate'
          ? 'cold'
          : undefined;
  return {
    tab: 'Debugger' as const,
    debugView: 'requests' as const,
    debugWindow: DEBUG_WINDOW(since),
    ...(filter ? { debugFilter: filter } : {}),
    ...(route ? { debugQuery: route } : {}),
  };
}

/**
 * The action's words for that same view. The Debugger looks back 3 days at
 * most, so a longer window says so rather than implying all of it.
 */
export function debuggerLabel(metric: DetailMetric, since = '24h'): string {
  const filter = debuggerSearch(metric, since).debugFilter;
  const words =
    filter === 'failed'
      ? 'See failed requests'
      : filter === 'slow'
        ? 'See slow requests'
        : filter === 'cold'
          ? 'See requests that woke the app'
          : 'See these requests';
  return minutes(since) > 4320 ? `${words} from the last 3 days` : words;
}
