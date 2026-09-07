import { useState } from 'react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useJobTaskLog, useJobTasks } from '@/lib/api/queries';

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
 */

const TASK_COLOR: Record<string, string> = {
  queued: 'var(--status-idle)',
  claimed: 'var(--status-warning)',
  succeeded: 'var(--status-good)',
  failed: 'var(--status-critical)',
  timeout: 'var(--status-serious)',
  cancelled: 'var(--status-idle)',
  oom: 'var(--status-critical)',
};

export function JobTasks({ name, runId }: { name: string; runId: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const { data, isPending, error } = useJobTasks(name, runId);
  const logQuery = useJobTaskLog(name, runId, open);

  const tasks = data?.tasks ?? [];
  const phase = queryPhase({ error, loading: isPending, isEmpty: tasks.length === 0 });

  if (phase !== 'ready') {
    return (
      <InlinePhase
        phase={phase}
        error={error}
        loadingMessage="Reading tasks…"
        emptyMessage="No tasks for this run."
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {tasks.map((t) => (
        <li key={t.task_index} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill label={t.status} color={TASK_COLOR[t.status]} />
            <button
              type="button"
              onClick={() => setOpen((cur) => (cur === t.task_index ? null : t.task_index))}
              className="font-mono text-xs underline-offset-2 hover:underline"
            >
              task {t.task_index}
            </button>
            {t.attempt > 1 && (
              <span className="text-xs text-muted-foreground">attempt {t.attempt}</span>
            )}
          </div>

          {open === t.task_index && (
            <div className="mt-1">
              {logQuery.isPending ? (
                <p className="text-xs text-muted-foreground">Reading the log…</p>
              ) : logQuery.error ? (
                <p className="text-xs text-muted-foreground">No log for this task.</p>
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
  );
}
