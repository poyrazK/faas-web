import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  admitStep,
  completeBlocker,
  projectRunAction,
  stepAdmittable,
  useProjectRunDiagnostics,
  useProjectRunWrites,
  useProjectVerificationRun,
  useProjectVerificationRuns,
  type ProjectVerificationRun,
  type RunAction,
  type RunStatusFilter,
  type VerificationRun,
  type VerificationRunStep,
} from '@/lib/api/binding-verification';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import {
  Diagnostics,
  RUN_STATUS_OPTIONS,
  StatusBadge,
  StepRow,
  blockerText,
  explain,
  short,
} from '../binding-verification-runs';
import { CliCommand } from '../cli-command';
import { InlinePhase, Panel, queryPhase } from '../primitives';
import { SegmentedControl } from '../tabs';

type Props = { accountId: string; project: string; environment: string };

/**
 * Project-wide binding verification graphs for one environment (faas
 * handlers_project_binding_verification_runs.go, ADR-1355). A graph pins the
 * members of a prepared release set, each an app run, with one shared
 * admission budget and one deadline. The server never drives it: each
 * member's probe and canary steps are admitted through that app's own admit
 * route (pkg/bindingrun/runner.go:554), then the graph is completed.
 *
 * Creating one needs a prepared release-set manifest (CheckedProjectRelease
 * Manifest, from release-sets/prepare), which the console does not prepare
 * yet, so creation is handed to the CLI.
 */
