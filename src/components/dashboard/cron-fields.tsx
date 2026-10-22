import { useId } from 'react';
import { FIELD } from '@/components/ui/field';
import type { components } from '@/lib/api/schema';
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

type SchedulePolicy = components['schemas']['SchedulePolicy'];
export type Overlap = SchedulePolicy['overlap'];

/**
 * The overlap behaviour the backend applies. `schedule_policy` wins when the
 * cron has one; `skip_if_running` only matters for a cron that has no policy
 * (pkg/state/work_policies.go `effectiveCronSchedulePolicy`).
 */
export function effectiveOverlap(cron: {
  skip_if_running?: boolean;
  schedule_policy?: SchedulePolicy | null;
}): Overlap {
  if (cron.schedule_policy) return cron.schedule_policy.overlap;
  return cron.skip_if_running ? 'skip' : 'allow';
}

/**
 * The full policy to send for a new overlap choice. PATCH replaces the whole
 * object, so `missed_runs` and the start deadline are carried over from the
 * cron; with no policy the backend's own defaults apply (`missed_runs: skip`,
 * no deadline).
 */
export function overlapPolicy(
  cron: { schedule_policy?: SchedulePolicy | null },
  overlap: Overlap
): SchedulePolicy {
  const current = cron.schedule_policy;
  return {
    version: 1,
    overlap,
    missed_runs: current?.missed_runs ?? 'skip',
    ...(current?.start_deadline_seconds
      ? { start_deadline_seconds: current.start_deadline_seconds }
      : {}),
  };
}

const OVERLAP_OPTIONS: { value: Overlap; label: string }[] = [
  { value: 'allow', label: 'Allow overlap' },
  { value: 'skip', label: 'Skip while running' },
  { value: 'replace', label: 'Replace the running one' },
];

/** What a scheduled fire does while the previous one is still active. */
export function OverlapField({
  value,
  onChange,
}: {
  value: Overlap;
  onChange: (value: Overlap) => void;
}) {
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Overlap</span>
        <select
          name="overlap"
          value={value}
          onChange={(event) => onChange(event.target.value as Overlap)}
          aria-describedby={hintId}
          className={`${FIELD} w-full`}
        >
          {OVERLAP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p id={hintId} className="text-xs text-muted-foreground">
        {value === 'allow' && 'Runs may overlap. Nothing is skipped.'}
        {value === 'skip' &&
          'A fire is recorded as skipped while the previous run is still active.'}
        {value === 'replace' &&
          'The new run takes over from the running one. A request already delivered to your app is waited for, not cancelled.'}
      </p>
    </div>
  );
}
