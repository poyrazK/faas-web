import { useRef, useState } from 'react';
import { Download } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError } from '@/lib/api/errors';
import {
  isManagedArtifact,
  useDownloadJobArtifact,
  useRetryJobTask,
  type JobArtifact,
} from '@/lib/api/jobs';
import { useJobTaskLog, useJobTasks, type JobTask } from '@/lib/api/queries';

/**
 * The tasks of one run, and the tail of a task's log.
 *
 * `timeout` and `oom` are their own statuses rather than kinds of "failed",
 * because they are the two a customer most needs to tell apart: one wants a
 * longer task_timeout_sec, the other more ram_mb.
 *
 * The log response carries `truncated` and `max_bytes`, so a cut log says it
 * was cut. Presenting a truncated tail as the whole thing is how someone
 * concludes their job stopped logging.
 *
 * A failed, timed-out, OOM or cancelled task can be retried while its retry
 * budget lasts; apid queues it with the automatic retries' backoff and
 * reopens a dead-lettered run (handlers_jobs.go:1529). Past the budget it
 * answers `job_task_max_retries_reached`, and the run's Replay failed is the
 * way on.
 *
 * A successful task may publish an output manifest. Gregale keeps the
 * references, not the bytes; an `obj://` artifact can be verified against its
 * size and SHA-256 and downloaded through a five-minute signed URL
 * (job_managed_objects.go:169), while `s3://` and `gs://` stay the
 * customer's to fetch.
 */

const RETRIABLE = new Set(['failed', 'timeout', 'oom', 'cancelled']);

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

const TASK_COLOR: Record<string, string> = {
  queued: 'var(--status-idle)',
  claimed: 'var(--status-warning)',
  succeeded: 'var(--status-good)',
  failed: 'var(--status-critical)',
  timeout: 'var(--status-serious)',
  cancelled: 'var(--status-idle)',
  oom: 'var(--status-critical)',
};

