import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Timestamp } from '@/components/ui/timestamp';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { SegmentedControl } from '@/components/dashboard/tabs';
import { useJobTaskAttempts, type JobTaskAttempt } from '@/lib/api/jobs';
import { MAX_LINES, useLogStream } from '@/lib/api/logs';
import type { JobTask } from '@/lib/api/queries';
import { JobStatusBadge } from './job-status';

/**
 * What one task wrote: its live output while it runs, its stored tail once
 * it has run, and the outcome of every attempt it has finished.
 *
 * Live output is the compute gateway's SSE stream (ADR-1163;
 * gatewayd-internal/job_task_logs.go). It waits while the task is queued,
 * follows each retry in turn, and ends with a reason. `stored_output` means
 * the task's last VM was gone before its output could be relayed, so the
 * stored tail is the place to read it; a `gap` means the VM had already
 * dropped lines. The stream promises neither replay nor completeness beyond
 * that, and this says so rather than presenting a partial stream as whole.
 *
 * Attempts are immutable terminal records (handlers_jobs.go:625-686), each
 * with its own log tail, exit, outcome code and classifier decision. They
 * answer "why did attempt 2 retry and attempt 3 stop" without the task row,
 * which only shows the latest.
 */

const IN_FLIGHT = new Set(['queued', 'claimed']);

interface StoredLog {
  data?: { log_content: string; truncated: boolean; max_bytes: number };
  isPending: boolean;
  error: unknown;
  refetch: () => unknown;
}

export function TaskOutput({
  name,
  runId,
  task,
  stored,
  onEnded,
}: {
  name: string;
  runId: string;
  task: JobTask;
  stored: StoredLog;
  /** The live stream ended: the task has moved on, so its row and tail are stale. */
  onEnded: () => void;
}) {
  const inFlight = IN_FLIGHT.has(task.status);
  const [mode, setMode] = useState<'live' | 'stored'>(inFlight ? 'live' : 'stored');
  const showing = inFlight || mode === 'stored' ? mode : 'stored';
  return (
    <div className="mt-1 flex flex-col gap-3">
      {inFlight && (
        <SegmentedControl
          label={`Output of task ${task.task_index}`}
          value={mode}
          onChange={setMode}
          options={[
            { key: 'live', label: 'Live' },
            { key: 'stored', label: 'Stored tail' },
          ]}
        />
      )}
      {showing === 'live' ? (
        <LiveTaskOutput
          name={name}
          runId={runId}
          index={task.task_index}
          queued={task.status === 'queued'}
          onEnded={onEnded}
          onReadStored={() => setMode('stored')}
        />
      ) : (
        <StoredTaskOutput log={stored} />
      )}
      <TaskAttempts name={name} runId={runId} index={task.task_index} />
    </div>
  );
}

function StoredTaskOutput({ log }: { log: StoredLog }) {
  if (log.isPending || log.error)
    return (
      <InlinePhase
        phase={queryPhase({ loading: log.isPending, error: log.error })}
        error={log.error}
        loadingMessage="Loading log…"
        onRetry={() => void log.refetch()}
      />
    );
  return (
    <div>
      {log.data?.truncated && (
        <p className="mb-1 text-xs text-[color:var(--status-warning)]">
          Log truncated at {log.data.max_bytes} bytes — this is the tail, not the whole run.
        </p>
      )}
      <pre className="max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
        {log.data?.log_content}
      </pre>
    </div>
  );
}

const END: Record<string, string> = {
  task_finished: 'The task finished, and every line it wrote was relayed.',
  stored_output:
    'The task ended before its last output could be streamed. Its stored tail has the rest.',
  timeout: 'The live stream timed out. The task may still be running; follow it again.',
  node_unreachable:
    'The node running this task could not be reached. Follow it again, or read the stored tail.',
  not_found: 'This task no longer exists.',
};

