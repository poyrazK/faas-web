import { useState } from 'react';
import { Calendar, CheckCircle, EditPencil, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { Pill } from '@/components/dashboard/resource-table';
import { StatTile } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { JobScheduleDialog, jobScheduleRows } from './job-schedule';
import { JobEditDialog } from './job-edit-dialog';
import { describeFailureRules } from '@/lib/job-drafts';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useJob, useJobRun, type Job, type JobRun } from '@/lib/api/queries';

/**
 * The two job reads the list cannot carry: what a job is defined to do, and
 * what one run of it actually did.
 *
 * The definition matters because a run's behaviour follows from it — the
 * command, the per-task timeout and the retry ceiling are what turn "some
 * tasks failed" into "each task had 30 seconds and two attempts". Edit
 * changes the image, command, environment, resources and failure rules for
 * runs started afterwards (job-edit-dialog.tsx).
 *
 * A run's counts are broken out as the API reports them, including
 * `dead_letter_count`, which the aggregate status hides: a run can read
 * `succeeded` while individual tasks were dead-lettered.
 *
 * The schedule is edited on its own: adding, changing or removing it is a
 * PATCH that cannot strand a run, since apid refuses it while tasks are in
 * flight. An image run's runner job is managed by its run and refuses
 * updates (409 image_run_managed), so it offers neither.
 *
 * A changed image is pulled and prepared again before tasks start, and a
 * failed pull refuses new runs until the image is fixed (docs/jobs.md), so
 * the image's preparation state sits beside its reference.
 */

function seconds(value: number): string {
  return value < 60 ? `${value}s` : `${Math.floor(value / 60)}m ${value % 60}s`;
}

function duration(started?: string, finished?: string): string {
  if (!started) return '—';
  const from = Date.parse(started);
  const to = finished ? Date.parse(finished) : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to)) return '—';
  return seconds(Math.max(0, Math.round((to - from) / 1000)));
}