export function ProjectVerificationRuns({ accountId, project, environment }: Props) {
  const [status, setStatus] = useState<RunStatusFilter>('all');
  const [selected, setSelected] = useState('');
  const list = useProjectVerificationRuns(accountId, project, environment, status);
  const rows = list.data?.pages.flatMap((page) => page.runs) ?? [];
  const phase = queryPhase({ error: list.error, loading: list.isLoading, isEmpty: !rows.length });
  const filtered = RUN_STATUS_OPTIONS.find((option) => option.key === status)?.label;

  return (
    <Panel
      title="Graph verification runs"
      help={`Binding verification across every member of a release set in ${environment}. Each member is an app run; they share one admission budget and deadline. Nothing runs on its own: admit each member’s steps, then complete the graph.`}
    >
      <div className="space-y-4 text-sm">
        <SegmentedControl
          label="Graph run status"
          value={status}
          options={RUN_STATUS_OPTIONS}
          onChange={setStatus}
        />
        <InlinePhase
          phase={phase}
          error={list.error}
          loadingMessage="Loading graph verification runs…"
          emptyMessage={
            status === 'all'
              ? `No graph verification runs are retained for ${environment}.`
              : `No ${filtered?.toLowerCase()} graph verification runs are retained for ${environment}.`
          }
          onRetry={() => void list.refetch()}
        />
        {phase === 'ready' && (
          <>
            <ul
              aria-label="Graph verification runs"
              className="divide-y divide-border well rounded-xl bg-muted/40"
            >
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                  aria-current={row.id === selected || undefined}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <StatusBadge status={row.status} />
                    <span className="font-mono text-xs">{short(row.id)}</span>
                    <span className="text-xs text-muted-foreground">
                      <Timestamp value={row.created_at} /> · expires{' '}
                      <Timestamp value={row.expires_at} />
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Open graph run ${short(row.id)}`}
                    onClick={() => setSelected(row.id)}
                  >
                    Open
                  </Button>
                </li>
              ))}
            </ul>
            {list.hasNextPage && (
              <Button
                size="sm"
                variant="outline"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                Load older runs
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              The list shows stored state; expired means past its deadline when the list was read.
              Open a run to recheck it against current results.
            </p>
          </>
        )}
        {selected && (
          <GraphRunDetail
            key={selected}
            accountId={accountId}
            project={project}
            environment={environment}
            runId={selected}
          />
        )}
        <CliCommand
          label="A graph run starts from a prepared release set, which the console does not prepare yet. Prepare one, then verify it with the CLI:"
          command={`gregale environment release-sets verify --durable --file manifest.json ${project} ${environment}`}
          copyLabel={`graph verify command for ${project} ${environment}`}
        />
      </div>
    </Panel>
  );
}

function GraphRunDetail({ accountId, project, environment, runId }: Props & { runId: string }) {
  const run = useProjectVerificationRun(accountId, project, environment, runId);
  const pending = run.data?.status === 'pending';
  const diagnostics = useProjectRunDiagnostics(accountId, project, environment, runId, pending);
  const refresh = useProjectRunWrites(accountId, project, environment);
  const confirm = useConfirm();
  const [notice, setNotice] = useState<ReactNode>(null);
  const phase = queryPhase({ error: run.error, loading: run.isLoading });

  const act = useMutation({
    mutationFn: (action: RunAction) => projectRunAction(project, environment, runId, action),
    onSuccess: (result, action) => {
      // 202: the graph stays pending while readiness settles (handlers_
      // project_binding_verification_runs.go:88-91).
      if (action === 'complete' && result.status === 'pending' && result.qualification)
        setNotice(
          <div role="status" className="space-y-1">
            <p>Not passed yet. These readiness conditions are still settling:</p>
            <ul className="list-disc pl-5">
              {result.qualification.conditions.map((c, i) => (
                <li key={i} className="break-all">
                  {c.app}: <span className="font-mono">{c.code}</span>
                  {c.name ? ` · ${c.name}` : ''}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Complete again before the graph expires; nothing new was admitted.
            </p>
          </div>
        );
      else if (action === 'resume')
        setNotice(<p role="status">The original review still holds for every member.</p>);
      else setNotice(null);
    },
    onError: (error) => setNotice(<p role="alert">{explain(error, 'run')}</p>),
    onSettled: refresh,
  });
  const admit = useMutation({
    mutationFn: ({ app, member, index }: { app: string; member: string; index: number }) =>
      admitStep(app, member, index),
    onSuccess: () => setNotice(null),
    onError: (error) => setNotice(<p role="alert">{explain(error, 'run')}</p>),
    onSettled: refresh,
  });

  async function requestAdmit(app: string, member: VerificationRun, index: number) {
    const plan = member.steps[index].plan;
    if (plan.action === 'queue-canary') {
      const ok = await confirm({
        title: `Publish a canary message to ${plan.binding || plan.name} in ${app}?`,
        description:
          'One reserved canary message goes through this push queue binding to the deployment’s consumer, which must handle it safely. It uses normal queue capacity and changes no traffic.',
        confirmLabel: 'Publish',
      });
      if (!ok) return;
    } else if (plan.type === 'object_storage' && plan.probe_mode && plan.probe_mode !== 'read') {
      const ok = await confirm({
        title: `Write a disposable object under ${plan.prefix ?? plan.binding} in ${app}?`,
        description:
          'The probe uploads a test object with this binding’s credentials and then deletes it.',
        confirmLabel: 'Admit probe',
      });
      if (!ok) return;
    }
    admit.mutate({ app, member: member.id, index });
  }

  async function cancel() {
    const ok = await confirm({
      title: 'Cancel this graph verification run?',
      description:
        'Blocks further admissions in every member and cancels the unfinished probes and canary messages the graph started. A handler already running may still finish. Results that already succeeded are kept.',
      confirmLabel: 'Cancel graph run',
      destructive: true,
    });
    if (ok) act.mutate('cancel');
  }

  const data = run.data;
  const members = data ? Object.entries(data.members).sort(([a], [b]) => a.localeCompare(b)) : [];
  const waiting = members.flatMap(([app, member]) => {
    const blocker = completeBlocker(member);
    return blocker ? [`${app}: ${blockerText(blocker)}`] : [];
  });
  const busy = act.isPending || admit.isPending;

  return (
    <section
      aria-label={`Graph run ${short(runId)}`}
      className="space-y-4 well rounded-xl bg-muted/40 p-4"
    >
      <InlinePhase
        phase={phase}
        error={run.error}
        loadingMessage="Checking the graph against current results…"
        onRetry={() => void run.refetch()}
      />
      {phase === 'ready' && data && (
        <>
          <GraphHeader run={data} />
          {data.status === 'passed' && (
            <p className="text-xs text-muted-foreground">
              Passed qualifies this release set at the last check. It moves no traffic: activating
              the release set rechecks its graph and policies.
            </p>
          )}
          {members.map(([app, member]) => (
            <MemberRun
              key={app}
              app={app}
              member={member}
              graphPending={data.status === 'pending'}
              blockers={diagnostics.data?.members[app]?.blockers ?? []}
              checkPassed={diagnostics.data?.members[app]?.check_passed}
              busy={busy}
              onAdmit={(index) => void requestAdmit(app, member, index)}
            />
          ))}
          {notice}
          {data.status === 'pending' && waiting.length > 0 && (
            <ul role="status" className="space-y-1 text-xs">
              {waiting.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {data.status === 'pending' && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || waiting.length > 0}
                onClick={() => act.mutate('complete')}
              >
                Complete
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act.mutate('resume')}
              >
                Recheck review
              </Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void cancel()}>
                Cancel graph run
              </Button>
            </div>
          )}
          {data.status === 'pending' && (
            <p className="text-xs text-muted-foreground">
              Complete passes only when every member’s admitted steps succeeded and a fresh check of
              the frozen membership, routing and policies passes. Recheck confirms the original
              review still holds; neither extends the deadline.
            </p>
          )}
          <Diagnostics
            phase={queryPhase({ error: diagnostics.error, loading: diagnostics.isLoading })}
            error={diagnostics.error}
            data={diagnostics.data}
            onRetry={() => void diagnostics.refetch()}
          />
        </>
      )}
    </section>
  );
}

function GraphHeader({ run }: { run: ProjectVerificationRun }) {
  return (
    <div className="space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge status={run.status} />
        <CopyableId value={run.id} label="graph run ID" full />
      </div>
      {run.reason && <p className="text-xs text-muted-foreground">Reason: {run.reason}</p>}
      <p className="text-xs text-muted-foreground">
        {run.environment} · created <Timestamp value={run.created_at} /> · expires{' '}
        <Timestamp value={run.expires_at} /> · up to {run.max_concurrency ?? 2} unfinished resources
        across all members · queue publication {run.queue_publish ? 'consented' : 'not consented'} ·
        storage writes {run.object_storage_write ? 'consented' : 'not consented'}
      </p>
    </div>
  );
}

function MemberRun({
  app,
  member,
  graphPending,
  blockers,
  checkPassed,
  busy,
  onAdmit,
}: {
  app: string;
  member: VerificationRun;
  graphPending: boolean;
  blockers: { step_index?: number; message: string }[];
  checkPassed: boolean | undefined;
  busy: boolean;
  onAdmit: (index: number) => void;
}) {
  const byStep = new Map<number, string[]>();
  for (const blocker of blockers)
    if (blocker.step_index !== undefined)
      byStep.set(blocker.step_index, [...(byStep.get(blocker.step_index) ?? []), blocker.message]);
  return (
    <section aria-label={`Member ${app}`} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{app}</h3>
        <StatusBadge status={member.status} />
        <span className="text-xs text-muted-foreground">
          deployment <span className="font-mono">{short(member.deployment_id)}</span> · policy
          revision {member.policy.revision}
          {checkPassed === undefined
            ? ''
            : checkPassed
              ? ' · current results satisfy its policy'
              : ' · current results do not yet satisfy its policy'}
        </span>
      </div>
      <ol
        aria-label={`${app} steps`}
        className="divide-y divide-border well rounded-xl bg-muted/40"
      >
        {member.steps.map((step: VerificationRunStep, index) => (
          <StepRow
            key={index}
            index={index}
            step={step}
            blockers={byStep.get(index) ?? []}
            admittable={graphPending && stepAdmittable(member, step)}
            busy={busy}
            onAdmit={() => onAdmit(index)}
          />
        ))}
      </ol>
    </section>
  );
}
