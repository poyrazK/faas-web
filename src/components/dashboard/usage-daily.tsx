import type { components } from '@/lib/api/schema';
import { dailyUsage, dayLabel } from '@/lib/usage-daily';
import { formatUsageNumber } from '@/lib/usage-format';
import { Panel } from './primitives';

type DailyUsagePoint = components['schemas']['DailyUsagePoint'];

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
    <Panel title="Day by day" help="GB-hours per UTC day this month, from daily rollups.">
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No daily rollups for this month yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <figure aria-label="Daily compute usage in GB-hours" className="flex h-44 flex-col gap-2">
            <div className="flex min-h-0 flex-1 items-end gap-1 border-b border-border">
              {days.map((day) => (
                <div
                  key={day.date}
                  className="flex h-full min-w-0 flex-1 items-end"
                  role="img"
                  aria-label={`${dayLabel(day.date)}: ${formatUsageNumber(day.gbHours)} GB-h`}
                  title={`${dayLabel(day.date)}: ${formatUsageNumber(day.gbHours)} GB-h`}
                >
                  <span
                    className="w-full rounded-t-sm bg-[var(--status-good)]"
                    style={{
                      height: `${(day.gbHours / Math.max(1, ...days.map((d) => d.gbHours))) * 100}%`,
                    }}
                  />
                </div>
              ))}
            </div>
            <figcaption className="flex justify-between text-xs text-muted-foreground">
              <span>{dayLabel(days[0].date)}</span>
              <span>{dayLabel(days[days.length - 1].date)}</span>
            </figcaption>
          </figure>
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
