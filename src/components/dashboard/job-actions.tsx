import { useRef, useState } from 'react';
import { Pause, Play, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useDeleteJob, useSetJobStatus, type Job } from '@/lib/api/queries';
import { JobRunDialog, type RunAttempt } from './job-run-dialog';

/**
 * Start a run of a workload, pause or resume it, or delete it.
 *
 * Starting a run launches real, billable tasks, so it goes in two steps: say
 * what to run and how (job-run-dialog.tsx), then a confirm that says what is
 * about to happen. The response is a run in `queued`; every message says
 * queued, because nothing has run yet. Delete asks for the workload's name.
 */
export function JobActions({
  name,
  status,
  job,
  onStarted,
  onDeleted,
}: {
  name: string;
  status: string;
  /** The definition a run inherits, for the run dialog's hints. */
  job?: Pick<
    Job,
    'command' | 'max_parallelism' | 'retry_max' | 'task_timeout_sec' | 'failure_rules'
  >;
  onStarted: (runId: string) => void;
  onDeleted: () => void;
}) {
  const [starting, setStarting] = useState(false);
  // One key per intent, kept here rather than in the dialog: Cancel unmounts the
  // dialog, and a network failure, Cancel, reopen sequence must still replay the
  // first run instead of minting a key and billing a second one. Keyed by name.
  const attempts = useRef(new Map<string, RunAttempt>());
  const confirm = useConfirm();
  const { toast } = useToast();
  const remove = useDeleteJob();
  const setStatus = useSetJobStatus();
  // A paused workload answers 409 to a run; say so up front instead of after.
  const paused = status === 'paused';

  const onToggle = async () => {
    const next = paused ? 'active' : 'paused';
    try {
      await setStatus.mutateAsync({ name, status: next });
    } catch (error) {
      // apid refuses any update while a task is queued or claimed with 409
      // validation_failed, "Job has active runs" (handlers_jobs.go). The other
      // 409, image_run_managed, keeps its own message.
      const activeRuns =
        error instanceof ApiError && error.status === 409 && error.code === 'validation_failed';
      toast({
        kind: 'error',
        title: paused ? 'Could not resume' : 'Could not pause',
        description: activeRuns
          ? `Wait for active runs to finish or cancel them, then ${paused ? 'resume' : 'pause'}.`
          : errorMessage(error),
      });
      return;
    }
    toast(
      paused
        ? {
            kind: 'success',
            title: 'Workload resumed',
            description: `${name} can start runs again, and scheduled runs resume.`,
          }
        : {
            kind: 'success',
            title: 'Workload paused',
            description:
              'No new runs start and scheduled runs stop. Run history and logs are kept.',
          }
    );
  };

  const onDelete = async () => {
    if (
      !(await confirm({
        title: `Delete ${name}?`,
        description:
          'The workload is removed from your list and cannot start new runs. Its run history and logs are no longer available in the console or the API, and the name can be used again. Pausing keeps them. Delete is refused while any run still has tasks in flight, so cancel those runs or wait for them to finish first.',
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
      <Button
        size="sm"
        variant="outline"
        busy={setStatus.isPending}
        onClick={() => void onToggle()}
      >
        {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        {paused ? 'Resume' : 'Pause'}
      </Button>
      <Button size="sm" variant="outline" busy={remove.isPending} onClick={() => void onDelete()}>
        <Trash className="h-4 w-4" />
        Delete
      </Button>
      {starting && (
        <JobRunDialog
          name={name}
          job={job}
          attempts={attempts}
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
