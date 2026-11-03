import { Button } from '@/components/ui/button';
import { Timestamp } from '@/components/ui/timestamp';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { ACTIVE_JOB_OCCURRENCE, useJobOccurrences, type JobOccurrence } from '@/lib/api/jobs';
import type { Job } from '@/lib/api/queries';
import { formatCronTime } from '@/lib/cron-schedule';
import { JobStatusBadge } from './job-status';

/**
 * A recurring job's occurrences: the scheduler's decision for each nominal
 * time it reached, with the run it started (`GET /v1/jobs/{name}/occurrences`;
 * handlers_schedule_occurrences.go:53-80). Separate from the run list because
 * a skipped, missed or coalesced time has no run to show.
 *
 * Without a schedule policy the scheduler records only the times it started
 * (sched/loop.go:4228-4360), so the list says that rather than letting an
 * empty "skipped" history read as "nothing was ever skipped".
 */

const DECISION: Record<string, string> = {
  retry: 'retried',
  fail_partition: 'partition failed',
  complete: 'completed',
  hold: 'held for reconciliation',
};

function OccurrenceRow({
  occurrence: o,
  onOpenRun,
}: {
  occurrence: JobOccurrence;
  onOpenRun: (runId: string) => void;
}) {
  const scheduled = new Date(o.scheduled_for);
  return (
    <li className="flex flex-col gap-1 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <time dateTime={o.scheduled_for} className="font-mono text-xs">
          {Number.isNaN(scheduled.getTime()) ? o.scheduled_for : formatCronTime(scheduled)}
        </time>
        <JobStatusBadge status={o.status} />
        <span className="text-xs text-muted-foreground">revision {o.schedule_revision}</span>
        {o.start_deadline_at && (
          <span className="text-xs text-muted-foreground">
            start by <Timestamp value={o.start_deadline_at} mode="absolute" />
          </span>
        )}
        {o.job_run_id && (
          <button
            type="button"
            onClick={() => onOpenRun(o.job_run_id!)}
            aria-label={`View run ${o.job_run_id}`}
            className="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            View run
          </button>
        )}
      </div>
      {(o.reason || o.outcome_code || o.work_decision) && (
        <p className="text-xs text-muted-foreground">
          {o.reason && <>{o.reason}. </>}
          {o.outcome_code && (
            <>
              Reported outcome <span className="font-mono">{o.outcome_code}</span>.{' '}
            </>
          )}
          {o.work_decision && (
            <>
              Last decision: {DECISION[o.work_decision.action] ?? o.work_decision.action}
              {o.work_decision.reason ? ` (${o.work_decision.reason.replaceAll('_', ' ')})` : ''}.
            </>
          )}
        </p>
      )}
    </li>
  );
}

export function JobOccurrences({
  job,
  onOpenRun,
}: {
  job: Pick<Job, 'name' | 'schedule_policy'>;
  onOpenRun: (runId: string) => void;
}) {
  const q = useJobOccurrences(job.name);
  const occurrences = q.data?.pages.flatMap((page) => page.occurrences) ?? [];
  const phase = queryPhase({
    error: q.error,
    loading: q.isPending,
    isEmpty: occurrences.length === 0,
  });
  const active = occurrences.some((o) => ACTIVE_JOB_OCCURRENCE.has(o.status));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        The scheduler’s decision for each time this workload’s schedule reached, newest first
        {active ? '; this list refreshes while one is in progress' : ''}. Runs you start yourself
        are not listed.{' '}
        {job.schedule_policy
          ? 'Skipped, missed and coalesced times are recorded under its schedule policy.'
          : 'It has no schedule policy, so only the times that started a run are recorded.'}
      </p>
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Loading occurrences…"
          emptyMessage="No scheduled time has been reached yet."
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          <ul aria-label="Schedule occurrences" className="flex flex-col divide-y divide-border">
            {occurrences.map((o) => (
              <OccurrenceRow key={o.id} occurrence={o} onOpenRun={onOpenRun} />
            ))}
          </ul>
          {q.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="self-start"
              busy={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              Load older
            </Button>
          )}
        </>
      )}
    </div>
  );
}