export function JobDefinition({ name }: { name: string }) {
  const job = useJob(name);
  const data = job.data;
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [editing, setEditing] = useState(false);

  if (job.isPending)
    return <p className="text-sm text-muted-foreground">Reading the definition…</p>;
  if (job.error instanceof ApiError && job.error.code === 'job_not_found')
    return <p className="text-sm text-muted-foreground">This job no longer exists.</p>;
  if (job.error || !data)
    return <p className="text-sm text-muted-foreground">{errorMessage(job.error)}</p>;

  const env = Object.entries(data.env_overrides ?? {});
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill label={data.kind} />
        <Pill
          label={data.status}
          color={data.status === 'active' ? 'var(--status-good)' : 'var(--status-idle)'}
        />
        <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
          {data.image_ref}
        </span>
        <ImageState job={data} />
        {data.kind !== 'image_run' && (
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => setEditing(true)}>
            <EditPencil className="h-3.5 w-3.5" />
            Edit definition
          </Button>
        )}
      </div>
      {data.image_materialization_status === 'failed' && (
        <p role="alert" className="text-xs text-[color:var(--status-critical)]">
          The image could not be prepared
          {data.image_materialization_error ? `: ${data.image_materialization_error}` : '.'} New
          runs are refused until the image reference is changed.
        </p>
      )}
      {editing && <JobEditDialog job={data} onClose={() => setEditing(false)} />}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Command', data.command.join(' ') || '—'],
          ['RAM per task', `${data.ram_mb} MB`],
          ['Task timeout', seconds(data.task_timeout_sec)],
          ['Max parallelism', String(data.max_parallelism)],
          ['Retries per task', String(data.retry_max)],
          ['Updated', new Date(data.updated_at).toLocaleString()],
        ].map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="label-mono text-muted-foreground">{label}</dt>
            <dd className="truncate font-mono text-xs" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {data.kind !== 'image_run' && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="label-mono text-muted-foreground">Schedule</p>
            <Button size="xs" variant="outline" onClick={() => setEditingSchedule(true)}>
              <Calendar className="h-3.5 w-3.5" />
              {data.schedule ? 'Edit schedule' : 'Add a schedule'}
            </Button>
          </div>
          {data.schedule ? (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {jobScheduleRows(data).map(([label, value]) => (
                <div key={label} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="label-mono text-muted-foreground">{label}</dt>
                  <dd className="break-words font-mono text-xs">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">
              Runs start only when you start them. Add a schedule to run this workload on a cron.
            </p>
          )}
          {editingSchedule && (
            <JobScheduleDialog job={data} onClose={() => setEditingSchedule(false)} />
          )}
        </div>
      )}
      {data.failure_rules && (
        <div>
          <p className="label-mono mb-1.5 text-muted-foreground">Failure rules</p>
          <ul className="flex flex-col gap-1 text-xs">
            {describeFailureRules(data.failure_rules).map((line) => (
              <li key={line} className="font-mono">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {env.length > 0 && (
        <div>
          <p className="label-mono mb-1.5 text-muted-foreground">Environment overrides</p>
          <ul className="flex flex-wrap gap-2">
            {env.map(([key, value]) => (
              <li key={key} className="rounded bg-muted px-2 py-1 font-mono text-xs">
                {key}={value}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const IMAGE_STATE: Record<string, { label: string; color: string }> = {
  pending: { label: 'Preparing image', color: 'var(--status-warning)' },
  verifying_legacy: { label: 'Verifying image', color: 'var(--status-warning)' },
  ready: { label: 'Image ready', color: 'var(--status-good)' },
  failed: { label: 'Image failed', color: 'var(--status-critical)' },
};

function ImageState({ job }: { job: Job }) {
  const state = IMAGE_STATE[job.image_materialization_status];
  if (!state) return null;
  const Icon =
    job.image_materialization_status === 'ready'
      ? CheckCircle
      : job.image_materialization_status === 'failed'
        ? WarningTriangle
        : RefreshDouble;
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{
        borderColor: `color-mix(in oklab, ${state.color} 35%, transparent)`,
        color: state.color,
      }}
    >
      <Icon aria-hidden className="h-3 w-3" />
      {state.label}
    </span>
  );
}

export function JobRunDetail({ name, runId }: { name: string; runId: string }) {
  const run = useJobRun(name, runId);
  const data = run.data;

  if (run.isPending) return <p className="text-sm text-muted-foreground">Reading the run…</p>;
  if (run.error instanceof ApiError && run.error.code === 'job_run_not_found')
    return <p className="text-sm text-muted-foreground">This run is no longer recorded.</p>;
  if (run.error || !data)
    return <p className="text-sm text-muted-foreground">{errorMessage(run.error)}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Pill label={data.aggregate_status} />
        <span className="text-muted-foreground">triggered {data.trigger_kind}</span>
        <span className="text-muted-foreground">
          ran {duration(data.started_at, data.finished_at)}
          {!data.finished_at && data.started_at ? ' so far' : ''}
        </span>
        {data.task_timeout_sec != null && (
          <span className="text-muted-foreground">timeout {seconds(data.task_timeout_sec)}</span>
        )}
        {data.retry_max != null && (
          <span className="text-muted-foreground">up to {data.retry_max} retries</span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Tasks" value={data.tasks} />
        <StatTile label="Succeeded" value={data.tasks_succeeded} />
        <StatTile label="Running" value={data.tasks_running} tone="orange" />
        <StatTile label="Failed" value={data.tasks_failed} tone="red" />
        <StatTile label="Cancelled" value={data.tasks_cancelled} tone="grey" />
        <StatTile
          label="Dead-lettered"
          value={data.dead_letter_count}
          note={data.dead_letter_count > 0 ? 'exhausted every retry' : undefined}
          tone="red"
        />
      </div>
      <RunCaptured run={data} />
    </div>
  );
}

/**
 * What the run captured when it started (docs/jobs.md: "Each new run
 * captures its effective command, image reference and digest, … so those
 * values remain stable in run history"), and the options it ran with. Only
 * what the API returned is listed; an older run without a snapshot shows
 * fewer rows rather than the job's current values.
 */
function RunCaptured({ run }: { run: JobRun }) {
  const when = (value?: string) => (value ? new Date(value).toLocaleString() : 'now');
  const rows: [string, string][] = [];
  rows.push([
    'Start',
    run.execution_class === 'flexible'
      ? `Flexible · ${when(run.eligible_at)} to ${when(run.latest_start_at)}`
      : 'Standard',
  ]);
  rows.push([
    'On a failed task',
    run.failure_policy === 'fail_fast' ? 'Fail fast: cancel unstarted tasks' : 'Continue',
  ]);
  if (run.parallelism) rows.push(['Parallelism', String(run.parallelism)]);
  if (run.command?.length) rows.push(['Command', run.command.join(' ')]);
  if (run.image_ref_snapshot)
    rows.push([
      'Image',
      run.image_resolved_digest_snapshot
        ? `${run.image_ref_snapshot} @ ${run.image_resolved_digest_snapshot.slice(0, 19)}`
        : run.image_ref_snapshot,
    ]);
  if (run.ram_mb_snapshot) rows.push(['RAM per task', `${run.ram_mb_snapshot} MB`]);
  if (run.input_manifest_uri)
    rows.push([
      'Inputs',
      `${run.input_manifest_uri} (${run.input_manifest_sha256 ?? 'no digest'})`,
    ]);
  else if (run.input_manifest_version === 1) rows.push(['Inputs', 'An ordered input list']);
  if (run.source_run_id) rows.push(['Replay of', run.source_run_id]);
  if (run.start_deadline_at) rows.push(['Start deadline', when(run.start_deadline_at)]);
  if (run.failure_rules)
    rows.push(['Failure rules', describeFailureRules(run.failure_rules).join(' · ')]);
  const env = Object.keys(run.env_overrides ?? {});
  if (env.length) rows.push(['Run environment', env.join(', ')]);
  return (
    <dl aria-label="Run settings" className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="label-mono text-muted-foreground">{label}</dt>
          <dd className="break-words font-mono text-xs">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
