import type { ChartConfig } from '@/components/dither-kit';
import type { components } from './api/schema';

type DailyUsagePoint = components['schemas']['DailyUsagePoint'];

/** `/v1/usage/summary` sends the trailing 30 UTC days, today included. */
const WINDOW_DAYS = 30;
const MONTH = /^\d{4}-\d{2}$/;

export type MonthToDatePoint = {
  date: string;
  dayGbHours: number;
  cumulativeGbHours: number;
  topAppSlug?: string;
  topAppGbHours?: number;
};

export type MonthToDateSeries = {
  points: MonthToDatePoint[];
  /**
   * False once the 30-day window no longer reaches the 1st of the month: the
   * running total would then start from an unknown amount, not from zero.
   */
  complete: boolean;
};

/**
 * The billing month's running total, built from the daily rollups.
 *
 * The allowance resets on the UTC calendar month but `daily` is a trailing
 * window, so rows from the previous month are dropped rather than summed in.
 * A day with no row had no usage, which keeps the total flat across it — the
 * only gap that falsifies the total is one before the window starts.
 */
export function monthToDateSeries(
  daily: readonly DailyUsagePoint[] | undefined,
  month: string | undefined,
  now: number = Date.now()
): MonthToDateSeries {
  if (!daily?.length || !month || !MONTH.test(month)) return { points: [], complete: false };

  const today = new Date(now);
  const windowStart = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() - (WINDOW_DAYS - 1)
  );
  const complete = Date.parse(`${month}-01T00:00:00Z`) >= windowStart;

  let cumulative = 0;
  const points = daily
    .filter((row) => row.date.startsWith(`${month}-`))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => {
      cumulative += row.gb_hours;
      return {
        date: row.date,
        dayGbHours: row.gb_hours,
        cumulativeGbHours: cumulative,
        topAppSlug: row.top_app_slug,
        topAppGbHours: row.top_app_gb_hours,
      };
    });

  return { points, complete };
}

export type TrendRow = { day: string; used: number; included?: number };

const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** "Oct 2" for a UTC calendar day. */
export function dayLabel(date: string): string {
  return DAY_LABEL.format(Date.parse(`${date}T00:00:00Z`));
}

/**
 * Chart rows and series config. The allowance is a constant series rather
 * than a reference line because the y-scale is fitted to the series: drawn as
 * a series it stays on screen even while usage is a sliver of it.
 */
export function trendChart(
  points: readonly MonthToDatePoint[],
  includedGbHours: number
): { data: TrendRow[]; config: ChartConfig } {
  const showAllowance = includedGbHours > 0;
  const config: ChartConfig = { used: { label: 'Used this month', color: 'green' } };
  if (showAllowance) config.included = { label: 'Included', color: 'grey' };

  const data = points.map((point) => ({
    day: dayLabel(point.date),
    used: point.cumulativeGbHours,
    ...(showAllowance ? { included: includedGbHours } : {}),
  }));
  return { data, config };
}

/** The day that added the most, for naming the app behind a spike. */
export function biggestDay(points: readonly MonthToDatePoint[]): MonthToDatePoint | undefined {
  return points.reduce<MonthToDatePoint | undefined>(
    (best, point) => (!best || point.dayGbHours > best.dayGbHours ? point : best),
    undefined
  );
}
