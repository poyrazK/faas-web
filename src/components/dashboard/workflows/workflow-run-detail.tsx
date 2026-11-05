import { useMemo, useState } from 'react';
import { NavArrowLeft } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { JsonReadout } from '@/components/dashboard/automation-editor';
import { useApp } from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  isActiveRun,
  useCancelWorkflowRun,
  useResumeWorkflowRun,
  useRetryWorkflowStep,
  useWorkflowDiagnostics,
  useWorkflowResumes,
  useWorkflowRun,
  useWorkflowStepAttempts,
  useWorkflowSteps,
  type WorkflowDiagnosticStep,
  type WorkflowDiagnostics,
  type WorkflowRun,
  type WorkflowStep,
} from '@/lib/api/workflows';
import { WorkflowStatus, runState } from './workflow-status';
import { RunCallbacks, SendEventButton } from './workflow-run-signals';

/** apid's own words for where a run stands (WorkflowRunDiagnosticsResponse.state_reason). */
export const STATE_REASON: Record<WorkflowDiagnostics['state_reason'], string> = {
  ready: 'Ready to dispatch. Ready does not mean it starts this instant.',
  scheduled: 'Scheduled to start later.',
  retry_backoff: 'Waiting to retry a failed step.',
  parked_wait: 'Parked on a timer, event or callback wait. No VM is kept running.',
  app_capacity: 'Held back: the app is at its concurrent-run limit.',
  tenant_capacity: 'Held back: the platform tenant is at its run limit.',
  workflow_capacity: 'Held back: this workflow is at its max_concurrent_runs.',
  running: 'Running a step now.',
  succeeded: 'Finished successfully.',
  failed: 'Finished with a failure.',
  dead: 'Stopped after exhausting its retries or breaking a limit.',
  cancelled: 'Cancelled.',
};

const STEP_KIND: Record<WorkflowDiagnosticStep['kind'], string> = {
  action: 'HTTP call',
  for_each: 'For each',
  join: 'Join',
  timer: 'Timer',
  event: 'Event wait',
  callback: 'Callback',
  condition: 'Condition',
  unknown: 'Unknown',
};

const SKIP_REASON: Record<NonNullable<WorkflowStep['skip_reason']>, string> = {
  when_false: 'its when condition was false',
  dependency_skipped: 'a dependency was skipped',
  dependency_failed: 'a dependency failed',
  route_not_taken: 'its route was not taken',
};

const newKey = () => crypto.randomUUID();
const list = (names: readonly string[]) =>
  names.length <= 3
    ? names.join(', ')
    : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

/**
 * One run: where it stands, its steps with their attempts, and the controls
 * faas allows on it. Resume and step retry are offered only where the run's
 * diagnostics say the planner would accept them; the write rechecks anyway.
 */
export function WorkflowRunDetail({
  slug,
  id,
  onClose,
}: {
  slug: string;
  id: string;
  onClose: () => void;
}) {
  const runQuery = useWorkflowRun(id);
  const app = useApp(slug);
  const run = runQuery.data;
  const foreign = Boolean(run && app.data?.id && run.app_id !== app.data.id);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <NavArrowLeft aria-hidden className="h-3.5 w-3.5" />
          All runs
        </Button>
      </div>
      {!run || runQuery.error ? (
        <Panel title="Workflow run">
          <InlinePhase
            phase={queryPhase({ loading: runQuery.isPending, error: runQuery.error })}
            error={runQuery.error}
            loadingMessage="Loading run…"
            onRetry={() => void runQuery.refetch()}
          />
        </Panel>
      ) : foreign ? (
        <Panel title="Workflow run">
          <p role="alert" className="text-sm text-muted-foreground">
            This run belongs to another app. Open it from that app&apos;s Workflows page.
          </p>
        </Panel>
      ) : (
        <RunBody slug={slug} run={run} />
      )}
    </div>
  );
}