function LiveTaskOutput({
  name,
  runId,
  index,
  queued,
  onEnded,
  onReadStored,
}: {
  name: string;
  runId: string;
  index: number;
  queued: boolean;
  onEnded: () => void;
  onReadStored: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const stream = useLogStream({ kind: 'task', job: name, runId, index }, !paused);
  const ended = stream.status === 'ended';
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  });
  useEffect(() => {
    if (ended) onEndedRef.current();
  }, [ended]);
  const status = ended
    ? (END[stream.reason ?? ''] ??
      (stream.reason ? `The stream ended: ${stream.reason}.` : 'The stream ended.'))
    : stream.status === 'error'
      ? 'The live stream stopped.'
      : stream.status === 'reconnecting'
        ? 'Reconnecting…'
        : stream.status === 'paused'
          ? 'Paused. Lines written meanwhile are relayed when you resume, while the VM still holds them.'
          : stream.status === 'streaming'
            ? stream.lines.length === 0
              ? queued
                ? 'Waiting for the task to start.'
                : 'Waiting for output.'
              : 'Live'
            : 'Connecting…';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <p role="status" className="min-w-0 flex-1 text-muted-foreground">
          {status}
        </p>
        {!ended && stream.status !== 'error' && (
          <Button size="xs" variant="outline" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
        )}
        {stream.canRetry && (
          <Button size="xs" variant="outline" onClick={stream.retry}>
            Retry log stream
          </Button>
        )}
        {ended && stream.reason !== 'not_found' && stream.reason !== 'task_finished' && (
          <Button size="xs" variant="outline" onClick={onReadStored}>
            Read the stored tail
          </Button>
        )}
      </div>
      {(stream.gaps ?? 0) > 0 && (
        <p className="text-xs text-[color:var(--status-warning)]">
          The VM had already dropped some earlier lines before they could be relayed.
        </p>
      )}
      {stream.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the latest {MAX_LINES.toLocaleString('en-US')} lines.
        </p>
      )}
      {stream.lines.length > 0 && (
        <pre
          aria-label={`Live output of task ${index}`}
          className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed"
        >
          {stream.lines.map((line) => line.text).join('\n')}
        </pre>
      )}
      {ended && stream.reason !== 'not_found' && (
        <Button
          size="xs"
          variant="ghost"
          className="self-start"
          onClick={() => {
            // A new stream replays the current attempt from its first line.
            stream.clear();
            stream.retry();
          }}
        >
          Follow again
        </Button>
      )}
    </div>
  );
}

const DECISION: Record<string, string> = {
  retry: 'retried',
  fail_partition: 'partition failed',
  complete: 'completed',
  hold: 'held for reconciliation',
};

function seconds(from?: string, to?: string): string | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function AttemptRow({ attempt: a }: { attempt: JobTaskAttempt }) {
  const took = seconds(a.started_at, a.finished_at);
  return (
    <li className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-medium">Attempt {a.attempt}</span>
        <JobStatusBadge status={a.status} />
        {a.exit_code != null && <span className="font-mono">exit {a.exit_code}</span>}
        {took && <span className="font-mono [font-variant-numeric:tabular-nums]">{took}</span>}
        <span className="text-muted-foreground">
          finished <Timestamp value={a.finished_at} />
        </span>
      </div>
      {a.error_message && (
        <p className="break-words font-mono text-[11px] text-muted-foreground">
          {a.error_class ? `${a.error_class}: ` : ''}
          {a.error_message}
        </p>
      )}
      {(a.outcome_code || a.work_decision) && (
        <p className="text-xs text-muted-foreground">
          {a.outcome_code && (
            <>
              Reported outcome <span className="font-mono">{a.outcome_code}</span>.{' '}
            </>
          )}
          {a.work_decision && (
            <>
              Classified {a.work_decision.classification.replaceAll('_', ' ')},{' '}
              {DECISION[a.work_decision.action] ?? a.work_decision.action}
              {a.work_decision.reason ? ` (${a.work_decision.reason.replaceAll('_', ' ')})` : ''}.
            </>
          )}
        </p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Log of attempt {a.attempt}
          {a.log_truncated ? ' · tail only' : ''}
        </summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
          {a.log_content || 'This attempt wrote no output.'}
        </pre>
      </details>
    </li>
  );
}

export function TaskAttempts({
  name,
  runId,
  index,
}: {
  name: string;
  runId: string;
  index: number;
}) {
  const q = useJobTaskAttempts(name, runId, index);
  const attempts = q.data?.pages.flatMap((page) => page.attempts) ?? [];
  const phase = queryPhase({
    error: q.error,
    loading: q.isPending,
    isEmpty: attempts.length === 0,
  });
  return (
    <section aria-label={`Attempts of task ${index}`} className="flex flex-col gap-2">
      <h4 className="label-mono text-muted-foreground">Attempt history</h4>
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Loading attempts…"
          emptyMessage="No attempt has finished yet."
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-border">
            {attempts.map((a) => (
              <AttemptRow key={a.attempt} attempt={a} />
            ))}
          </ol>
          {q.hasNextPage && (
            <Button
              size="xs"
              variant="ghost"
              className="self-start"
              busy={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              Load more attempts
            </Button>
          )}
        </>
      )}
    </section>
  );
}
