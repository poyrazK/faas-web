import { useState, type KeyboardEvent } from 'react';
import type { components } from '@/lib/api/schema';
import { dailyUsage, dayDetail, dayLabel, type DailyUsage } from '@/lib/usage-daily';
import { formatUsageNumber } from '@/lib/usage-format';
import { cn } from '@/lib/utils';
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
  includedGbHours,
  now,
}: {
  daily: readonly DailyUsagePoint[] | undefined;
  month: string;
  usedGbHours: number;
  /** The plan's included GB-hours, so a day can say where the month stood. */
  includedGbHours?: number | null;
  /** Injected for tests; the window edge depends on today's UTC date. */
  now?: number;
}) {
  const usage = dailyUsage(daily, month, now);
  const { days, rolledUp, missing, fromFirst, peak } = usage;
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.gbHours), 0);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const last = days.length - 1;
    setActive((previous) =>
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : previous === null
            ? event.key === 'ArrowRight'
              ? 0
              : last
            : Math.max(0, Math.min(last, previous + (event.key === 'ArrowRight' ? 1 : -1)))
    );
  };
  return (
    <Panel title="Day by day" help="GB-hours per UTC day this month, from daily rollups.">
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No daily rollups for this month yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <figure aria-label="Daily compute usage in GB-hours" className="flex h-44 flex-col gap-2">
            <div
              role="group"
              tabIndex={0}
              aria-label="Days of the month. Hover a bar, or use the arrow keys, to read a day."
              onKeyDown={onKeyDown}
              onBlur={() => setActive(null)}
              onPointerLeave={() => setActive(null)}
              className="relative flex min-h-0 flex-1 items-end gap-1 rounded-sm border-b border-border focus-visible:outline-2 focus-visible:outline-brand"
            >
              {days.map((day, index) => (
                <div
                  key={day.date}
                  className="flex h-full min-w-0 flex-1 cursor-default items-end"
                  role="img"
                  aria-label={`${dayLabel(day.date)}: ${day.reported ? `${formatUsageNumber(day.gbHours)} GB-h` : 'no rollup'}`}
                  onPointerEnter={() => setActive(index)}
                >
                  <span
                    className={cn(
                      'w-full rounded-t-sm bg-[var(--status-good)] transition-opacity duration-150',
                      active !== null && active !== index && 'opacity-35'
                    )}
                    style={{
                      // A small but real day keeps a sliver, so it can be found and hovered.
                      height:
                        day.gbHours > 0 && max > 0
                          ? `max(3px, ${(day.gbHours / max) * 100}%)`
                          : '0',
                    }}
                  />
                </div>
              ))}
              {active !== null && days[active] && (
                <DayReadout
                  usage={usage}
                  index={active}
                  now={now}
                  includedGbHours={includedGbHours}
                />
              )}
            </div>
            <figcaption className="flex justify-between text-xs text-muted-foreground">
              <span>{dayLabel(days[0].date)}</span>
              <span>{dayLabel(days[days.length - 1].date)}</span>
            </figcaption>
          </figure>
          {peak && (
            <p className="text-sm text-muted-foreground">
              Your busiest day was{' '}
              <span className="font-medium text-foreground">{dayLabel(peak.date)}</span>, at{' '}
              {formatUsageNumber(peak.gbHours)} GB-hours
              {peak.topAppSlug && peak.topAppGbHours != null
                ? `, mostly ${peak.topAppSlug} (${formatUsageNumber(peak.topAppGbHours)} GB-hours)`
                : ''}
              .
            </p>
          )}
          {/* How the bars relate to the total above: honest, and on request. */}
          <details className="text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer underline-offset-4 hover:underline">
              About these bars
            </summary>
            <div className="mt-2 flex flex-col gap-1">
              <p className="font-mono">
                Daily rollups: {formatUsageNumber(rolledUp)} GB-h · live total:{' '}
                {formatUsageNumber(usedGbHours)} GB-h
              </p>
              <p>Each bar is one UTC day&apos;s rollup. Rollups can trail the live total.</p>
              {missing > 0 && (
                <p>
                  {`${missing} ${missing === 1 ? 'day has' : 'days have'} no rollup and ${missing === 1 ? 'is' : 'are'} drawn at zero.`}
                </p>
              )}
              {!fromFirst && (
                <p>
                  Daily rollups reach back 30 days, so the 1st is not drawn; the totals above still
                  count it.
                </p>
              )}
            </div>
          </details>
        </div>
      )}
    </Panel>
  );
}

/** The hovered (or arrow-key) day, beside its bar. */
function DayReadout({
  usage,
  index,
  now,
  includedGbHours,
}: {
  usage: DailyUsage;
  index: number;
  now?: number;
  includedGbHours?: number | null;
}) {
  const detail = dayDetail(usage, index, { now, includedGbHours });
  const left = ((index + 0.5) / usage.days.length) * 100;
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-none absolute top-0 z-10 w-56 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-elevation-3',
        left > 55 ? '-translate-x-[calc(100%+10px)]' : 'translate-x-2.5'
      )}
      style={{ left: `${left}%` }}
    >
      <p className="text-muted-foreground">{detail.title}</p>
      {detail.reported ? (
        <>
          <p className="mt-1 text-sm font-medium text-foreground tabular-nums">
            {formatUsageNumber(detail.gbHours)} GB-hours
          </p>
          {detail.top && (
            <p className="mt-1">
              Mostly <span className="font-mono text-foreground">{detail.top.slug}</span>,{' '}
              {detail.top.pct}% of the day
            </p>
          )}
          {detail.versus && <p className="mt-1 text-muted-foreground">{detail.versus}</p>}
        </>
      ) : (
        <p className="mt-1">No rollup for this day yet.</p>
      )}
      <p className="mt-2 border-t border-border pt-2 text-muted-foreground tabular-nums">
        Month so far: {formatUsageNumber(detail.monthSoFar)} GB-h
        {detail.allowancePct != null ? ` · ${detail.allowancePct}% of your allowance` : ''}
      </p>
    </div>
  );
}