function RunBody({ slug, run }: { slug: string; run: WorkflowRun }) {
  const active = isActiveRun(run.status);
  const diagnostics = useWorkflowDiagnostics(run.id, active);
  const state = runState(run);
  return (
    <>
      <Panel
        title={run.workflow_name}
        help="One durable run. It survives restarts and deploys, and stays pinned to the deployment that started it."
        actions={<RunActions slug={slug} run={run} diagnostics={diagnostics.data} />}
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Status">
            <WorkflowStatus status={state} />
          </Fact>
          <Fact label="Run ID">
            <CopyableId value={run.id} label="Run ID" />
          </Fact>
          <Fact label="Current step">{run.current_step ?? '—'}</Fact>
          <Fact label="Created">
            <Timestamp value={run.created_at} />
          </Fact>
          <Fact label="Started">
            <Timestamp value={run.started_at} />
          </Fact>
          <Fact label={run.cancelled_at ? 'Cancelled' : 'Finished'}>
            <Timestamp value={run.cancelled_at ?? run.finished_at} />
          </Fact>
          <Fact label="Deployment">
            {run.deployment_id ? (
              <CopyableId value={run.deployment_id} label="Deployment ID" />
            ) : (
              <span className="text-muted-foreground">Not pinned (legacy run)</span>
            )}
          </Fact>
          <Fact label="Resumed">{`${run.resume_count ?? 0} of 16 times`}</Fact>
        </dl>
        {run.last_error && (
          <p
            className="mt-4 rounded-md border border-border p-3 font-mono text-xs [overflow-wrap:anywhere]"
            style={{ color: 'var(--status-critical)' }}
          >
            {run.last_error}
          </p>
        )}
        <RunState diagnostics={diagnostics} />
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer">Run input and output</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Input</p>
              <JsonReadout value={run.input} />
            </div>
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Output</p>
              <JsonReadout value={run.output} />
            </div>
          </div>
        </details>
      </Panel>
      {run.status === 'failed' || run.status === 'dead' ? (
        <ResumePlan diagnostics={diagnostics.data} cancelled={Boolean(run.cancelled_at)} />
      ) : null}
      <RunSteps slug={slug} run={run} diagnostics={diagnostics.data} />
      <RunCallbacks slug={slug} run={run} />
      <ResumeHistory id={run.id} count={run.resume_count ?? 0} />
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function RunState({ diagnostics }: { diagnostics: ReturnType<typeof useWorkflowDiagnostics> }) {
  const d = diagnostics.data;
  if (!d)
    return (
      <div className="mt-4">
        <InlinePhase
          phase={queryPhase({ loading: diagnostics.isPending, error: diagnostics.error })}
          error={diagnostics.error}
          loadingMessage="Reading diagnostics…"
          onRetry={() => void diagnostics.refetch()}
        />
      </div>
    );
  return (
    <div className="mt-4 flex flex-col gap-1 text-sm">
      <p>
        <span className="text-muted-foreground">Where it stands: </span>
        {STATE_REASON[d.state_reason] ?? d.state_reason}
      </p>
      {d.next_wake_at && (
        <p className="text-muted-foreground">
          Next wake <Timestamp value={d.next_wake_at} />.
        </p>
      )}
      {d.due_age_seconds > 0 && (
        <p className="text-muted-foreground">
          Due for {formatSeconds(d.due_age_seconds)} without being picked up.
        </p>
      )}
      {d.stale_lease && (
        <p style={{ color: 'var(--status-warning)' }}>
          The worker that held this run stopped reporting; the scheduler will reclaim it.
        </p>
      )}
    </div>
  );
}

export function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86_400).toFixed(1)} d`;
}

function RunActions({
  slug,
  run,
  diagnostics,
}: {
  slug: string;
  run: WorkflowRun;
  diagnostics: WorkflowDiagnostics | undefined;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const cancel = useCancelWorkflowRun(slug);
  const resume = useResumeWorkflowRun(slug);
  const active = isActiveRun(run.status);
  const failed = (run.status === 'failed' || run.status === 'dead') && !run.cancelled_at;
  const preview = diagnostics?.resume;

  const onCancel = async () => {
    if (
      !(await confirm({
        title: `Cancel this ${run.workflow_name} run?`,
        description:
          'The run is marked failed as cancelled by you, and its queued, running and waiting steps are skipped. Calls your app already received are not undone, and a cancelled run cannot be resumed — start a new one instead.',
        confirmLabel: 'Cancel run',
        destructive: true,
      }))
    )
      return;
    try {
      const result = await cancel.mutateAsync(run.id);
      if (result.cancelled_at) toast({ kind: 'success', title: 'Run cancelled' });
      else
        toast({
          kind: 'info',
          title: `Already ${result.status}`,
          description: 'The run had finished before the cancel arrived; nothing was stopped.',
        });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not cancel the run', description: errorMessage(err) });
    }
  };

  const onResume = async () => {
    if (!preview?.eligible) return;
    const reopened = preview.reopened_steps;
    const next = preview.expected_resume_count + 1;
    if (
      !(await confirm({
        title: `Resume this ${run.workflow_name} run?`,
        description: `${reopened.length ? `Reopens ${list(reopened)} with a fresh retry budget. ` : ''}${preview.preserved_steps.length} recorded steps keep their results, and the run keeps its input, idempotency keys and attempt history. This is resume ${next} of 16, and the run counts against your active-run quota again.`,
        confirmLabel: 'Resume run',
      }))
    )
      return;
    try {
      await resume.mutateAsync({
        id: run.id,
        expectedResumeCount: preview.expected_resume_count,
        key: newKey(),
      });
      toast({ kind: 'success', title: 'Run resumed', description: 'It is queued again.' });
    } catch (err) {
      toast({ kind: 'error', title: resumeErrorTitle(err), description: errorMessage(err) });
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {active && <SendEventButton slug={slug} run={run} />}
      {failed && (
        <Button
          size="sm"
          disabled={!preview?.eligible || resume.isPending}
          title={preview && !preview.eligible ? 'See why below' : undefined}
          onClick={() => void onResume()}
        >
          {resume.isPending ? 'Resuming…' : 'Resume run'}
        </Button>
      )}
      {active && (
        <Button
          size="sm"
          variant="outline"
          disabled={cancel.isPending}
          onClick={() => void onCancel()}
        >
          {cancel.isPending ? 'Cancelling…' : 'Cancel run'}
        </Button>
      )}
    </div>
  );
}

/** Resume refusals are settled answers; the title says which one (handlers_workflow_resume.go). */
function resumeErrorTitle(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not resume the run';
  switch (err.code) {
    case 'workflow_resume_conflict':
      return 'The run changed since you looked';
    case 'workflow_resume_unsafe':
      return 'This run cannot be resumed safely';
    case 'workflow_resume_limit':
      return 'Resumed 16 times already';
    case 'plan_workflows_quota':
      return 'Active-run quota reached';
    case 'plan_workflows_not_allowed':
      return 'Workflows are not on your plan';
    case 'workflow_deployment_unavailable':
      return 'Workflow runtime unavailable';
    default:
      return 'Could not resume the run';
  }
}

function ResumePlan({
  diagnostics,
  cancelled,
}: {
  diagnostics: WorkflowDiagnostics | undefined;
  cancelled: boolean;
}) {
  if (!diagnostics) return null;
  const { resume } = diagnostics;
  return (
    <Panel
      title="Resume"
      help="What resuming would do, from the same planner the resume request uses. Advisory: state and quota are checked again when you resume."
    >
      {resume.eligible ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">Would reopen: </span>
            {resume.reopened_steps.join(', ') || '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Keeps: </span>
            {resume.preserved_steps.join(', ') || '—'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            {cancelled
              ? 'A cancelled run cannot be resumed. Start a new run instead.'
              : 'This run cannot be resumed right now:'}
          </p>
          <ul className="flex flex-col gap-1.5">
            {resume.blockers.map((b) => (
              <li key={`${b.code}-${b.step_name ?? ''}`} className="flex flex-col">
                <span>
                  {b.message}
                  {b.step_name && (
                    <span className="text-muted-foreground"> (step {b.step_name})</span>
                  )}
                </span>
                <code className="font-mono text-xs text-muted-foreground">{b.code}</code>
              </li>
            ))}
          </ul>
          {resume.reopened_steps.length > 0 && (
            <p className="text-muted-foreground">
              Once that clears it would reopen {resume.reopened_steps.join(', ')}.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

interface StepRow {
  /** The step name, unique within a run. */
  id: string;
  status: string;
  kind: string;
  attempt: number;
  step: WorkflowStep;
  diag?: WorkflowDiagnosticStep;
}

function RunSteps({
  slug,
  run,
  diagnostics,
}: {
  slug: string;
  run: WorkflowRun;
  diagnostics: WorkflowDiagnostics | undefined;
}) {
  const steps = useWorkflowSteps(run.id, isActiveRun(run.status));
  const [open, setOpen] = useState<string | null>(null);
  const confirm = useConfirm();
  const { toast } = useToast();
  const retry = useRetryWorkflowStep(slug);
  const rows = useMemo<StepRow[]>(() => {
    const diag = new Map(diagnostics?.steps.map((s) => [s.step_name, s]) ?? []);
    return (steps.data?.steps ?? []).map((step) => {
      const d = diag.get(step.step_name);
      return {
        id: step.step_name,
        status: step.status,
        kind: d ? STEP_KIND[d.kind] : '—',
        attempt: step.attempt,
        step,
        diag: d,
      };
    });
  }, [steps.data, diagnostics]);

  const onRetry = async (row: StepRow) => {
    const reopened = row.diag?.retry_reopened_steps ?? [];
    if (
      !(await confirm({
        title: `Retry step ${row.step.step_name}?`,
        description: `Requeues this run at ${row.step.step_name} with the input it saved. The step gets one new call; its automatic retry budget is not reset.${reopened.length ? ` Skipped steps after it reopen: ${list(reopened)}.` : ''}`,
        confirmLabel: 'Retry step',
      }))
    )
      return;
    try {
      await retry.mutateAsync({ id: run.id, step: row.step.step_name, key: newKey() });
      toast({ kind: 'success', title: `Retrying ${row.step.step_name}` });
    } catch (err) {
      const title =
        err instanceof ApiError && err.code === 'workflow_step_retry_not_allowed'
          ? 'This step cannot be retried now'
          : err instanceof ApiError && err.code === 'plan_workflows_quota'
            ? 'Active-run quota reached'
            : 'Could not retry the step';
      toast({ kind: 'error', title, description: errorMessage(err) });
    }
  };

  const columns: Column<StepRow>[] = [
    {
      key: 'id',
      label: 'Step',
      render: (r) => (
        <span className="flex flex-col">
          <span className="font-mono text-xs [overflow-wrap:anywhere]">{r.step.step_name}</span>
          {r.step.for_each_parent && (
            <span className="text-xs text-muted-foreground">
              item {r.step.for_each_index} of {r.step.for_each_parent}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <WorkflowStatus status={r.status} />,
    },
    { key: 'kind', label: 'Kind', priority: 'secondary' },
    { key: 'attempt', label: 'Attempt', numeric: true, priority: 'secondary' },
    {
      key: 'step',
      label: 'Detail',
      sortable: false,
      priority: 'secondary',
      render: (r) => <StepNote step={r.step} />,
    },
  ];

  return (
    <Panel
      title="Steps"
      help="Each step's latest state. Open a step for its attempts."
      padded={false}
    >
      <div className="p-5 pt-3">
        <ResourceTable
          rows={rows}
          columns={columns}
          loading={steps.isPending}
          error={steps.error}
          onRetry={() => void steps.refetch()}
          emptyMessage="No steps recorded yet."
          desktopMinWidth="md:min-w-[640px]"
          onRowClick={(r) => setOpen(open === r.id ? null : r.id)}
          rowActions={(r) => (
            <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end sm:gap-2">
              {r.diag?.retry_eligible && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retry.isPending}
                  aria-label={`Retry step ${r.step.step_name}`}
                  onClick={() => void onRetry(r)}
                >
                  Retry
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={open === r.id}
                aria-label={`${open === r.id ? 'Hide' : 'Show'} attempts for ${r.step.step_name}`}
                onClick={() => setOpen(open === r.id ? null : r.id)}
              >
                Attempts
              </Button>
            </div>
          )}
        />
        {open && <StepAttempts runId={run.id} step={open} />}
      </div>
    </Panel>
  );
}

function StepNote({ step }: { step: WorkflowStep }) {
  if (step.error)
    return (
      <span
        className="line-clamp-2 font-mono text-xs [overflow-wrap:anywhere]"
        style={{ color: 'var(--status-critical)' }}
        title={step.error}
      >
        {step.error}
      </span>
    );
  if (step.skip_reason)
    return (
      <span className="text-xs text-muted-foreground">
        Skipped: {SKIP_REASON[step.skip_reason]}
      </span>
    );
  if (step.next_retry_at)
    return (
      <span className="text-xs text-muted-foreground">
        Retries <Timestamp value={step.next_retry_at} />
      </span>
    );
  if (step.next_check_at)
    return (
      <span className="text-xs text-muted-foreground">
        Checks again <Timestamp value={step.next_check_at} />
      </span>
    );
  if (step.finished_at)
    return (
      <span className="text-xs text-muted-foreground">
        Finished <Timestamp value={step.finished_at} />
      </span>
    );
  return <span className="text-xs text-muted-foreground">—</span>;
}

function StepAttempts({ runId, step }: { runId: string; step: string }) {
  const q = useWorkflowStepAttempts(runId, step, true);
  const attempts = q.data?.attempts ?? [];
  return (
    <section aria-label={`Attempts for ${step}`} className="mt-4 flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        Attempts for <span className="font-mono">{step}</span>
      </h3>
      <InlinePhase
        phase={queryPhase({ loading: q.isPending, error: q.error, isEmpty: !attempts.length })}
        error={q.error}
        emptyMessage="No attempts recorded for this step."
        onRetry={() => void q.refetch()}
      />
      {attempts.length > 0 && (
        <ol className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
          {attempts.map((a) => (
            <li key={a.attempt} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <span className="font-mono text-xs">#{a.attempt}</span>
              <WorkflowStatus status={a.status} />
              {a.http_status != null && (
                <span className="font-mono text-xs">HTTP {a.http_status}</span>
              )}
              <Timestamp value={a.started_at} className="text-xs text-muted-foreground" />
              {a.next_attempt_at && (
                <span className="text-xs text-muted-foreground">
                  next <Timestamp value={a.next_attempt_at} />
                </span>
              )}
              {a.error && (
                <span
                  className="basis-full font-mono text-xs [overflow-wrap:anywhere]"
                  style={{ color: 'var(--status-critical)' }}
                >
                  {a.error}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ResumeHistory({ id, count }: { id: string; count: number }) {
  const q = useWorkflowResumes(id);
  // Nothing to say about a run nobody resumed; the history read would be empty.
  if (count === 0 && !q.data?.resumes.length) return null;
  const rows = q.data?.resumes ?? [];
  return (
    <Panel title="Resume history" help="Every accepted resume, oldest first.">
      <InlinePhase
        phase={queryPhase({ loading: q.isPending, error: q.error, isEmpty: !rows.length })}
        error={q.error}
        emptyMessage="No resumes recorded."
        onRetry={() => void q.refetch()}
      />
      {rows.length > 0 && (
        <ol className="flex flex-col gap-3 text-sm">
          {rows.map((r) => (
            <li key={r.resume_number} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Resume {r.resume_number}</span>
                <span className="text-muted-foreground">from</span>
                <WorkflowStatus status={r.previous_status} />
                <Timestamp value={r.created_at} className="text-xs text-muted-foreground" />
              </span>
              <span className="text-muted-foreground">
                Reopened {r.resumed_steps.join(', ') || 'no steps'}
              </span>
              {r.previous_error && (
                <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {r.previous_error}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
