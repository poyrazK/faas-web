import type { ReactNode } from 'react';
import type { LimitTone } from '@/lib/limits';
import { meterTone } from '@/lib/limits';
import { cn } from '@/lib/utils';

export const TONE_COLOR: Record<LimitTone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
};

/**
 * One limit, the same way every time: its name, what happens at the limit in
 * a plain sentence, this period's use against it (only where faas reports
 * use), and one action. Detail sits behind "More".
 */
export function LimitRow({
  name,
  sentence,
  meter,
  tone,
  action,
  note,
  children,
}: {
  name: string;
  sentence: ReactNode;
  meter?: { used: number; limit: number; label: string };
  tone?: LimitTone;
  action?: ReactNode;
  /** A quiet line under the sentence, such as what else counts toward it. */
  note?: ReactNode;
  children?: ReactNode;
}) {
  const shade = tone ?? (meter ? meterTone(meter.used, meter.limit) : undefined);
  const percent = meter
    ? Math.min(100, meter.limit > 0 ? Math.round((meter.used / meter.limit) * 100) : 100)
    : 0;
  return (
    <div
      role="group"
      aria-label={name}
      className="grid gap-3 border-t border-border py-4 first:border-t-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-5"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{sentence}</p>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="min-w-0">
        {meter && (
          <>
            <div
              role="meter"
              aria-label={`${name} used`}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${percent}%`,
                  background: shade ? TONE_COLOR[shade] : undefined,
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">{meter.label}</p>
          </>
        )}
      </div>
      <div className={cn('flex justify-start sm:justify-end')}>{action}</div>
      {children && (
        <details className="text-xs sm:col-span-3">
          <summary className="w-fit cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
            More
          </summary>
          <div className="mt-2 flex flex-col gap-3">{children}</div>
        </details>
      )}
    </div>
  );
}