export function JobTasks({
  name,
  runId,
  selectedTask,
  onSelect,
}: {
  name: string;
  runId: string;
  selectedTask?: number | null;
  onSelect?: (task: number | null) => void;
}) {
  const [localOpen, setLocalOpen] = useState<number | null>(null);
  const requested = selectedTask === undefined ? localOpen : selectedTask;
  const { data, isPending, error, refetch } = useJobTasks(name, runId, requested);
  const open = data?.tasks.some((task) => task.task_index === requested) ? requested : null;
  const setOpen = onSelect ?? setLocalOpen;
  const logQuery = useJobTaskLog(name, runId, open);
  const { toast } = useToast();
  const confirm = useConfirm();
  const retry = useRetryJobTask();
  // One key per task and intent: a network failure followed by a second
  // click replays the first answer instead of spending another attempt.
  const retryKeys = useRef(new Map<number, string>());

  const onRetry = async (task: JobTask) => {
    if (
      !(await confirm({
        title: `Retry task ${task.task_index}?`,
        description:
          'It is queued for another attempt after the same backoff as an automatic retry, and that attempt is billable. It counts against the task’s retry budget.',
        confirmLabel: 'Retry task',
      }))
    )
      return;
    let key = retryKeys.current.get(task.task_index);
    if (!key) {
      key = crypto.randomUUID();
      retryKeys.current.set(task.task_index, key);
    }
    try {
      const result = await retry.mutateAsync({
        name,
        runId,
        index: task.task_index,
        idempotencyKey: key,
      });
      retryKeys.current.delete(task.task_index);
      toast({
        kind: 'success',
        title: `Task ${task.task_index} queued for attempt ${result.task.attempt}`,
        description: `It starts after ${new Date(result.next_attempt_at).toLocaleTimeString()}.`,
      });
    } catch (err) {
      // An answer is final and stored under the key; only a lost one is retried with it.
      if (err instanceof ApiError) retryKeys.current.delete(task.task_index);
      const code = err instanceof ApiError ? err.code : '';
      toast({
        kind: 'error',
        title: 'Could not retry',
        description:
          code === 'job_task_max_retries_reached'
            ? 'Its retry budget is spent. Replay the run’s failed inputs to run it again with a fresh budget.'
            : code === 'job_task_not_retriable'
              ? 'Only a failed, timed-out, OOM or cancelled task can be retried, and this one has moved on.'
              : undefined,
        error: err,
      });
    }
  };

  const tasks = data?.tasks ?? [];
  const phase = queryPhase({ error, loading: isPending, isEmpty: tasks.length === 0 });

  if (phase !== 'ready') {
    return (
      <InlinePhase
        phase={phase}
        error={error}
        loadingMessage="Loading tasks…"
        onRetry={() => void refetch()}
        emptyMessage="No tasks for this run."
      />
    );
  }

  return (
    <>
      {requested !== null && open === null && <p role="status">Task not found</p>}
      <ul className="flex flex-col divide-y divide-border">
        {tasks.map((t) => (
          <li key={t.task_index} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Pill label={t.status} color={TASK_COLOR[t.status]} />
              <button
                type="button"
                onClick={() => setOpen(open === t.task_index ? null : t.task_index)}
                className="font-mono text-xs underline-offset-2 hover:underline"
              >
                task {t.task_index}
              </button>
              {t.attempt > 1 && (
                <span className="text-xs text-muted-foreground">attempt {t.attempt}</span>
              )}
              {t.source_task_index != null && (
                <span className="text-xs text-muted-foreground">
                  from task {t.source_task_index}
                </span>
              )}
              {t.input_id && (
                <span className="truncate font-mono text-xs text-muted-foreground">
                  input {t.input_id}
                </span>
              )}
              {RETRIABLE.has(t.status) && (
                <span className="ml-auto">
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`Retry task ${t.task_index}`}
                    busy={retry.isPending && retry.variables?.index === t.task_index}
                    disabled={retry.isPending}
                    onClick={() => void onRetry(t)}
                  >
                    Retry
                  </Button>
                </span>
              )}
            </div>
            {t.error_message && t.status !== 'succeeded' && (
              <p className="break-words font-mono text-[11px] text-muted-foreground">
                {t.error_class ? `${t.error_class}: ` : ''}
                {t.error_message}
                {t.exit_code != null ? ` (exit ${t.exit_code})` : ''}
              </p>
            )}
            {(t.output_manifest?.artifacts?.length ?? 0) > 0 && (
              <TaskArtifacts
                name={name}
                runId={runId}
                index={t.task_index}
                artifacts={t.output_manifest!.artifacts!}
              />
            )}

            {open === t.task_index && (
              <div className="mt-1">
                {logQuery.isPending || logQuery.error ? (
                  <InlinePhase
                    phase={queryPhase({ loading: logQuery.isPending, error: logQuery.error })}
                    error={logQuery.error}
                    loadingMessage="Loading log…"
                    onRetry={() => void logQuery.refetch()}
                  />
                ) : (
                  <>
                    {logQuery.data?.truncated && (
                      <p className="mb-1 text-xs text-[color:var(--status-warning)]">
                        Log truncated at {logQuery.data.max_bytes} bytes — this is the tail, not the
                        whole run.
                      </p>
                    )}
                    <pre className="max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                      {logQuery.data?.log_content}
                    </pre>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * A successful task's output manifest. Download verifies an `obj://` object
 * against the manifest first, so a changed object is refused (422) rather
 * than served; the checksum is shown so the downloaded bytes can be checked
 * too, since the object can change after verification.
 */
function TaskArtifacts({
  name,
  runId,
  index,
  artifacts,
}: {
  name: string;
  runId: string;
  index: number;
  artifacts: JobArtifact[];
}) {
  const { toast } = useToast();
  const download = useDownloadJobArtifact();

  const onDownload = async (artifact: JobArtifact) => {
    try {
      const verified = await download.mutateAsync({
        name,
        runId,
        index,
        artifact: artifact.name,
      });
      const link = document.createElement('a');
      link.href = verified.download.url;
      link.rel = 'noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.click();
      toast({
        kind: 'success',
        title: `${artifact.name} verified`,
        description: `${bytes(verified.size_bytes)} matching ${verified.sha256}. The link lasts five minutes.`,
      });
    } catch (err) {
      toast({ kind: 'error', title: `Could not download ${artifact.name}`, error: err });
    }
  };

  return (
    <div className="mt-1 rounded-md border border-border">
      <p className="label-mono border-b border-border px-3 py-1.5 text-muted-foreground">
        Artifacts
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {artifacts.map((artifact) => (
          <li key={artifact.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="font-mono text-xs">{artifact.name}</span>
            <span className="text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
              {bytes(artifact.size_bytes)}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <span className="truncate font-mono" title={artifact.sha256}>
                {artifact.sha256.replace(/^sha256:/, '').slice(0, 12)}
              </span>
              <CopyIconButton text={artifact.sha256} label={`checksum of ${artifact.name}`} />
            </span>
            {isManagedArtifact(artifact.uri) ? (
              <span className="ml-auto">
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={`Download ${artifact.name}`}
                  busy={download.isPending && download.variables?.artifact === artifact.name}
                  disabled={download.isPending}
                  onClick={() => void onDownload(artifact)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
              </span>
            ) : (
              <span className="flex w-full min-w-0 items-center gap-1 text-xs text-muted-foreground sm:ml-auto sm:w-auto">
                <span className="truncate font-mono" title={artifact.uri}>
                  {artifact.uri}
                </span>
                <CopyIconButton text={artifact.uri} label={`location of ${artifact.name}`} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {artifacts.some((artifact) => !isManagedArtifact(artifact.uri)) && (
        <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          s3:// and gs:// artifacts stay in your own storage; fetch them with your own credentials.
        </p>
      )}
    </div>
  );
}
