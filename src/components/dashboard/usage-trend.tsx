import { Grid, Line, LineChart, Tooltip, XAxis, YAxis } from '@/components/dither-kit';
import { Panel } from '@/components/dashboard/primitives';
import type { components } from '@/lib/api/schema';
import { formatUsageNumber } from '@/lib/usage-format';
import { biggestDay, dayLabel, monthToDateSeries, trendChart } from '@/lib/usage-trend';

type DailyUsagePoint = components['schemas']['DailyUsagePoint'];

/**
 * This month's running GB-hours against the included allowance — where the
 * line crosses the dashed one is where overage starts.
 *
 * Drawn from `daily`, the server's per-day rollups, not interpolated from the
 * month total: the forecast panel already projects a straight line, and this
 * shows the shape behind it. Rollups can trail the live total by up to a day,
 * so the caption states both rather than letting the chart pass as the bill.
 */
export function UsageTrendPanel({
  daily,
  month,
  usedGbHours,
  includedGbHours,
  now,
}: {
  daily: readonly DailyUsagePoint[] | undefined;
  month: string | undefined;
  usedGbHours: number;
  includedGbHours: number;
  /** Injected for tests; the window edge depends on today's UTC date. */
  now?: number;
}) {
  const series = monthToDateSeries(daily, month, now);

  return (
    <Panel
      title="Month to date"
      description="Cumulative GB-hours this billing month, from daily rollups."
    >
      <TrendBody series={series} usedGbHours={usedGbHours} includedGbHours={includedGbHours} />
    </Panel>
  );
}

function TrendBody({
  series,
  usedGbHours,
  includedGbHours,
}: {
  series: ReturnType<typeof monthToDateSeries>;
  usedGbHours: number;
  includedGbHours: number;
}) {
  const { points, complete } = series;

  if (points.length > 0 && !complete) {
    return (
      <Note>
        Daily rollups only reach back 30 days, so this month&apos;s running total can&apos;t start
        from the 1st. The totals above are still exact.
      </Note>
    );
  }
  if (points.length === 0) return <Note>No daily usage recorded for this month yet.</Note>;
  if (points.length < 2) {
    return <Note>The trend appears once the month has two days of usage.</Note>;
  }

  const { data, config } = trendChart(points, includedGbHours);
  const rolledUp = points[points.length - 1].cumulativeGbHours;
  const peak = biggestDay(points);

  return (
    <div className="flex flex-col gap-3">
      <LineChart data={data} config={config} className="h-48 w-full">
        <Grid />
        <XAxis dataKey="day" />
        <YAxis />
        <Tooltip labelKey="day" valueFormatter={(value) => `${formatUsageNumber(value)} GB-h`} />
        <Line dataKey="used" />
        {includedGbHours > 0 && <Line dataKey="included" strokeVariant="dashed" />}
      </LineChart>
      <p className="font-mono text-xs text-muted-foreground">
        Daily rollups: {formatUsageNumber(rolledUp)} GB-h · live total:{' '}
        {formatUsageNumber(usedGbHours)} GB-h
      </p>
      {peak && (
        <p className="text-xs text-muted-foreground">
          Biggest day: {dayLabel(peak.date)} — {formatUsageNumber(peak.dayGbHours)} GB-h
          {peak.topAppSlug && peak.topAppGbHours != null
            ? `, mostly ${peak.topAppSlug} (${formatUsageNumber(peak.topAppGbHours)} GB-h)`
            : ''}
          .
        </p>
      )}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
