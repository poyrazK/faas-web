import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useReplayFailedJobRun } from '@/lib/api/job-detail';
import { useJobRun } from '@/lib/api/queries';

const plural = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

/**
 * Replay a finished run's unsuccessful tasks as a new linked run.
 *
 * Retry re-queues one task inside the same run and spends its retry budget;
 * replay is for when that budget is gone or a whole run's failures should go
 * again: only failed, timed-out, out-of-memory and cancelled tasks run, each
 * with a fresh budget, and `source_run_id` links the new run back. The count
 * comes from the run (`tasks_failed` already includes timeout and OOM).
 */
export function JobRunReplay({
  name,
  runId,
  jobStatus,
  onReplayed,
  onSelectRun,
}: {
  name: string;
  runId: string;
  jobStatus: string;
  onReplayed: (runId: string) => void;
  onSelectRun?: (runId: string) => void;
}) {
  const { data: run } = useJobRun(name, runId);
  const replay = useReplayFailedJobRun();
  const confirm = useConfirm();
  const { toast } = useToast();
  // One key per source run while its outcome is unknown, like the dashboard's
  // own replay form: a second click after a dropped connection gets the same run.
  const key = useRef<string | null>(null);

  if (!run) return null;
  const replayable = run.tasks_failed + run.tasks_cancelled;
  const finished = Boolean(run.finished_at);
  const paused = jobStatus !== 'active';

  const onReplay = async () => {
    if (
      !(await confirm({
        title: `Replay ${plural(replayable)} of this run?`,
        description: `A new linked run starts with the ${plural(replayable)} that failed, timed out, ran out of memory or were cancelled, each with a fresh retry budget. Tasks that succeeded do not run again. Tasks that run are billable.`,
        confirmLabel: 'Replay failed tasks',
        destructive: true,
      }))
    )
      return;
    key.current ??= crypto.randomUUID();
    try {
      const linked = await replay.mutateAsync({ name, runId, idempotencyKey: key.current });
      key.current = null;
      toast({
        kind: 'success',
        title: 'Replay queued',
        description: `${plural(linked.tasks)} of ${name} queued in a new run. They have not run yet.`,
      });
      onReplayed(linked.id);
    } catch (error) {
      if (error instanceof ApiError) key.current = null;
      const cap = error instanceof ApiError ? error.problem.limit : undefined;
      toast({
        kind: 'error',
        title: 'Could not replay',
        description:
          error instanceof ApiError &&
          error.code === 'job_quota_exceeded' &&
          typeof cap === 'number'
            ? `This run is beyond what your plan allows now (up to ${cap.toLocaleString('en-US')}).`
            : errorMessage(error),
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {run.source_run_id && (
        <span>
          Replays the failed tasks of run{' '}
          {onSelectRun ? (
            <button
              type="button"
              onClick={() => onSelectRun(run.source_run_id!)}
              className="font-mono text-foreground underline-offset-2 hover:underline"
            >
              {run.source_run_id}
            </button>
          ) : (
            <span className="font-mono">{run.source_run_id}</span>
          )}
        </span>
      )}
      {finished && replayable === 0 && <span>Every task succeeded; nothing to replay.</span>}
      {finished && replayable > 0 && (
        <>
          {paused && <span>Resume the workload to replay this run.</span>}
          <Button
            size="xs"
            variant="outline"
            disabled={paused}
            busy={replay.isPending}
            onClick={() => void onReplay()}
          >
            Replay failed tasks
          </Button>
        </>
      )}
    </div>
  );
}
