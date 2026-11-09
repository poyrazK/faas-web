import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, Select, fieldErrorProps } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Timestamp } from '@/components/ui/timestamp';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { cronScheduleError, OverlapField, TimezoneField, type Overlap } from './cron-fields';
import { ScheduleField, useScheduleClock } from './schedule-field';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useUpdateJobSchedule, type SchedulePolicy } from '@/lib/api/jobs';
import type { Job } from '@/lib/api/queries';
import { describeCronSchedule } from '@/lib/cron-schedule';

/**
 * A recurring job's schedule: the cron expression, its IANA zone, and the
 * optional versioned schedule policy (faas SchedulePolicy; docs/jobs.md
 * "--schedule-policy"). Without a policy the scheduler keeps its legacy
 * behaviour and records no skipped or missed occurrences (sched/loop.go:4229),
 * so a policy is opt-in here rather than defaulted.
 */

type MissedRuns = SchedulePolicy['missed_runs'];

/** apid's ceiling on a start deadline (state/work_policies.go:27-28; 30 days). */
const MAX_DEADLINE_SECONDS = 2_592_000;

export interface ScheduleDraft {
  schedule: string;
  timezone: string;
  policy: boolean;
  overlap: Overlap;
  missedRuns: MissedRuns;
  /** Seconds, as typed; blank is no deadline. */
  deadline: string;
}

export const NO_SCHEDULE: ScheduleDraft = {
  schedule: '',
  timezone: 'UTC',
  policy: false,
  overlap: 'skip',
  missedRuns: 'skip',
  deadline: '',
};

export function scheduleDraftFrom(job: Pick<Job, 'schedule' | 'timezone' | 'schedule_policy'>) {
  const policy = job.schedule_policy;
  return {
    schedule: job.schedule ?? '',
    timezone: job.timezone || 'UTC',
    policy: Boolean(policy),
    overlap: policy?.overlap ?? NO_SCHEDULE.overlap,
    missedRuns: policy?.missed_runs ?? NO_SCHEDULE.missedRuns,
    deadline: policy?.start_deadline_seconds ? String(policy.start_deadline_seconds) : '',
  } satisfies ScheduleDraft;
}

export function scheduleDraftErrors(draft: ScheduleDraft, now: number) {
  const errors: { schedule?: string; deadline?: string } = {};
  errors.schedule = cronScheduleError(draft.schedule.trim(), now);
  if (draft.policy && draft.deadline.trim()) {
    const n = Number(draft.deadline);
    if (!Number.isInteger(n) || n < 0 || n > MAX_DEADLINE_SECONDS)
      errors.deadline = 'Enter whole seconds up to 2,592,000 (30 days), or leave blank.';
  }
  return errors;
}

export function schedulePolicyFrom(draft: ScheduleDraft): SchedulePolicy | undefined {
  if (!draft.policy) return undefined;
  const deadline = Number(draft.deadline);
  return {
    version: 1,
    overlap: draft.overlap,
    missed_runs: draft.missedRuns,
    ...(draft.deadline.trim() && deadline > 0 ? { start_deadline_seconds: deadline } : {}),
  };
}

const MISSED: { value: MissedRuns; label: string; hint: string }[] = [
  {
    value: 'skip',
    label: 'Skip them',
    hint: 'Times that passed while the scheduler was down are recorded as missed and do not run.',
  },
  {
    value: 'coalesce_latest',
    label: 'Run the latest one',
    hint: 'Older missed times are recorded as coalesced, and only the newest one runs.',
  },
];

