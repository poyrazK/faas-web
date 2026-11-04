import { useMemo, useState } from 'react';
import { CheckCircle, Circle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Timestamp } from '@/components/ui/timestamp';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { errorMessage } from '@/lib/api/errors';
import {
  REPLAY_MAX,
  previewScheduleReplay,
  useReplayScheduleOccurrences,
  useScheduleOccurrences,
  useWorkflowSchedulePreview,
  useWorkflowSchedules,
  type ScheduleOccurrence,
  type ScheduleReplayOutcome,
  type WorkflowSchedule,
  type WorkflowSchedules as SchedulesResponse,
} from '@/lib/api/workflow-automation';
import { WorkflowStatus } from './workflow-status';

/** Why apid will not admit scheduled runs right now (handlers_workflow_schedules.go). */
const UNAVAILABLE: Record<NonNullable<SchedulesResponse['unavailable_reason']>, string> = {
  runtime_disabled: 'The workflow runtime is off on this installation, so no schedule fires.',
  account_inactive: 'The account is inactive, so no schedule fires.',
  plan_not_allowed: 'Your plan does not include workflows, so no schedule fires.',
  maintenance: 'The app is in maintenance mode, so its schedules do not fire.',
  tenant_required:
    'This app runs workflows per platform tenant; each tenant’s schedule is set through its own route.',
};

const LAST_STATUS: Record<NonNullable<WorkflowSchedule['last_status']>, string> = {
  armed: 'Armed',
  started: 'Started a run',
  skipped_overlap: 'Skipped: a run was still active',
  skipped_quota: 'Skipped: run quota full',
};

/** Outcomes that a replay cannot fix by itself, in the person's terms. */
export const REPLAY_OUTCOME: Record<ScheduleReplayOutcome['outcome'], string> = {
  eligible: 'can be replayed',
  replayed: 'replayed',
  already_replayed: 'already replayed',
  occurrence_not_found: 'no longer retained',
  not_skipped: 'was not skipped',
  history_not_replayable: 'recorded before replay was possible',
  deployment_changed: 'the live deployment has changed since',
  definition_changed: 'the workflow definition has changed since',
  schedule_disabled: 'the schedule is now disabled',
  overlap_active: 'a run is still active and overlap is skip',
  quota_full: 'the app’s run quota is full',
  tenant_unavailable: 'its platform tenant is unavailable',
  target_unavailable: 'the workflow is no longer deployed',
  plan_unavailable: 'your plan no longer includes workflows',
};

/**
 * App › Automate › Workflow schedules (capability `workflow-schedules`,
 * beta). Read-only for the schedules themselves — they come from the live
 * deployment's `gregale.yaml` — plus the one write apid offers: replaying
 * minutes that were skipped for overlap or quota.
 */
export function WorkflowSchedulesBody({
  slug,
  onOpenRun,
}: {
  slug: string;
  onOpenRun: (id: string) => void;
}) {
  return (
    <CapabilityGate capability="workflow-schedules" title="Workflow schedules">
      <Schedules slug={slug} onOpenRun={onOpenRun} />
    </CapabilityGate>
  );
}

interface ScheduleRow {
  id: string;
  cron: string;
  overlap: string;
  next: string;
  last: string;
  schedule: WorkflowSchedule;
}

