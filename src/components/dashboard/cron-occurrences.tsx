import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import {
  ACTIVE_OCCURRENCE,
  useCancelCronRun,
  useCronOccurrences,
  type CronOccurrence,
  type CronOccurrenceStatus,
} from '@/lib/api/cron-occurrences';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { formatCronTime, upcomingCronRuns } from '@/lib/cron-schedule';
import { useScheduleClock } from './schedule-field';

/**
 * A cron's occurrences: the times it is about to fire, and the decision the
 * scheduler recorded for each time it reached — ran, skipped because the last
 * run was still going, missed its start deadline, folded into a later time —
 * with a link to the run it produced. Separate from the run history because
 * a skipped or missed time has no run to show.
 */

export interface OccurrenceCron {
  id: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  /** A command cron's runs are app tasks, which can be cancelled. */
  command: boolean;
  /** Enabled but held by the server, e.g. no live deployment. */
  suspended: boolean;
}

const STATUS: Record<CronOccurrenceStatus, { label: string; color?: string }> = {
  pending: { label: 'Pending', color: 'var(--status-warning)' },
  queued: { label: 'Queued', color: 'var(--status-warning)' },
  running: { label: 'Running', color: 'var(--status-warning)' },
  waiting_replacement: { label: 'Waiting to replace', color: 'var(--status-warning)' },
  succeeded: { label: 'Succeeded', color: 'var(--status-good)' },
  failed: { label: 'Failed', color: 'var(--status-critical)' },
  cancelled: { label: 'Cancelled' },
  skipped_overlap: { label: 'Skipped: still running' },
  missed_deadline: { label: 'Missed start deadline', color: 'var(--status-serious)' },
  coalesced: { label: 'Coalesced' },
  uncertain: { label: 'Uncertain', color: 'var(--status-serious)' },
};

/** Only a queued or running app task has anything to stop. */
const CANCELLABLE: ReadonlySet<CronOccurrenceStatus> = new Set(['queued', 'running']);

