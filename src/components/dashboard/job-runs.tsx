import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useCancelJobRun, useJobRuns } from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';

/**
 * The runs of one job, newest first.
 *
 * A run's aggregate status alone does not say how far it got, so the task
 * counts sit next to it: "12 / 24" is the difference between a run that is
 * nearly done and one that has barely started, and both read as "running".
 *
 * Cancel is offered only from `queued` and `running`. Anything else is
 * finished and the API answers 409, so the button would have exactly one
 * possible outcome — a 409 that arrives anyway is explained rather than
 * reported as a failure.
 */

const RUN_COLOR: Record<string, string> = {
  queued: 'var(--status-idle)',
  running: 'var(--status-warning)',
  succeeded: 'var(--status-good)',
  failed: 'var(--status-critical)',
  cancelled: 'var(--status-idle)',
  dead_letter: 'var(--status-critical)',
};

const CANCELLABLE = new Set(['queued', 'running']);

function when(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

export function JobRuns({
  name,
  onSelect,
  selectedRunId,
  renderSelected,
}: {
  name: string;
  onSelect: (runId: string) => void;
  selectedRunId: string | null;
  renderSelected?: (runId: string) => ReactNode;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error } = useJobRuns(name, selectedRunId);
  const cancel = useCancelJobRun();

  const runs = data?.runs ?? [];
  const phase = queryPhase({ error, loading: isPending, isEmpty: runs.length === 0 });

  const onCancel = async (runId: string) => {
    if (
      !(await confirm({
        title: 'Cancel this run?',
        description: 'Tasks still in flight are stopped. Work already done is not rolled back.',
        confirmLabel: 'Cancel run',
        destructive: true,
      }))
    )
      return;

    void cancel
      .mutateAsync({ name, runId })
      .then(() => toast({ kind: 'success', title: 'Run cancelled' }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 409) {
          toast({
            kind: 'info',
            title: 'Already finished',
            description: 'This run reached a terminal state before the cancel landed.',
          });
          return;
        }
        toast({ kind: 'error', title: 'Could not cancel', description: errorMessage(err) });
      });
  };

  if (phase !== 'ready') {
    return (
      <InlinePhase
        phase={phase}
        error={error}
        loadingMessage="Reading runs…"
        emptyMessage="This job has not run yet."
      />
    );
  }

  return (
    <>
      {selectedRunId && !runs.some((run) => run.id === selectedRunId) && (
        <p role="status">Run not found</p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {runs.map((r) => (
          <li
            key={r.id}
            className={
              'flex flex-wrap items-center gap-2 py-3 first:pt-0 last:pb-0' +
              (selectedRunId === r.id ? ' text-foreground' : '')
            }
          >
            <Pill label={r.aggregate_status} color={RUN_COLOR[r.aggregate_status]} />
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              className="font-mono text-xs underline-offset-2 hover:underline"
            >
              {r.id}
            </button>
            <span className="label-mono text-muted-foreground">{r.trigger_kind}</span>
            <span className="[font-variant-numeric:tabular-nums] text-xs">
              {r.tasks_succeeded} / {r.tasks} tasks
            </span>
            {r.tasks_failed > 0 && (
              <span className="text-xs text-[color:var(--status-critical)]">
                {r.tasks_failed} failed
              </span>
            )}
            <span className="text-xs text-muted-foreground">{when(r.created_at)}</span>
            {CANCELLABLE.has(r.aggregate_status) && (
              <span className="ml-auto">
                <Button
                  size="xs"
                  variant="outline"
                  busy={cancel.isPending}
                  onClick={() => void onCancel(r.id)}
                >
                  Cancel
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {selectedRunId &&
        runs.some((run) => run.id === selectedRunId) &&
        renderSelected?.(selectedRunId)}
    </>
  );
}