function Schedules({ slug, onOpenRun }: { slug: string; onOpenRun: (id: string) => void }) {
  const stage = useCapabilityStage('workflow-schedules');
  const q = useWorkflowSchedules(slug);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo<ScheduleRow[]>(
    () =>
      (q.data?.schedules ?? []).map((s) => ({
        id: s.workflow_name,
        cron: `${s.schedule} ${s.timezone}`,
        overlap: s.overlap,
        next: s.next_fire_at ?? '',
        last: s.last_evaluated_at ?? '',
        schedule: s,
      })),
    [q.data]
  );
  const reason = q.data?.unavailable_reason;
  const columns: Column<ScheduleRow>[] = [
    {
      key: 'id',
      label: 'Workflow',
      render: (r) => (
        <span className="flex flex-col gap-1">
          <span className="[overflow-wrap:anywhere]">{r.id}</span>
          {!r.schedule.enabled && <span className="text-xs text-muted-foreground">Disabled</span>}
        </span>
      ),
    },
    {
      key: 'cron',
      label: 'Schedule',
      render: (r) => (
        <span className="flex flex-col">
          <code className="font-mono text-xs">{r.schedule.schedule}</code>
          <span className="text-xs text-muted-foreground">{r.schedule.timezone}</span>
        </span>
      ),
    },
    { key: 'next', label: 'Next fire', render: (r) => <Timestamp value={r.next} /> },
    {
      key: 'overlap',
      label: 'Policies',
      priority: 'secondary',
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          Overlap {r.schedule.overlap} · missed fires{' '}
          {r.schedule.catch_up === 'latest'
            ? `run latest within ${r.schedule.catch_up_window ?? 'the window'}`
            : 'skipped'}
        </span>
      ),
    },
    {
      key: 'last',
      label: 'Last fire',
      priority: 'secondary',
      render: (r) =>
        r.schedule.last_status ? (
          <span className="flex flex-col gap-0.5 text-xs">
            <span>{LAST_STATUS[r.schedule.last_status]}</span>
            <span className="text-muted-foreground">
              for <Timestamp value={r.schedule.last_scheduled_for} />
            </span>
            {r.schedule.last_run_id && (
              <button
                type="button"
                className="self-start text-brand underline-offset-4 hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenRun(r.schedule.last_run_id!);
                }}
              >
                Open run
              </button>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Not fired yet</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Schedules"
        description={`${stage ? `${stage} · ` : ''}Workflows the live deployment starts on a cron. Change a schedule in gregale.yaml and deploy; disabling or redeploying one does not cancel runs it already started.`}
      >
        {reason && (
          <p
            role="status"
            className="mb-4 rounded-md border border-border p-3 text-sm"
            style={{ color: 'var(--status-warning)' }}
          >
            {UNAVAILABLE[reason]}
          </p>
        )}
        <ResourceTable
          rows={rows}
          columns={columns}
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          onRowClick={(r) => setOpen(open === r.id ? null : r.id)}
          desktopMinWidth="md:min-w-[760px]"
          emptyMessage="No scheduled workflows on the live deployment. Add a schedule trigger to a workflow in gregale.yaml."
        />
        {open && <SchedulePreview slug={slug} name={open} onClose={() => setOpen(null)} />}
      </Panel>
      <Occurrences slug={slug} onOpenRun={onOpenRun} />
    </div>
  );
}

const CATCH_UP: Record<string, string> = {
  disabled: 'The schedule is disabled; nothing fires.',
  first_evaluation_arms: 'The first evaluation arms the schedule; it starts nothing yet.',
  no_new_evaluation: 'Nothing new is due since the last evaluation.',
  run_current_fire: 'The current fire runs.',
  coalesce_latest: 'Missed fires coalesce into one run of the latest.',
  skip_missed: 'Missed fires are skipped; only the current one runs.',
  outside_catch_up_window: 'Missed fires are older than the catch-up window and are not run.',
  no_due_occurrence: 'No fire is due.',
};

function SchedulePreview({
  slug,
  name,
  onClose,
}: {
  slug: string;
  name: string;
  onClose: () => void;
}) {
  const q = useWorkflowSchedulePreview(slug, name, true);
  const p = q.data;
  return (
    <section aria-label={`Next fires of ${name}`} className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          Next fires of <span className="font-mono">{name}</span>
        </h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <InlinePhase
        phase={queryPhase({ loading: q.isPending, error: q.error })}
        error={q.error}
        loadingMessage="Simulating the schedule…"
        onRetry={() => void q.refetch()}
      />
      {p && (
        <>
          <ol className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
            {p.upcoming.map((f) => (
              <li
                key={f.scheduled_for}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
              >
                <Timestamp value={f.scheduled_for} mode="absolute" />
                <span className="font-mono text-xs text-muted-foreground">
                  {f.local_time} local
                </span>
                {f.dst_adjustment && (
                  <span className="text-xs" style={{ color: 'var(--status-warning)' }}>
                    Moved forward by a daylight-saving gap
                  </span>
                )}
              </li>
            ))}
          </ol>
          <p className="text-sm">
            <span className="text-muted-foreground">Next evaluation: </span>
            {CATCH_UP[p.catch_up.outcome] ?? p.catch_up.outcome}
            {p.catch_up.coalesced_occurrences > 0 &&
              ` ${p.catch_up.coalesced_occurrences} older fires are folded into it.`}
            {p.catch_up.missed_outside_window && ' Some missed fires are outside the window.'}
          </p>
          <p className="text-xs text-muted-foreground">
            Daylight saving:{' '}
            {p.dst_behavior.mode === 'fixed_wall_time'
              ? 'a fixed wall time; a skipped hour moves to the first valid minute, and a repeated hour runs once.'
              : 'an interval; it follows the cron through the change.'}{' '}
            Upcoming times do not reserve capacity.
          </p>
        </>
      )}
    </section>
  );
}

const OCCURRENCE_STATUS: Record<ScheduleOccurrence['status'], string> = {
  started: 'started',
  skipped_overlap: 'skipped',
  skipped_quota: 'skipped',
};

const replayable = (o: ScheduleOccurrence) => o.status !== 'started' && !o.replay_run_id;

interface OccurrenceRow {
  id: string;
  workflow: string;
  minute: string;
  status: string;
  occurrence: ScheduleOccurrence;
}

function Occurrences({ slug, onOpenRun }: { slug: string; onOpenRun: (id: string) => void }) {
  const q = useScheduleOccurrences(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const replay = useReplayScheduleOccurrences(slug);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [checking, setChecking] = useState(false);
  const rows = useMemo<OccurrenceRow[]>(
    () =>
      (q.data?.pages.flatMap((p) => p.occurrences) ?? []).map((o) => ({
        id: o.id,
        workflow: o.workflow_name,
        minute: o.scheduled_for,
        status: o.status,
        occurrence: o,
      })),
    [q.data]
  );
  const chosen = rows
    .filter((r) => replayable(r.occurrence) && selected.has(r.id))
    .map((r) => r.id);
  // Rows already shown stay usable if an older page fails.
  const listError = rows.length === 0 ? q.error : undefined;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < REPLAY_MAX) next.add(id);
      return next;
    });

  const onReplay = async () => {
    let preview: ScheduleReplayOutcome[];
    setChecking(true);
    try {
      preview = (await previewScheduleReplay(slug, chosen)).outcomes;
    } catch (err) {
      toast({ kind: 'error', title: 'Could not check the replay', description: errorMessage(err) });
      return;
    } finally {
      setChecking(false);
    }
    const eligible = preview.filter((o) => o.outcome === 'eligible');
    const blocked = preview.filter((o) => o.outcome !== 'eligible');
    if (!eligible.length) {
      toast({
        kind: 'info',
        title: 'Nothing can be replayed',
        description: summarize(blocked),
      });
      return;
    }
    if (
      !(await confirm({
        title: `Replay ${eligible.length} skipped ${eligible.length === 1 ? 'minute' : 'minutes'}?`,
        description: `Each starts one run now, on the same live deployment and definition, and counts against the app’s run quota.${blocked.length ? ` ${blocked.length} selected will not: ${summarize(blocked)}.` : ''} Every condition is checked again as it starts.`,
        confirmLabel: 'Replay',
      }))
    )
      return;
    try {
      const result = await replay.mutateAsync(eligible.map((o) => o.occurrence_id));
      const started = result.outcomes.filter((o) => o.outcome === 'replayed');
      const left = result.outcomes.filter((o) => o.outcome !== 'replayed');
      toast({
        kind: left.length ? 'info' : 'success',
        title: `Started ${started.length} replay ${started.length === 1 ? 'run' : 'runs'}`,
        description: left.length ? `Not replayed: ${summarize(left)}.` : undefined,
      });
      setSelected(new Set());
    } catch (err) {
      toast({ kind: 'error', title: 'Could not replay', description: errorMessage(err) });
    }
  };

  const columns: Column<OccurrenceRow>[] = [
    {
      key: 'workflow',
      label: 'Workflow',
      render: (r) => (
        <span className="flex items-center gap-2">
          {replayable(r.occurrence) && (
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-[color:var(--brand)]"
              aria-label={`Select skipped ${r.workflow} minute ${r.minute}`}
              checked={selected.has(r.id)}
              disabled={!selected.has(r.id) && selected.size >= REPLAY_MAX}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggle(r.id)}
            />
          )}
          <span className="[overflow-wrap:anywhere]">{r.workflow}</span>
        </span>
      ),
    },
    {
      key: 'minute',
      label: 'Minute',
      render: (r) => <Timestamp value={r.minute} mode="absolute" className="text-xs" />,
    },
    {
      key: 'status',
      label: 'Outcome',
      render: (r) => (
        <span className="flex flex-col gap-1">
          <WorkflowStatus status={OCCURRENCE_STATUS[r.occurrence.status]} />
          {r.occurrence.status !== 'started' && (
            <span className="text-xs text-muted-foreground">
              {r.occurrence.status === 'skipped_overlap' ? 'Run still active' : 'Quota full'}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'id',
      label: 'Run',
      sortable: false,
      priority: 'secondary',
      render: (r) => {
        const run = r.occurrence.run_id ?? r.occurrence.replay_run_id;
        return run ? (
          <span className="flex flex-col gap-0.5">
            {r.occurrence.replay_run_id && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle aria-hidden className="h-3 w-3" /> Replayed{' '}
                <Timestamp value={r.occurrence.replayed_at} />
              </span>
            )}
            <button
              type="button"
              className="self-start font-mono text-xs text-brand underline-offset-4 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onOpenRun(run);
              }}
            >
              Open run {run.slice(0, 8)}
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Circle aria-hidden className="h-3 w-3" /> No run
          </span>
        );
      },
    },
    {
      key: 'occurrence',
      label: 'Evaluated',
      sortable: false,
      priority: 'secondary',
      render: (r) => <Timestamp value={r.occurrence.evaluated_at} />,
    },
  ];

  return (
    <Panel
      title="Fire history"
      description="Every due minute of the last 30 days, started or skipped. Missed minutes are not inferred."
      actions={
        chosen.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            busy={checking || replay.isPending}
            onClick={() => void onReplay()}
          >
            Replay {chosen.length} skipped
          </Button>
        ) : undefined
      }
    >
      <ResourceTable
        rows={rows}
        columns={columns}
        loading={q.isPending}
        error={listError}
        onRetry={() => void q.refetch()}
        initialSort={{ key: 'minute', dir: 'desc' }}
        desktopMinWidth="md:min-w-[720px]"
        emptyMessage="No schedule has fired in the last 30 days."
      />
      {q.hasNextPage && (
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            busy={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            Load older minutes
          </Button>
        </div>
      )}
      {rows.length > 0 && q.error && (
        <p className="mt-3 text-sm" style={{ color: 'var(--status-critical)' }}>
          Older minutes could not be loaded: {errorMessage(q.error)}
        </p>
      )}
      {rows.some((r) => replayable(r.occurrence)) && (
        <p className="mt-3 text-xs text-muted-foreground">
          Select up to {REPLAY_MAX} skipped minutes to run them now. Each minute can be replayed
          once.
        </p>
      )}
    </Panel>
  );
}

/** "2 the live deployment has changed since, 1 quota full" — counts per reason. */
export function summarize(outcomes: ScheduleReplayOutcome[]): string {
  const counts = new Map<string, number>();
  for (const o of outcomes) {
    const reason = REPLAY_OUTCOME[o.outcome] ?? o.outcome;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, n]) => `${n} ${reason}`).join(', ');
}
