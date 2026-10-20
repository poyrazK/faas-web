import { useId } from 'react';
import { FIELD } from '@/components/ui/field';
import { isCronSchedule, upcomingCronRuns } from '@/lib/cron-schedule';
import { TIME_ZONES } from '@/lib/timezones';

/**
 * Fields the create and edit dialogs for a scheduled request share, so the two
 * cannot drift on wording or validation.
 */

/** Why a schedule cannot be saved, or `undefined` when it can. */
export function cronScheduleError(schedule: string, now: number): string | undefined {
  if (!isCronSchedule(schedule)) return 'Enter a five-field cron schedule.';
  if (upcomingCronRuns(schedule, new Date(now), 1)?.length === 0)
    return 'Choose a schedule with an upcoming run within five years.';
  return undefined;
}

/** IANA zone, with the runtime's list as suggestions; free text still works. */
export function TimezoneField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Timezone</span>
        <input
          name="timezone"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          list={TIME_ZONES.length ? listId : undefined}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hintId}
          className={`${FIELD} w-full`}
        />
      </label>
      {TIME_ZONES.length > 0 && (
        <datalist id={listId}>
          {TIME_ZONES.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      )}
      <p id={hintId} className="text-xs text-muted-foreground">
        IANA name, such as Europe/Istanbul. The schedule runs in this zone; leave UTC if unsure.
      </p>
    </div>
  );
}

/** `skip_if_running`: drop a scheduled fire while the previous one is still active. */
export function SkipIfRunningField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={hintId}
        />
        Skip a run if the previous one is still running
      </label>
      <p id={hintId} className="text-xs text-muted-foreground">
        A skipped run is not made up later. Leave this off to let runs overlap.
      </p>
    </div>
  );
}
