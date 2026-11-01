import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD, Select, Textarea } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { useCapability } from '@/lib/api/capabilities';
import { safeCapabilityDocs } from '@/lib/capability-entrypoints';
import {
  useCancelDelayedTask,
  useDelayedTask,
  useDelayedTasks,
  useScheduleDelayedTask,
  type DelayedTask,
} from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { formatRelative } from '@/lib/mock-data';

/**
 * Delayed tasks — durable one-shot invocations of an app at a chosen time
 * (`/v1/apps/{slug}/delayed-tasks`, faas handlers_invocations.go:703-871).
 *
 * The list is the API's own newest-first ledger, so tasks scheduled by the CLI
 * or another session show up here too. Nothing shows the payload or headers:
 * the API does not return them. Cancelling only stops a task that is
 * still `pending`; one already `dispatching` may complete, and the API answers
 * with the state it actually left the task in, which the toast reports.
 */
export function DelayedTasks({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability="delayed-execution" title="Delayed tasks">
      <DelayedTasksPanel slug={slug} />
    </CapabilityGate>
  );
}

const STATE_COLOR: Record<string, string> = {
  pending: 'var(--status-warning)',
  dispatching: 'var(--status-warning)',
  completed: 'var(--status-good)',
  failed: 'var(--status-critical)',
  dead_letter: 'var(--status-critical)',
  cancelled: 'var(--chart-muted)',
  // Not in the OpenAPI enum, but faas state/types.go:4633-4634 can write them.
  superseded: 'var(--chart-muted)',
  expired: 'var(--chart-muted)',
};

interface TaskRow {
  id: string;
  state: string;
  runsAt: string;
  target: string;
  createdAt: string;
  attempts: number;
}

