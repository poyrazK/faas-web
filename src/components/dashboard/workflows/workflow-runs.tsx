import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Input } from '@/components/ui/input';
import { Select, Textarea } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Timestamp } from '@/components/ui/timestamp';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { Panel } from '@/components/dashboard/primitives';
import { ProblemHelp } from '@/components/dashboard/problem-help';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Pagination } from '@/components/dashboard/automation-primitives';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  QUEUED_CANCEL_MAX,
  WORKFLOW_RUN_STATUSES,
  previewQueuedCancel,
  useCancelQueuedRuns,
  useStartWorkflowRun,
  useWorkflowRuns,
  type QueuedCancelOutcome,
  type WorkflowRunStatus,
} from '@/lib/api/workflows';
import { WorkflowStatus, runState } from './workflow-status';
import { parsePayload } from './workflow-run-signals';

const STATUS_LABEL: Record<WorkflowRunStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  awaiting_event: 'Waiting',
  succeeded: 'Succeeded',
  failed: 'Failed or cancelled',
  dead: 'Dead',
};

interface RunRow {
  id: string;
  workflow: string;
  state: string;
  step: string;
  created: string;
  finished: string;
  /** Pending and never started: the only runs the bulk cancel will touch. */
  queued: boolean;
}

/**
 * The app's durable workflow runs, newest first, from both kinds of workflow:
 * declarative YAML steps and code-first SDK functions run on the same engine.
 * Filters are the API's own (exact status, exact workflow name); the page
 * reads 25 at a time by offset.
 */
