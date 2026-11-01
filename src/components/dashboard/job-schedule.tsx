import { useState, type ReactNode } from 'react';
import { Panel } from '@/components/dashboard/primitives';
import { ProblemHelp } from '@/components/dashboard/problem-help';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useUpdateJobSchedule } from '@/lib/api/job-detail';
import { useJob, type Job } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import { describeCronSchedule } from '@/lib/cron-schedule';
import { cronScheduleError, OverlapField, TimezoneField, type Overlap } from './cron-fields';
import { ScheduleField, useScheduleClock } from './schedule-field';

/**
 * A workload's schedule: the cron and its zone, and the schedule policy that
 * decides what a fire does when the last run is still going, how late its first
 * task may start, and what happens to times missed while the scheduler was
 * down (faas pkg/workpolicy, docs/jobs.md). With no policy the scheduler keeps
 * its original behaviour: runs may overlap and there is no start deadline.
 *
 * The fields reuse the scheduled-request editor's, so the two cannot drift.
 * Each recurring fire is a single-task run of the workload.
 */

type SchedulePolicy = components['schemas']['SchedulePolicy'];
type MissedRuns = SchedulePolicy['missed_runs'];

/** apid caps `start_deadline_seconds` at 30 days (api.WorkPolicyMaxStartDeadlineSeconds). */
const MAX_DEADLINE = 2_592_000;

const OVERLAP_LABEL: Record<Overlap, string> = {
  allow: 'Allow overlap',
  skip: 'Skip while running',
  replace: 'Replace the running one',
};
const MISSED_LABEL: Record<MissedRuns, string> = {
  skip: 'Record as skipped',
  coalesce_latest: 'Run the latest once',
};

function duration(value: number): string {
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

interface Draft {
  schedule: string;
  timezone: string;
  overlap: Overlap;
  deadline: string;
  missed: MissedRuns;
}

const draftOf = (job: Job): Draft => ({
  schedule: job.schedule ?? '',
  timezone: job.timezone || 'UTC',
  overlap: job.schedule_policy?.overlap ?? 'allow',
  deadline: String(job.schedule_policy?.start_deadline_seconds ?? 0),
  missed: job.schedule_policy?.missed_runs ?? 'skip',
});

const deadlineValid = (text: string) =>
  /^\d+$/.test(text.trim()) && Number(text) >= 0 && Number(text) <= MAX_DEADLINE;

/** The PATCH body: changed fields only, and the whole policy when any part of it changed. */
function diff(job: Job, draft: Draft) {
  const before = draftOf(job);
  const patch: { schedule?: string; timezone?: string; schedule_policy?: SchedulePolicy } = {};
  if (draft.schedule.trim() !== before.schedule) patch.schedule = draft.schedule.trim();
  // A batch job has no zone yet; adding a schedule sends one so it is explicit.
  if ((draft.timezone.trim() || 'UTC') !== before.timezone || (!job.schedule && patch.schedule))
    patch.timezone = draft.timezone.trim() || 'UTC';
  if (
    draft.overlap !== before.overlap ||
    draft.missed !== before.missed ||
    draft.deadline.trim() !== before.deadline
  ) {
    const deadline = Number(draft.deadline);
    patch.schedule_policy = {
      version: 1,
      overlap: draft.overlap,
      ...(deadline > 0 ? { start_deadline_seconds: deadline } : {}),
      missed_runs: draft.missed,
    };
  }
  return patch;
}

export function JobSchedule({ name }: { name: string }) {
  const job = useJob(name);
  const update = useUpdateJobSchedule();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const data = job.data;
  const managed = data?.kind === 'image_run';
  const scheduled = Boolean(data?.schedule);

  const onRemove = async () => {
    if (
      !(await confirm({
        title: `Remove the schedule of ${name}?`,
        description:
          'No more scheduled runs start, and the workload becomes batch-only. Runs already started carry on, and it can still be started by hand.',
        confirmLabel: 'Remove schedule',
        destructive: true,
      }))
    )
      return;
    try {
      await update.mutateAsync({ name, schedule: '' });
      toast({ kind: 'success', title: 'Schedule removed', description: `${name} is batch-only.` });
    } catch (error) {
      toast({ kind: 'error', title: 'Could not remove the schedule', error });
    }
  };

  return (
    <Panel
      title="Schedule"
      description="When this workload runs on its own. Each scheduled fire starts a one-task run."
      actions={
        data &&
        !managed && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {scheduled ? 'Edit schedule' : 'Add schedule'}
            </Button>
            {scheduled && (
              <Button
                size="sm"
                variant="outline"
                busy={update.isPending && !editing}
                onClick={() => void onRemove()}
              >
                Remove schedule
              </Button>
            )}
          </div>
        )
      }
    >
      {job.isPending ? (
        <p className="text-sm text-muted-foreground">Reading the schedule…</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{errorMessage(job.error)}</p>
      ) : managed ? (
        <p className="text-sm text-muted-foreground">
          This workload is managed by its image run, so its schedule cannot be changed here.
        </p>
      ) : !scheduled ? (
        <p className="text-sm text-muted-foreground">
          No schedule. This workload runs only when started.
        </p>
      ) : (
        <ScheduleSummary job={data} />
      )}
      {editing && data && <JobScheduleDialog job={data} onClose={() => setEditing(false)} />}
    </Panel>
  );
}