function when(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

function exact(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toLocaleString();
}

const target = (t: DelayedTask) => [t.method, t.path].filter(Boolean).join(' ') || '—';

function DelayedTasksPanel({ slug }: { slug: string }) {
  const { capability } = useCapability('delayed-execution');
  const maturity =
    capability?.maturity === 'beta' ? 'Beta' : capability?.maturity === 'preview' ? 'Preview' : '';
  const docs = capability && safeCapabilityDocs(capability.docs_url);
  const { toast } = useToast();
  const confirm = useConfirm();
  const tasks = useDelayedTasks(slug);
  const cancel = useCancelDelayedTask();
  const [selected, setSelected] = useState<string | null>(null);

  const loaded = useMemo(() => tasks.data?.pages.flatMap((p) => p.tasks) ?? [], [tasks.data]);
  const rows = useMemo<TaskRow[]>(
    () =>
      loaded.map((t) => ({
        id: t.id,
        state: t.state,
        runsAt: t.scheduled_at,
        target: target(t),
        createdAt: t.created_at ?? '',
        attempts: t.attempts ?? 0,
      })),
    [loaded]
  );
  // Rows already shown stay usable if an older page fails to load.
  const listError = rows.length === 0 ? tasks.error : undefined;

  const onCancel = async (row: TaskRow) => {
    if (
      !(await confirm({
        title: 'Cancel this delayed task?',
        description: `${row.target} will not run. A task that has already started dispatching cannot be stopped.`,
        confirmLabel: 'Cancel task',
        destructive: true,
      }))
    )
      return;
    try {
      const result = await cancel.mutateAsync(row.id);
      if (result.state === 'cancelled') {
        toast({ kind: 'success', title: 'Task cancelled' });
      } else {
        toast({
          kind: 'info',
          title: `Already ${result.state}`,
          description:
            result.state === 'dispatching'
              ? 'The task had started, so it may still complete.'
              : 'The task had finished; nothing was stopped.',
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invocation_not_found') {
        toast({ kind: 'error', title: 'This task no longer exists' });
        void tasks.refetch();
        return;
      }
      toast({ kind: 'error', title: 'Could not cancel', description: errorMessage(err) });
    }
  };

  const columns: Column<TaskRow>[] = [
    {
      key: 'state',
      label: 'State',
      width: 'w-32',
      render: (t) => <Pill label={t.state} color={STATE_COLOR[t.state]} />,
    },
    {
      key: 'runsAt',
      label: 'Runs',
      render: (t) => (
        <span className="text-xs text-muted-foreground" title={exact(t.runsAt)}>
          {when(t.runsAt)}
        </span>
      ),
    },
    {
      key: 'target',
      label: 'Target',
      render: (t) => <span className="font-mono text-xs">{t.target}</span>,
    },
    {
      key: 'createdAt',
      label: 'Created',
      numeric: true,
      render: (t) => (
        <span className="text-xs text-muted-foreground" title={exact(t.createdAt)}>
          {when(t.createdAt)}
        </span>
      ),
    },
    {
      key: 'attempts',
      label: 'Tries',
      numeric: true,
      width: 'w-20',
      priority: 'secondary',
      render: (t) => (
        <span className="[font-variant-numeric:tabular-nums]">{t.attempts || '—'}</span>
      ),
    },
  ];

  return (
    <Panel
      title="Delayed tasks"
      description="One-shot requests to this app at a chosen time, up to a year ahead. Cancelling stops a task only while it is pending."
      actions={
        <div className="flex items-center gap-3">
          {docs && (
            <a className="text-xs text-brand underline" href={docs}>
              Documentation
            </a>
          )}
          {maturity && <Pill label={maturity} />}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <ScheduleForm slug={slug} />
        <ResourceTable
          rows={rows}
          columns={columns}
          emptyMessage="No delayed tasks for this app yet."
          minWidth="min-w-[560px]"
          loading={tasks.isPending && rows.length === 0}
          error={listError}
          onRetry={() => void tasks.refetch()}
          onRowClick={(t) => setSelected(t.id)}
          rowActions={(t) =>
            t.state === 'pending' ? (
              <button
                type="button"
                aria-label={`Cancel task ${t.id.slice(0, 8)} (${t.target}, runs ${when(t.runsAt)})`}
                onClick={() => void onCancel(t)}
                className="pressable rounded text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            ) : null
          }
        />
        {rows.length > 0 && Boolean(tasks.error) && (
          <InlinePhase
            phase={queryPhase({ error: tasks.error })}
            error={tasks.error}
            onRetry={() => void tasks.refetch()}
          />
        )}
        {tasks.hasNextPage && (
          <div className="flex justify-center">
            <Button
              size="sm"
              variant="outline"
              busy={tasks.isFetchingNextPage}
              onClick={() => void tasks.fetchNextPage().catch(() => undefined)}
            >
              Load older tasks
            </Button>
          </div>
        )}
      </div>
      <DelayedTaskDetail id={selected} onClose={() => setSelected(null)} />
    </Panel>
  );
}

const METHODS = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'] as const;

function ScheduleForm({ slug }: { slug: string }) {
  const { toast } = useToast();
  const schedule = useScheduleDelayedTask(slug);
  const [at, setAt] = useState('');
  const [method, setMethod] = useState<string>('POST');
  const [path, setPath] = useState('/');
  const [payload, setPayload] = useState('{}');

  const submit = () => {
    if (!at || schedule.isPending) return;
    if (!path.startsWith('/')) {
      toast({ kind: 'error', title: 'The path must start with /' });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      parsed = null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      toast({ kind: 'error', title: 'Payload must be a JSON object' });
      return;
    }
    void schedule
      .mutateAsync({
        scheduledAt: new Date(at).toISOString(),
        method,
        path,
        payload: parsed as Record<string, unknown>,
      })
      .then((t) => {
        setAt('');
        toast({
          kind: 'success',
          title: 'Task scheduled',
          description: `Runs ${new Date(t.scheduled_at).toLocaleString()}.`,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'plan_delayed_tasks_cap') {
          toast({
            kind: 'error',
            title: "At the plan's pending-task limit",
            description: 'Cancel a pending task, or wait for one to run, then schedule again.',
          });
          return;
        }
        toast({ kind: 'error', title: 'Could not schedule', description: errorMessage(err) });
      });
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Run at</span>
        <input
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Method</span>
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Path</span>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          spellCheck={false}
          className={`${FIELD} font-mono`}
        />
      </label>
      <label className="flex min-w-56 flex-1 flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">JSON payload</span>
        <Textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={2}
          spellCheck={false}
          className="min-h-9 font-mono"
        />
      </label>
      <Button size="sm" onClick={submit} disabled={!at} busy={schedule.isPending}>
        Schedule
      </Button>
    </div>
  );
}

/**
 * One task read by id. The payload and headers are not part of the response;
 * the result is the app's own retained response body, shown as the
 * invocations drawer shows it.
 */
function DelayedTaskDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useDelayedTask(id ?? '', { poll: true });
  const t = q.data;
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: !t });
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={t ? target(t) : 'Delayed task'}
      width="max-w-2xl"
    >
      {phase !== 'ready' || !t ? (
        <InlinePhase phase={phase} error={q.error} emptyMessage="This task has no detail." />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            {[
              ['Task', t.id],
              ['State', t.state],
              ['Attempts', String(t.attempts ?? 0)],
              ['Runs', exact(t.scheduled_at) ?? '—'],
              ['Created', exact(t.created_at) ?? '—'],
              ['Completed', exact(t.completed_at) ?? '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex min-w-0 flex-col gap-0.5">
                <dt className="label-mono text-muted-foreground">{k}</dt>
                <dd className="break-all font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>
          {t.last_error && (
            <p
              className="rounded-md border px-3 py-2 font-mono text-xs"
              style={{
                borderColor: 'color-mix(in oklab, var(--status-critical) 35%, transparent)',
              }}
            >
              {t.last_error}
            </p>
          )}
          {t.result != null && (
            <div>
              <p className="label-mono mb-1.5 text-muted-foreground">Result</p>
              <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed">
                {JSON.stringify(t.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
