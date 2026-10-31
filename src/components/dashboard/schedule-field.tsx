import { useEffect, useMemo, useState, type Ref } from 'react';
import { FIELD, FieldError, fieldErrorProps, Select } from '@/components/ui/field';
import {
  describeCronSchedule,
  formatCronTime,
  isCronSchedule,
  SCHEDULE_PRESETS,
  upcomingCronRuns,
} from '@/lib/cron-schedule';

export function useScheduleClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function ScheduleField({
  value,
  onChange,
  inputRef,
  error,
  timezone = 'UTC',
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  error?: string;
  /**
   * The zone the expression is evaluated in. Presets are plain cron strings,
   * so they apply in any zone; next-run previews are computed only for UTC,
   * because local-time previews would have to guess DST behaviour.
   */
  timezone?: string;
}) {
  const now = useScheduleClock();
  const zone = timezone.trim() || 'UTC';
  const utc = zone === 'UTC';
  const inZone = (text: string) => (utc ? text : text.replace(/\bUTC\b/g, zone));
  const runs = useMemo(
    () => (utc ? upcomingCronRuns(value, new Date(now)) : undefined),
    [utc, value, now]
  );
  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Schedule preset</span>
        <Select
          className="w-full"
          value={SCHEDULE_PRESETS.some((p) => p.value === value) ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled>
            Custom cron expression
          </option>
          {SCHEDULE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {inZone(preset.label)}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Schedule</span>
        <input
          ref={inputRef}
          name="schedule"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          {...fieldErrorProps(error, 'cron-schedule-error')}
          placeholder="*/15 * * * *"
          spellCheck={false}
          className={`${FIELD} w-full font-mono`}
        />
      </label>
      {error && <FieldError id="cron-schedule-error">{error}</FieldError>}
      <p className="text-xs text-muted-foreground">
        Schedules use {zone}. Five fields: minute, hour, day of month, month, day of week.
      </p>
      {!utc && isCronSchedule(value) && (
        <div className="rounded-lg border border-border p-3" aria-label="Schedule summary">
          <p className="text-sm font-medium">{inZone(describeCronSchedule(value))}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Next-run previews are available for UTC schedules. Validate to get the next start in{' '}
            {zone}.
          </p>
        </div>
      )}
      {runs && runs.length > 0 && (
        <div
          className="rounded-lg border border-brand/20 bg-brand/5 p-3"
          aria-label="Upcoming scheduled runs"
        >
          <p className="text-sm font-medium">{describeCronSchedule(value)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Next scheduled times</p>
          <ol className="mt-1 space-y-1 text-xs">
            {runs.map((run) => (
              <li key={run.toISOString()}>
                <time dateTime={run.toISOString()}>{formatCronTime(run)}</time>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Preview of the schedule; actual execution may start later.
          </p>
        </div>
      )}
      {runs?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          This expression has no upcoming runs within five years. Choose another schedule.
        </p>
      )}
    </div>
  );
}
