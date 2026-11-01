import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { RETRIABLE_TASK, useRetryJobTask, type JobTask } from '@/lib/api/job-detail';
import { absoluteTime, parseTime } from '@/lib/time';

/**
 * Retry one task of a run: the same input, the same run, the next attempt.
 *
 * apid re-queues only a failed, timed-out, out-of-memory or cancelled task, and
 * only while `attempt <= retry_max`; past that it answers
 * `job_task_max_retries_reached` and the way on is a replay, which starts a
 * linked run with a fresh budget. The retry is idempotent-wrapped, so one key
 * per intent keeps a second click after a dropped connection from queuing the
 * task twice.
 */
export function JobTaskRetry({
  name,
  runId,
  task,
}: {
  name: string;
  runId: string;
  task: JobTask;
}) {
  const retry = useRetryJobTask();
  const confirm = useConfirm();
  const { toast } = useToast();
  const key = useRef<string | null>(null);

  if (!RETRIABLE_TASK.has(task.status)) return null;
  const index = task.task_index;

  const onRetry = async () => {
    if (
      !(await confirm({
        title: `Retry task ${index} of this run?`,
        description: `Task ${index} runs its input again as attempt ${task.attempt + 1}, after the same backoff as an automatic retry. The rest of the run is untouched, and the attempt is billable.`,
        confirmLabel: 'Retry task',
      }))
    )
      return;
    key.current ??= crypto.randomUUID();
    try {
      const result = await retry.mutateAsync({
        name,
        runId,
        taskIndex: index,
        idempotencyKey: key.current,
      });
      key.current = null;
      const at = parseTime(result.next_attempt_at);
      toast({
        kind: 'success',
        title: `Task ${index} queued`,
        description:
          at === undefined
            ? 'It starts again after its backoff.'
            : `Its next attempt may start from ${absoluteTime(at)}.`,
      });
    } catch (error) {
      // apid stores refusals under the key too; only an unknown outcome keeps it.
      if (error instanceof ApiError) key.current = null;
      if (error instanceof ApiError && error.code === 'job_task_max_retries_reached') {
        toast({
          kind: 'error',
          title: 'Retry budget used up',
          description:
            'This task has used every attempt its retry limit allows. Use Replay failed tasks on the run to run its input again with a fresh budget.',
        });
      } else if (error instanceof ApiError && error.code === 'job_task_not_retriable') {
        toast({
          kind: 'info',
          title: 'Task already moved on',
          description: 'It was re-queued or finished before this retry landed.',
        });
      } else {
        toast({ kind: 'error', title: 'Could not retry the task', error });
      }
    }
  };

  return (
    <Button
      size="xs"
      variant="outline"
      busy={retry.isPending}
      aria-label={`Retry task ${index}`}
      onClick={() => void onRetry()}
    >
      Retry
    </Button>
  );
}
