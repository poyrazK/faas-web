import {
  Bar,
  BarChart,
  Grid,
  Tooltip,
  XAxis,
  YAxis,
  type ChartConfig,
} from '@/components/dither-kit';
import type { components } from '@/lib/api/schema';
import { dailyUsage, dayLabel } from '@/lib/usage-daily';
import { formatUsageNumber } from '@/lib/usage-format';
import { Panel } from './primitives';

type DailyUsagePoint = components['schemas']['DailyUsagePoint'];

const CONFIG: ChartConfig = { gbHours: { label: 'GB-hours', color: 'green' } };

/**
 * This month day by day: one bar per UTC day from `compute.daily`, the
 * server's per-day rollups (faas usage_analytics.go usageDailyPoints), so a
 * jump shows when it happened and which app did it. The bars are the
 * rollups themselves, never a curve fitted to the month total; rollups can
 * trail that total, so the caption states both.
 */
export function DailyUsagePanel({
  daily,
  month,
  usedGbHours,
  now,
}: {
  daily: readonly DailyUsagePoint[] | undefined;
  month: string;
  usedGbHours: number;
  /** Injected for tests; the window edge depends on today's UTC date. */
  now?: number;
}) {
  const { days, rolledUp, missing, fromFirst, peak } = dailyUsage(daily, month, now);
  return (
    <Panel title="Day by day" description="GB-hours per UTC day this month, from daily rollups.">
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No daily rollups for this month yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <BarChart
            data={days.map((day) => ({ day: dayLabel(day.date), gbHours: day.gbHours }))}
            config={CONFIG}
            className="h-44 w-full"
          >
            <Grid />
            <XAxis dataKey="day" />
            <YAxis />
            <Tooltip
              labelKey="day"
              valueFormatter={(value) => `${formatUsageNumber(value)} GB-h`}
            />
            <Bar dataKey="gbHours" />
          </BarChart>
          <p className="font-mono text-xs text-muted-foreground">
            Daily rollups: {formatUsageNumber(rolledUp)} GB-h · live total:{' '}
            {formatUsageNumber(usedGbHours)} GB-h
          </p>
          {peak && (
            <p className="text-xs text-muted-foreground">
              Biggest day: {dayLabel(peak.date)}, {formatUsageNumber(peak.gbHours)} GB-h
              {peak.topAppSlug && peak.topAppGbHours != null
                ? `, mostly ${peak.topAppSlug} (${formatUsageNumber(peak.topAppGbHours)} GB-h)`
                : ''}
              .
            </p>
          )}
          {(missing > 0 || !fromFirst) && (
            <p className="text-xs text-muted-foreground">
              {missing > 0 &&
                `${missing} ${missing === 1 ? 'day has' : 'days have'} no rollup and ${missing === 1 ? 'is' : 'are'} drawn at zero. `}
              {!fromFirst &&
                'Daily rollups reach back 30 days, so the 1st is not drawn; the totals above still count it.'}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
