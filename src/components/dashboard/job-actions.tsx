import { useRef, useState } from 'react';
import { Play, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useDeleteJob, useStartJobRun } from '@/lib/api/queries';

/** `CreateJobRunRequest.tasks` is 1–5000; the plan may clamp it lower. */
const MAX_TASKS = 5000;

const plural = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

/**
 * Start a run of a workload, or delete it.
 *
 * Starting a run launches real, billable tasks, so it goes in two steps: pick
 * how many tasks, then a confirm that says what is about to happen. The
 * response is a run in `queued`; every message says queued, because nothing has
 * run yet. Delete asks for the workload's name.
 */
export function JobActions({
  name,
  status,
  onStarted,
  onDeleted,
}: {
  name: string;
  status: string;
  onStarted: (runId: string) => void;
  onDeleted: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const confirm = useConfirm();
  const { toast } = useToast();
  const remove = useDeleteJob();
  // A paused workload answers 409 to a run; say so up front instead of after.
  const paused = status === 'paused';

  const onDelete = async () => {
    if (
      !(await confirm({
        title: `Delete ${name}?`,
        description:
          'The workload is removed from your list and cannot start new runs. It is refused while any run still has tasks in flight, so cancel those runs or wait for them to finish first.',
        confirmLabel: 'Delete workload',
        destructive: true,
        typeToConfirm: name,
      }))
    )
      return;
    try {
      await remove.mutateAsync(name);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'job_has_live_instances') {
        toast({
          kind: 'error',
          title: 'Workload still has tasks running',
          description: 'Cancel its runs, or wait for them to finish, then delete it again.',
        });
      } else {
        toast({ kind: 'error', title: 'Could not delete', description: errorMessage(error) });
      }
      return;
    }
    toast({
      kind: 'success',
      title: 'Workload deleted',
      description: `${name} is removed from your workloads.`,
    });
    onDeleted();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {paused && (
        <span className="text-xs text-muted-foreground">A paused workload cannot start runs.</span>
      )}
      <Button size="sm" disabled={paused} onClick={() => setStarting(true)}>
        <Play className="h-4 w-4" />
        Start run
      </Button>
      <Button size="sm" variant="outline" busy={remove.isPending} onClick={() => void onDelete()}>
        <Trash className="h-4 w-4" />
        Delete
      </Button>
      {starting && (
        <JobRunDialog
          name={name}
          onClose={() => setStarting(false)}
          onStarted={(runId) => {
            setStarting(false);
            onStarted(runId);
          }}
        />
      )}
    </div>
  );
}

function JobRunDialog({
  name,
  onClose,
  onStarted,
}: {
  name: string;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const start = useStartJobRun();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [tasks, setTasks] = useState('1');
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // One key per intent: a retry of the same task count replays the first run
  // rather than creating and billing another.
  const attempt = useRef<{ tasks: number; key: string } | null>(null);

  const count = Number(tasks);
  const invalid = !tasks.trim() || !Number.isSafeInteger(count) || count < 1 || count > MAX_TASKS;
  const error = attempted && invalid ? `Enter a whole number from 1 to ${MAX_TASKS}.` : undefined;
  const close = () => {
    if (!start.isPending) onClose();
  };

  const submit = async () => {
    setAttempted(true);
    setFailure(null);
    if (invalid || start.isPending) return;
    if (
      !(await confirm({
        title: `Start ${plural(count)} of ${name}?`,
        description:
          'This starts real tasks on your account now, and tasks that run are billable. The run is queued first. Cancelling later stops tasks still in flight; work already done is not rolled back.',
        confirmLabel: 'Start run',
        destructive: true,
      }))
    )
      return;
    if (attempt.current?.tasks !== count)
      attempt.current = { tasks: count, key: crypto.randomUUID() };
    try {
      const run = await start.mutateAsync({
        name,
        tasks: count,
        idempotencyKey: attempt.current.key,
      });
      toast({
        kind: 'success',
        title: 'Run queued',
        description: `${plural(run.tasks)} of ${name} queued. They have not run yet; follow progress in the run list.`,
      });
      onStarted(run.id);
    } catch (err) {
      setFailure(errorMessage(err));
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={`Start a run of ${name}`}
      description="Each task runs your container once. Parallelism, retries and timeout come from the workload."
      footer={
        <>
          <Button type="button" variant="ghost" disabled={start.isPending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="start-run-form" busy={start.isPending}>
            Continue
          </Button>
        </>
      }
    >
      <form
        id="start-run-form"
        noValidate
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="run-tasks" className="text-xs font-medium">
            Number of tasks
          </label>
          <input
            id="run-tasks"
            name="tasks"
            type="number"
            min="1"
            max={MAX_TASKS}
            step="1"
            autoFocus
            className={`${FIELD} w-full`}
            value={tasks}
            onChange={(e) => setTasks(e.target.value)}
            disabled={start.isPending}
            {...fieldErrorProps(error, 'run-tasks-error')}
          />
          {error && <FieldError id="run-tasks-error">{error}</FieldError>}
          <p className="text-xs text-muted-foreground">
            Plans cap a run at 100 (Hobby), 1,000 (Pro) or 5,000 (Scale) tasks. It runs on standard
            capacity and carries on if a task fails.
          </p>
        </div>
        {failure && (
          <p role="alert" className="text-sm text-[color:var(--status-critical)]">
            {failure}
          </p>
        )}
      </form>
    </Modal>
  );
}
