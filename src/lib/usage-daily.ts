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