export function WorkflowRuns({ slug, onOpen }: { slug: string; onOpen: (id: string) => void }) {
  const id = useId();
  const [status, setStatus] = useState<WorkflowRunStatus | ''>('');
  const [nameInput, setNameInput] = useState('');
  const [workflowName, setWorkflowName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [starting, setStarting] = useState(false);
  // Whole UTC days, inclusive; a reversed range is not sent (apid answers 400).
  const reversed = Boolean(from && to && from > to);
  const runs = useWorkflowRuns(slug, {
    status: status || undefined,
    workflowName: workflowName || undefined,
    createdAfter: from && !reversed ? `${from}T00:00:00Z` : undefined,
    createdBefore: to && !reversed ? `${to}T23:59:59.999Z` : undefined,
    offset,
  });
  const confirm = useConfirm();
  const { toast } = useToast();
  const cancelQueued = useCancelQueuedRuns(slug);
  const [previewing, setPreviewing] = useState(false);

  const rows = useMemo<RunRow[]>(
    () =>
      (runs.data?.runs ?? []).map((run) => ({
        id: run.id,
        workflow: run.workflow_name,
        state: runState(run),
        step: run.current_step ?? '',
        created: run.created_at,
        finished: run.cancelled_at ?? run.finished_at ?? '',
        queued: run.status === 'pending' && !run.started_at && !run.cancelled_at,
      })),
    [runs.data]
  );
  const names = useMemo(() => [...new Set(rows.map((r) => r.workflow))].sort(), [rows]);
  // Only rows still on screen can stay selected; a refetch may have moved them on.
  const chosen = rows.filter((r) => r.queued && selected.has(r.id)).map((r) => r.id);
  const anyQueued = rows.some((r) => r.queued);

  const toggle = (rowId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else if (next.size < QUEUED_CANCEL_MAX) next.add(rowId);
      return next;
    });

  const resetPage = () => {
    setOffset(0);
    setSelected(new Set());
  };

  const onCancelQueued = async () => {
    if (!chosen.length) return;
    let preview: QueuedCancelOutcome[];
    setPreviewing(true);
    try {
      preview = (await previewQueuedCancel(slug, chosen)).outcomes;
    } catch (err) {
      toast({ kind: 'error', title: 'Could not check the runs', description: errorMessage(err) });
      return;
    } finally {
      setPreviewing(false);
    }
    const eligible = preview.filter((o) => o.outcome === 'eligible').map((o) => o.run_id);
    if (!eligible.length) {
      toast({
        kind: 'info',
        title: 'Nothing to cancel',
        description: 'Every selected run has started or finished since the list was read.',
      });
      setSelected(new Set());
      return;
    }
    const skipped = preview.length - eligible.length;
    if (
      !(await confirm({
        title: `Cancel ${eligible.length} queued ${eligible.length === 1 ? 'run' : 'runs'}?`,
        description: `They never started, so nothing has run yet; they are marked failed as cancelled.${skipped ? ` ${skipped} selected ${skipped === 1 ? 'run has' : 'runs have'} already started and will be left alone.` : ''} A run that starts before this lands is left alone too.`,
        confirmLabel: 'Cancel runs',
        destructive: true,
      }))
    )
      return;
    try {
      const result = await cancelQueued.mutateAsync(eligible);
      const done = result.outcomes.filter((o) => o.outcome === 'cancelled').length;
      const left = result.outcomes.length - done;
      toast({
        kind: left ? 'info' : 'success',
        title: `Cancelled ${done} ${done === 1 ? 'run' : 'runs'}`,
        description: left
          ? `${left} had started or changed in the meantime and ${left === 1 ? 'was' : 'were'} left alone.`
          : undefined,
      });
      setSelected(new Set());
    } catch (err) {
      toast({ kind: 'error', title: 'Could not cancel the runs', description: errorMessage(err) });
    }
  };

  // On a phone the run ID, current step and finish time fold into the row's
  // disclosure; the checkbox rides in the workflow cell so it stays reachable.
  const columns: Column<RunRow>[] = [
    {
      key: 'workflow',
      label: 'Workflow',
      render: (r) => (
        <span className="flex items-center gap-2">
          {r.queued && (
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-[color:var(--brand)]"
              aria-label={`Select queued run ${r.id.slice(0, 8)} of ${r.workflow}`}
              checked={selected.has(r.id)}
              disabled={!selected.has(r.id) && selected.size >= QUEUED_CANCEL_MAX}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggle(r.id)}
            />
          )}
          <span className="[overflow-wrap:anywhere]">{r.workflow}</span>
        </span>
      ),
    },
    { key: 'state', label: 'Status', render: (r) => <WorkflowStatus status={r.state} /> },
    { key: 'created', label: 'Created', render: (r) => <Timestamp value={r.created} /> },
    {
      key: 'id',
      label: 'Run',
      sortable: false,
      priority: 'secondary',
      render: (r) => <CopyableId value={r.id} label="Run ID" displayLength={8} />,
    },
    {
      key: 'step',
      label: 'Current step',
      priority: 'secondary',
      render: (r) => (r.step ? <span className="font-mono text-xs">{r.step}</span> : '—'),
    },
    {
      key: 'finished',
      label: 'Finished',
      priority: 'secondary',
      render: (r) => <Timestamp value={r.finished} />,
    },
  ];

  const filtered = Boolean(status || workflowName || from || to);
  return (
    <Panel
      title="Runs"
      help="Newest first, across YAML and code-first workflows. Open a run for its steps and controls."
      actions={
        <div className="flex flex-wrap gap-2">
          {chosen.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              busy={previewing || cancelQueued.isPending}
              onClick={() => void onCancelQueued()}
            >
              Cancel {chosen.length} queued
            </Button>
          )}
          <Button size="sm" onClick={() => setStarting(true)}>
            Start a run
          </Button>
        </div>
      }
    >
      <ResourceTable
        rows={rows}
        columns={columns}
        loading={runs.isPending}
        error={runs.error}
        onRetry={() => void runs.refetch()}
        onRowClick={(r) => onOpen(r.id)}
        initialSort={{ key: 'created', dir: 'desc' }}
        desktopMinWidth="md:min-w-[720px]"
        emptyMessage={
          filtered
            ? 'No runs match these filters.'
            : 'No runs yet. Runs appear here when a trigger, schedule or manual start creates one.'
        }
        filters={
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Run status
              <Select
                aria-label="Run status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as WorkflowRunStatus | '');
                  resetPage();
                }}
              >
                <option value="">All statuses</option>
                {WORKFLOW_RUN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </label>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setWorkflowName(nameInput.trim());
                resetPage();
              }}
            >
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Workflow
                <Input
                  aria-label="Workflow"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Exact name, Enter to apply"
                  list={`${id}-names`}
                  maxLength={128}
                  className="w-56"
                />
              </label>
              <datalist id={`${id}-names`}>
                {names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </form>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Created from (UTC)
              <Input
                aria-label="Created from (UTC)"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  resetPage();
                }}
                className="w-40"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              to
              <Input
                aria-label="Created to (UTC)"
                type="date"
                value={to}
                aria-invalid={reversed ? true : undefined}
                onChange={(e) => {
                  setTo(e.target.value);
                  resetPage();
                }}
                className="w-40"
              />
            </label>
            {filtered && (
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => {
                  setStatus('');
                  setNameInput('');
                  setWorkflowName('');
                  setFrom('');
                  setTo('');
                  resetPage();
                }}
              >
                Clear filters
              </Button>
            )}
            {reversed && (
              <p className="basis-full text-xs" style={{ color: 'var(--status-critical)' }}>
                The start date is after the end date, so the range is not applied.
              </p>
            )}
          </div>
        }
      />
      <Pagination
        offset={offset}
        total={runs.data?.total ?? 0}
        busy={runs.isFetching}
        onChange={(next) => {
          setOffset(next);
          setSelected(new Set());
        }}
      />
      {anyQueued && (
        <p className="mt-3 text-xs text-muted-foreground">
          Select up to {QUEUED_CANCEL_MAX} queued runs that never started to cancel them together.
          Started runs are cancelled one at a time from their page.
        </p>
      )}
      {starting && (
        <StartRunDialog
          slug={slug}
          names={names}
          initialName={workflowName}
          onClose={() => setStarting(false)}
          onStarted={(runId) => {
            setStarting(false);
            onOpen(runId);
          }}
        />
      )}
    </Panel>
  );
}