/** The schedule, zone and policy controls, shared by create and edit. */
export function JobScheduleFields({
  value,
  onChange,
  errors,
  policyLocked = false,
}: {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  errors: { schedule?: string; deadline?: string };
  /** A stored policy can be replaced through PATCH but not removed. */
  policyLocked?: boolean;
}) {
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...value, ...patch });
  const missed = MISSED.find((m) => m.value === value.missedRuns) ?? MISSED[0];
  return (
    <div className="space-y-5">
      <ScheduleField
        value={value.schedule}
        onChange={(schedule) => set({ schedule })}
        error={errors.schedule}
        timezone={value.timezone}
      />
      <TimezoneField value={value.timezone} onChange={(timezone) => set({ timezone })} />
      <div className="space-y-3 well rounded-xl bg-muted/40 p-4">
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            name="schedule-policy"
            checked={value.policy}
            disabled={policyLocked}
            onChange={(e) => set({ policy: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Apply a schedule policy</span>
            <span className="block text-muted-foreground">
              {policyLocked
                ? 'This workload has a policy. It can be changed, not removed.'
                : 'Decide what happens on overlap and after downtime, and record every skipped or missed time. Without one, each due time just starts a run.'}
            </span>
          </span>
        </label>
        {value.policy && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <OverlapField
                value={value.overlap}
                onChange={(overlap) => set({ overlap })}
                kind="command"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Missed runs</span>
                <Select
                  name="missed-runs"
                  value={value.missedRuns}
                  onChange={(e) => set({ missedRuns: e.target.value as MissedRuns })}
                >
                  {MISSED.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </label>
              <span className="text-xs text-muted-foreground">{missed.hint}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Start deadline (seconds)</span>
                <input
                  name="start-deadline"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="No deadline"
                  value={value.deadline}
                  onChange={(e) => set({ deadline: e.target.value })}
                  className={`${FIELD} w-full`}
                  {...fieldErrorProps(errors.deadline, 'job-deadline-error')}
                />
              </label>
              {errors.deadline ? (
                <FieldError id="job-deadline-error">{errors.deadline}</FieldError>
              ) : (
                <span className="text-xs text-muted-foreground">
                  How late the first task may start; a later one is recorded as missed.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const OVERLAP_LABEL: Record<Overlap, string> = {
  allow: 'Allow overlap',
  skip: 'Skip while running',
  replace: 'Replace the running one',
};

/** The schedule rows of a job's definition, or nothing for a batch job. */
export function jobScheduleRows(job: Job): [string, ReactNode][] {
  if (!job.schedule) return [];
  const policy = job.schedule_policy;
  const zone = job.timezone || 'UTC';
  return [
    [
      'Schedule',
      `${job.schedule} · ${describeCronSchedule(job.schedule).replace(/\bUTC\b/g, zone)}`,
    ],
    ['Timezone', zone],
    [
      'Last scheduled',
      job.last_scheduled_at ? <Timestamp value={job.last_scheduled_at} /> : 'Not yet',
    ],
    [
      'Schedule policy',
      policy
        ? [
            OVERLAP_LABEL[policy.overlap],
            policy.missed_runs === 'skip' ? 'skip missed times' : 'run the latest missed time',
            policy.start_deadline_seconds
              ? `start within ${policy.start_deadline_seconds}s`
              : 'no start deadline',
          ].join(' · ')
        : 'None — each due time starts a run',
    ],
  ];
}

/**
 * Add, change or remove a job's schedule. Saving a new expression or policy
 * starts a new schedule revision (docs/jobs.md); removing it returns the job
 * to batch-only runs. Runs already started are not touched.
 */
export function JobScheduleDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const update = useUpdateJobSchedule();
  const now = useScheduleClock();
  const [draft, setDraft] = useState(() => scheduleDraftFrom(job));
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const errors = scheduleDraftErrors(draft, now);
  const shown = attempted ? errors : {};
  const close = () => {
    if (!update.isPending) onClose();
  };

  const explain = (error: unknown) =>
    // apid refuses any job update while a task is queued or claimed
    // (handlers_jobs.go:1133-1136, 409 validation_failed "Job has active runs").
    error instanceof ApiError && error.status === 409 && error.code === 'validation_failed'
      ? 'Wait for active runs to finish or cancel them, then change the schedule.'
      : errorMessage(error);

  const save = async () => {
    setAttempted(true);
    setFailure(null);
    if (errors.schedule || errors.deadline || update.isPending) return;
    const policy = schedulePolicyFrom(draft);
    try {
      await update.mutateAsync({
        name: job.name,
        schedule: draft.schedule.trim(),
        timezone: draft.timezone.trim() || 'UTC',
        ...(policy ? { schedule_policy: policy } : {}),
      });
      toast({
        kind: 'success',
        title: job.schedule ? 'Schedule updated' : 'Schedule added',
        description: 'The next run starts at the next matching time.',
      });
      onClose();
    } catch (error) {
      setFailure(explain(error));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Remove the schedule from ${job.name}?`,
      description:
        'No more runs start on their own. Runs already started keep going, and you can still start runs by hand.',
      confirmLabel: 'Remove schedule',
      destructive: true,
    });
    if (!ok) return;
    setFailure(null);
    try {
      await update.mutateAsync({ name: job.name, schedule: '' });
      toast({ kind: 'success', title: 'Schedule removed' });
      onClose();
    } catch (error) {
      setFailure(explain(error));
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={job.schedule ? `Schedule — ${job.name}` : `Add a schedule to ${job.name}`}
      description="Each matching time starts a one-task run with the workload's current definition."
      width="max-w-xl"
      footer={
        <>
          {job.schedule && (
            <Button
              type="button"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => void remove()}
              className="mr-auto"
            >
              Remove schedule
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={update.isPending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="job-schedule-form" busy={update.isPending}>
            Save schedule
          </Button>
        </>
      }
    >
      <form
        id="job-schedule-form"
        noValidate
        className="max-h-[calc(100dvh-17rem)] space-y-5 overflow-y-auto p-1"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={update.isPending}>
          <JobScheduleFields
            value={draft}
            onChange={setDraft}
            errors={shown}
            policyLocked={Boolean(job.schedule_policy)}
          />
        </fieldset>
        {failure && (
          <p role="alert" className="text-sm text-[color:var(--status-critical)]">
            {failure}
          </p>
        )}
      </form>
    </Modal>
  );
}