function ScheduleSummary({ job }: { job: Job }) {
  const policy = job.schedule_policy;
  const rows: [string, ReactNode][] = [
    [
      'Cron',
      <span key="cron" className="flex flex-col">
        <span className="font-mono">{job.schedule}</span>
        <span className="text-muted-foreground">
          {/* Descriptions name UTC; the cron runs in the job's zone. */}
          {describeCronSchedule(job.schedule ?? '').replace(/\bUTC\b/g, job.timezone || 'UTC')}
        </span>
      </span>,
    ],
    ['Timezone', job.timezone || 'UTC'],
    ['Last scheduled run', <Timestamp key="last" value={job.last_scheduled_at} />],
  ];
  if (policy)
    rows.push(
      ['Overlap', OVERLAP_LABEL[policy.overlap]],
      [
        'Start deadline',
        policy.start_deadline_seconds ? duration(policy.start_deadline_seconds) : 'None',
      ],
      ['Missed runs', MISSED_LABEL[policy.missed_runs]]
    );
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="label-mono text-muted-foreground">{label}</dt>
            <dd className="break-words text-xs">{value}</dd>
          </div>
        ))}
      </dl>
      {!policy && (
        <p className="text-xs text-muted-foreground">
          No schedule policy: runs may overlap, and there is no start deadline.
        </p>
      )}
    </div>
  );
}

function JobScheduleDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const { toast } = useToast();
  const update = useUpdateJobSchedule();
  const [draft, setDraft] = useState(() => draftOf(job));
  const [failure, setFailure] = useState<unknown>(null);
  const validation = useFormValidation<'schedule' | 'start_deadline_seconds'>();
  const now = useScheduleClock();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const scheduleError = cronScheduleError(draft.schedule, now);
  const deadlineError = deadlineValid(draft.deadline)
    ? undefined
    : 'Enter a whole number of seconds from 0 to 2592000 (30 days).';
  const shown = validation.submitAttempted;
  const patch = diff(job, draft);
  const changed = Object.keys(patch).length > 0;
  const close = () => {
    if (!update.isPending) onClose();
  };

  return (
    <Modal
      open
      onClose={close}
      title={job.schedule ? `Edit the schedule of ${job.name}` : `Schedule ${job.name}`}
      description="Changes start a new schedule revision. Runs already started are not affected."
      width="max-w-lg"
      footer={
        <>
          <Button type="button" variant="ghost" disabled={update.isPending} onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="job-schedule-form"
            disabled={!changed}
            busy={update.isPending}
          >
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
          if (update.isPending || !changed) return;
          if (
            !validation.validate(
              { schedule: scheduleError, start_deadline_seconds: deadlineError },
              event.currentTarget
            )
          )
            return;
          setFailure(null);
          void update
            .mutateAsync({ name: job.name, ...patch })
            .then(() => {
              toast({
                kind: 'success',
                title: 'Schedule updated',
                description: 'It applies from the next scheduled time.',
              });
              onClose();
            })
            .catch((error: unknown) => setFailure(error));
        }}
      >
        <fieldset disabled={update.isPending} className="space-y-5">
          <ScheduleField
            value={draft.schedule}
            onChange={(value) => set('schedule', value)}
            error={shown ? scheduleError : undefined}
            timezone={draft.timezone}
          />
          <TimezoneField value={draft.timezone} onChange={(value) => set('timezone', value)} />
          <OverlapField
            value={draft.overlap}
            onChange={(value) => set('overlap', value)}
            kind="command"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="job-start-deadline" className="label-mono text-muted-foreground">
                Start deadline (seconds)
              </label>
              <input
                id="job-start-deadline"
                name="start_deadline_seconds"
                type="number"
                min={0}
                max={MAX_DEADLINE}
                value={draft.deadline}
                onChange={(e) => set('deadline', e.target.value)}
                className={`${FIELD} w-full`}
                {...fieldErrorProps(shown ? deadlineError : undefined, 'job-start-deadline-error')}
              />
              {shown && deadlineError && (
                <FieldError id="job-start-deadline-error">{deadlineError}</FieldError>
              )}
              <p className="text-xs text-muted-foreground">
                How late the first task may start. 0 means no deadline.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="job-missed-runs" className="label-mono text-muted-foreground">
                Missed runs
              </label>
              <select
                id="job-missed-runs"
                name="missed_runs"
                value={draft.missed}
                onChange={(e) => set('missed', e.target.value as MissedRuns)}
                className={`${FIELD} w-full`}
              >
                {(Object.keys(MISSED_LABEL) as MissedRuns[]).map((value) => (
                  <option key={value} value={value}>
                    {MISSED_LABEL[value]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {draft.missed === 'skip'
                  ? 'Times missed while the scheduler was down are recorded and not run.'
                  : 'Times missed while the scheduler was down collapse into one run of the latest.'}
              </p>
            </div>
          </div>
        </fieldset>
        {failure !== null && (
          <div role="alert" className="flex flex-col gap-1">
            <p className="text-sm text-[color:var(--status-critical)]">{errorMessage(failure)}</p>
            {failure instanceof ApiError && <ProblemHelp error={failure} />}
          </div>
        )}
      </form>
    </Modal>
  );
}