/**
 * A manual start. apid resolves the workflow on the app's live deployment
 * (`workflow_definition_not_found` otherwise), so any declared workflow
 * starts this way whatever its own trigger is. The key belongs to this form:
 * resending the same input after a lost response returns the first run.
 */
function StartRunDialog({
  slug,
  names,
  initialName,
  onClose,
  onStarted,
}: {
  slug: string;
  names: string[];
  initialName: string;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const id = useId();
  const { toast } = useToast();
  const start = useStartWorkflowRun(slug);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(initialName);
  const [input, setInput] = useState('{}');
  const [touched, setTouched] = useState(false);
  const parsed = parsePayload(input);
  const nameError = !name.trim() ? 'Name a workflow declared on the live deployment.' : undefined;

  const submit = async () => {
    setTouched(true);
    if (nameError || !parsed.ok) return;
    try {
      const run = await start.mutateAsync({ name: name.trim(), input: parsed.value ?? {}, key });
      toast({ kind: 'success', title: `Started ${run.workflow_name}` });
      onStarted(run.id);
    } catch (err) {
      // A changed input under a used key is a new request; give it a new key.
      if (err instanceof ApiError && err.code === 'conflict') setKey(crypto.randomUUID());
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Start a workflow run"
      description="Starts one run of a workflow on the app's live deployment, whatever its trigger. The run counts against your concurrent-run quota."
      width="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" busy={start.isPending} onClick={() => void submit()}>
            Start run
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Workflow
          </label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            list={`${id}-names`}
            maxLength={128}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={touched && nameError ? true : undefined}
          />
          <datalist id={`${id}-names`}>
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {touched && nameError && (
            <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
              {nameError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-input`} className="text-sm font-medium">
            Input (JSON)
          </label>
          <Textarea
            id={`${id}-input`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={5}
            spellCheck={false}
            className="font-mono"
            aria-invalid={touched && !parsed.ok ? true : undefined}
          />
          {touched && !parsed.ok && (
            <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
              The input must be valid JSON.
            </p>
          )}
        </div>
        {start.error && (
          <div role="alert" className="flex flex-col gap-1 text-sm">
            <span style={{ color: 'var(--status-critical)' }}>{startError(start.error)}</span>
            <ProblemHelp error={start.error} />
          </div>
        )}
      </form>
    </Modal>
  );
}

function startError(err: unknown): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  switch (err.code) {
    case 'workflow_definition_not_found':
      return 'The live deployment declares no workflow of that name.';
    case 'plan_workflows_quota':
      return 'Your plan’s concurrent-run quota is reached. Wait for a run to finish, or cancel one.';
    case 'plan_workflows_not_allowed':
      return 'Workflows are not included in your plan.';
    case 'workflow_tenant_identity_unavailable':
      return 'This app requires a platform tenant; start its runs through the tenant’s route.';
    case 'conflict':
      return 'That request was already used with different input. Press Start run again to send it as a new run.';
    default:
      return errorMessage(err);
  }
}
