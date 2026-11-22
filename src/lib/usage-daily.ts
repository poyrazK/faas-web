import type { components } from './api/schema';

type DailyUsagePoint = components['schemas']['DailyUsagePoint'];

/** apid keeps the trailing 30 UTC days, today included (faas pgstore.go UsageDailyForAccount). */
const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const MONTH = /^\d{4}-\d{2}$/;

export interface UsageDay {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  gbHours: number;
  /** False when apid sent no rollup for the day; it is drawn at zero and said so. */
  reported: boolean;
  topAppSlug?: string;
  topAppGbHours?: number;
}

export interface DailyUsage {
  days: UsageDay[];
  /** The rollups summed; they can trail the live month total. */
  rolledUp: number;
  /** Days in the range with no rollup row. */
  missing: number;
  /** False once the 30-day window no longer reaches the 1st of the month. */
  fromFirst: boolean;
  /** The reported day that added the most, earliest on a tie. */
  peak?: UsageDay;
}

/**
 * The month's `daily` rollups as one bar per UTC day, from the 1st (or the
 * window's edge) to the last day apid reported. Rows are the server's own
 * per-day sums, never interpolated from the month total; a day inside that
 * range with no row is kept at zero so the bars stay one per calendar day,
 * and `missing` lets the caption say how many there are.
 */
export function dailyUsage(
  points: readonly DailyUsagePoint[] | undefined,
  month: string,
  now: number = Date.now()
): DailyUsage {
  const rows = MONTH.test(month)
    ? (points ?? [])
        .filter((p) => p.date.startsWith(`${month}-`))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  if (!rows.length) return { days: [], rolledUp: 0, missing: 0, fromFirst: true };

  const today = new Date(now);
  const windowStart = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() - (WINDOW_DAYS - 1)
  );
  const monthStart = Date.parse(`${month}-01T00:00:00Z`);
  const firstRow = Date.parse(`${rows[0].date}T00:00:00Z`);
  const start = Math.min(Math.max(monthStart, windowStart), firstRow);
  const end = Date.parse(`${rows[rows.length - 1].date}T00:00:00Z`);

  const byDate = new Map(rows.map((row) => [row.date, row]));
  const days: UsageDay[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const date = new Date(ms).toISOString().slice(0, 10);
    const row = byDate.get(date);
    days.push(
      row
        ? {
            date,
            gbHours: row.gb_hours,
            reported: true,
            topAppSlug: row.top_app_slug,
            topAppGbHours: row.top_app_gb_hours,
          }
        : { date, gbHours: 0, reported: false }
    );
  }
  const peak = days.reduce<UsageDay | undefined>(
    (best, day) => (day.reported && (!best || day.gbHours > best.gbHours) ? day : best),
    undefined
  );
  return {
    days,
    rolledUp: rows.reduce((sum, row) => sum + row.gb_hours, 0),
    missing: days.filter((day) => !day.reported).length,
    fromFirst: windowStart <= monthStart,
    peak,
  };
}

const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** "Nov 2" for a UTC calendar day. */
export function dayLabel(date: string): string {
  return DAY_LABEL.format(Date.parse(`${date}T00:00:00Z`));
}

const WEEKDAY_LABEL = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export interface DayDetail {
  /** "Wed, Nov 4", with "· today so far" while the UTC day is still running. */
  title: string;
  gbHours: number;
  reported: boolean;
  top: { slug: string; gbHours: number; pct: number } | null;
  /** Against the average reported day in view; null without a rollup, and for today. */
  versus: string | null;
  /** Rollups summed from the first bar through this day. */
  monthSoFar: number;
  /** `monthSoFar` as a share of the plan's included GB-hours, when there is one. */
  allowancePct: number | null;
}

/**
 * What one bar means, for its hover and keyboard readout: the day's hours,
 * the app behind most of them, how it compares with a usual day, and where
 * the month stood by then. Everything comes from the same rollups as the bars.
 */
export function dayDetail(
  usage: DailyUsage,
  index: number,
  { now = Date.now(), includedGbHours }: { now?: number; includedGbHours?: number | null } = {}
): DayDetail {
  const day = usage.days[index];
  const today = new Date(now).toISOString().slice(0, 10);
  const reported = usage.days.filter((d) => d.reported);
  const average = reported.length
    ? reported.reduce((sum, d) => sum + d.gbHours, 0) / reported.length
    : 0;
  const ratio = average > 0 ? day.gbHours / average : null;
  const monthSoFar =
    Math.round(usage.days.slice(0, index + 1).reduce((sum, d) => sum + d.gbHours, 0) * 1e4) / 1e4;
  return {
    title: `${WEEKDAY_LABEL.format(Date.parse(`${day.date}T00:00:00Z`))}${day.date === today ? ' · today so far' : ''}`,
    gbHours: day.gbHours,
    reported: day.reported,
    top:
      day.reported && day.topAppSlug && day.topAppGbHours != null
        ? {
            slug: day.topAppSlug,
            gbHours: day.topAppGbHours,
            pct: day.gbHours > 0 ? Math.round((day.topAppGbHours / day.gbHours) * 100) : 0,
          }
        : null,
    // Today is still running, so it isn't compared with whole days yet.
    versus:
      !day.reported || ratio === null || day.date === today
        ? null
        : ratio >= 1.5
          ? `${ratio.toFixed(1)}× a usual day`
          : ratio <= 2 / 3
            ? 'Quieter than a usual day'
            : 'About a usual day',
    monthSoFar,
    allowancePct:
      includedGbHours && includedGbHours > 0
        ? Math.round((monthSoFar / includedGbHours) * 100)
        : null,
  };
}