function Upcoming({ cron }: { cron: OccurrenceCron }) {
  const now = useScheduleClock();
  const utc = cron.timezone === 'UTC';
  const times = useMemo(
    () =>
      cron.enabled && !cron.suspended && utc
        ? (upcomingCronRuns(cron.schedule, new Date(now), 3) ?? [])
        : [],
    [cron.enabled, cron.suspended, utc, cron.schedule, now]
  );
  const note = !cron.enabled
    ? 'Paused, so nothing is scheduled. Resuming starts the schedule from that moment.'
    : cron.suspended
      ? 'Suspended until the next successful deploy of this app.'
      : !utc
        ? `Upcoming times are previewed for UTC schedules. This one runs in ${cron.timezone}.`
        : times.length === 0
          ? 'No upcoming time within five years.'
          : null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="label-mono text-muted-foreground">Upcoming</h3>
      {note ? (
        <p className="text-sm text-muted-foreground">{note}</p>
      ) : (
        <ul aria-label="Upcoming fire times" className="flex flex-col gap-1">
          {times.map((at) => (
            <li key={at.toISOString()} className="text-sm">
              <time dateTime={at.toISOString()}>{formatCronTime(at)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function seconds(from?: string, to?: string): string | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(1)}s` : null;
}

function OccurrenceRow({
  occurrence: o,
  cron,
  onOpenRun,
}: {
  occurrence: CronOccurrence;
  cron: OccurrenceCron;
  onOpenRun: (runId: string) => void;
}) {
  const status = STATUS[o.status] ?? { label: o.status };
  const runId = o.invocation_id ?? o.app_task_id;
  const took = seconds(o.started_at, o.finished_at);
  const scheduled = new Date(o.scheduled_for);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
      <time dateTime={o.scheduled_for} className="font-mono text-xs">
        {Number.isNaN(scheduled.getTime()) ? o.scheduled_for : formatCronTime(scheduled)}
      </time>
      <Pill label={status.label} color={status.color} />
      {took && (
        <span className="font-mono text-xs [font-variant-numeric:tabular-nums]">{took}</span>
      )}
      {o.outcome_code && (
        <span className="font-mono text-xs text-muted-foreground">{o.outcome_code}</span>
      )}
      {o.reason && <span className="text-xs text-muted-foreground">{o.reason}</span>}
      <span className="ml-auto flex items-center gap-2">
        {runId && (
          <button
            type="button"
            onClick={() => onOpenRun(runId)}
            aria-label={`View run ${runId}`}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            View run
          </button>
        )}
        {cron.command && o.app_task_id && CANCELLABLE.has(o.status) && (
          <CancelCronRunButton cronId={cron.id} runId={o.app_task_id} />
        )}
      </span>
    </li>
  );
}

export function CronOccurrences({
  cron,
  onOpenRun,
}: {
  cron: OccurrenceCron;
  onOpenRun: (runId: string) => void;
}) {
  const q = useCronOccurrences(cron.id);
  const occurrences = q.data?.pages.flatMap((page) => page.occurrences) ?? [];
  const phase = queryPhase({
    error: q.error,
    loading: q.isPending,
    isEmpty: occurrences.length === 0,
  });
  const active = occurrences.some((o) => ACTIVE_OCCURRENCE.has(o.status));
  return (
    <div className="flex flex-col gap-5">
      <Upcoming cron={cron} />
      <section className="flex flex-col gap-2">
        <h3 className="label-mono text-muted-foreground">Recorded</h3>
        <p className="text-xs text-muted-foreground">
          The scheduler’s decision for each time this cron reached, newest first. Settled decisions
          are kept for 90 days{active ? '; this list refreshes while one is in progress' : ''}.
          Manual runs are not listed here.
        </p>
        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={q.error}
            loadingMessage="Loading fire times…"
            emptyMessage="No fire times recorded yet."
            onRetry={() => void q.refetch()}
          />
        ) : (
          <>
            <ul aria-label="Recorded fire times" className="flex flex-col divide-y divide-border">
              {occurrences.map((o) => (
                <OccurrenceRow key={o.id} occurrence={o} cron={cron} onOpenRun={onOpenRun} />
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
      </section>
    </div>
  );
}

/**
 * Cancel one command-cron run. The API answers 202 with the task: `cancelled`
 * when it was still queued, or still active with `cancel_requested_at` while
 * its worker stops it.
 */
export function CancelCronRunButton({ cronId, runId }: { cronId: string; runId: string }) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const cancel = useCancelCronRun();
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      busy={cancel.isPending}
      onClick={async () => {
        if (
          !(await confirm({
            title: 'Cancel this run?',
            description:
              'A queued run is cancelled at once. A running command is stopped by its worker, and anything it already did stays done. The schedule is not affected.',
            confirmLabel: 'Cancel run',
            destructive: true,
          }))
        )
          return;
        try {
          const task = await cancel.mutateAsync({ cronId, runId });
          toast(
            task.status === 'cancelled'
              ? { kind: 'success', title: 'Run cancelled' }
              : {
                  kind: 'success',
                  title: 'Cancellation requested',
                  description: 'The worker is stopping the run.',
                }
          );
        } catch (err) {
          const code = err instanceof ApiError ? err.code : undefined;
          toast(
            code === 'not_implemented'
              ? {
                  kind: 'error',
                  title: 'Command runs are off on this host',
                  description: 'Command crons run as app tasks, which are not enabled here.',
                }
              : code === 'not_found'
                ? {
                    kind: 'error',
                    title: 'Run not found',
                    description: 'It no longer exists, or it is not a run of this cron.',
                  }
                : { kind: 'error', title: 'Could not cancel', description: errorMessage(err) }
          );
        }
      }}
    >
      Cancel run
    </Button>
  );
}
