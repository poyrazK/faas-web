import { Pill } from '@/components/dashboard/resource-table';
import { StatTile } from '@/components/dashboard/primitives';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useJob, useJobRun } from '@/lib/api/queries';

/**
 * The two job reads the list cannot carry: what a job is defined to do, and
 * what one run of it actually did.
 *
 * The definition matters because a run's behaviour follows from it — the
 * command, the per-task timeout and the retry ceiling are what turn "some
 * tasks failed" into "each task had 30 seconds and two attempts". Editing
 * stays in the CLI; a job is configuration, not a form.
 *
 * A run's counts are broken out as the API reports them, including
 * `dead_letter_count`, which the aggregate status hides: a run can read
 * `succeeded` while individual tasks were dead-lettered.
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
        <span className="font-mono text-xs text-muted-foreground">{data.image_ref}</span>
      </div>
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
    </div>
  );
}
