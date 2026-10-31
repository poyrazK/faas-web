import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  RUN_DEFAULT_CONCURRENCY,
  RUN_MAX_ACTIVE,
  RUN_MAX_CONCURRENCY,
  RUN_MAX_TTL_SECONDS,
  admitStep,
  createVerificationRun,
  reviewVerification,
  runAction,
  stepAdmittable,
  stepExplanation,
  completeBlocker,
  useRunDiagnostics,
  useRunWrites,
  useVerificationRun,
  useVerificationRuns,
  type CompleteBlocker,
  type RunAction,
  type VerificationDiagnostics,
  type VerificationPlanStep,
  type VerificationReview,
  type VerificationRun,
  type VerificationRunStep,
} from '@/lib/api/binding-verification';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm';
import { InlinePhase, Panel, queryPhase } from './primitives';

const STATUS: Record<string, string> = {
  pending: 'Pending',
  passed: 'Passed',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
  expired: 'Expired',
};
const ACTION: Record<string, string> = {
  probe: 'Probe',
  'queue-canary': 'Queue canary',
  reuse: 'Reuse evidence',
  wait: 'Observe pending probe',
  'wait-queue': 'Observe pending canary',
  observe: 'Observe consumer',
  skip: 'Skip',
  blocked: 'Blocked',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const short = (id: string) => id.slice(0, 8);

/** "step 1", "steps 1 and 2", "steps 1, 2 and 4". */
function stepList(steps: number[]) {
  if (steps.length === 1) return `step ${steps[0]}`;
  return `steps ${steps.slice(0, -1).join(', ')} and ${steps[steps.length - 1]}`;
}
function blockerText(blocker: CompleteBlocker) {
  const list = stepList(blocker.steps);
  if (blocker.kind !== 'failed')
    return blocker.kind === 'admit'
      ? `To complete, admit ${list} first.`
      : `To complete, wait for ${list} to succeed.`;
  return `${list[0].toUpperCase()}${list.slice(1)} ended ${blocker.status}. The run can no longer pass; review a new run.`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={status === 'passed' ? 'default' : status === 'pending' ? 'secondary' : 'outline'}
    >
      {STATUS[status] ?? status}
    </Badge>
  );
}

/** Messages by `ApiError.code` (faas pkg/apid/bindings/verification_runs.go:299-330). */
function explain(error: unknown, context: 'review' | 'create' | 'run'): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'binding_verification_run_changed':
        if (context === 'review')
          // validVerificationRunInventory, faas bindings/verification_runs.go:102-104,
          // and the selected-deployment check in verification_reviews.go:62-67.
          return 'No plan could be reviewed. A run needs an enforced release policy (revision 1 or later) in the deployment’s scope, a complete binding inventory with no issues, the deployment you named to be the one under verification (leave the field empty for the live deployment), and an instance of that deployment started since its configuration last changed.';
        if (context === 'create') return 'The plan changed since you reviewed it. Review again.';
        return 'The reviewed plan, policy, configuration, deadline or evidence changed. Check the diagnostics, then review a new run.';
      case 'binding_verification_budget_full':
        return 'This run’s admission budget is full. Wait for an unfinished probe or canary to settle, then admit again.';
      case 'binding_verification_run_limit':
        return `This app already has ${RUN_MAX_ACTIVE} unfinished runs. Cancel one or wait for it to expire.`;
      case 'plan_queue_depth':
        return 'The app’s queue is at its plan depth limit, so no canary can be published now.';
      case 'email_verification_required':
        return 'Verify your email address before starting verification work.';
      case 'insufficient_scope':
        return 'This needs read access to every reviewed binding domain, including PostgreSQL and object storage.';
      case 'validation_failed':
        return context === 'create'
          ? 'The server refused the run: check the lifetime, concurrency and the consent the plan needs.'
          : errorMessage(error);
      case 'not_found':
        return 'The run or its deployment is no longer available.';
    }
  }
  return errorMessage(error);
}

/**
 * Durable single-app verification runs (faas ADR-1355). The server freezes a
 * reviewed plan and records what each step admitted, but it has no background
 * controller: the person here admits each step and asks for completion.
 */
export function BindingVerificationRuns({ slug }: { slug: string }) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const list = useVerificationRuns(accountId, slug);
  const [selected, setSelected] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const rows = list.data?.pages.flatMap((page) => page.runs) ?? [];
  const phase = queryPhase({
    error: list.error,
    loading: list.isLoading,
    isEmpty: rows.length === 0,
  });

  return (
    <Panel
      title="Binding verification runs"
      description="A run freezes a reviewed plan for one deployment and records each probe and canary message it starts. The server never starts them on its own: admit each step, then complete the run. The CLI’s durable verify does the same."
      actions={
        !reviewing && (
          <Button size="sm" variant="outline" onClick={() => setReviewing(true)}>
            Review a new run
          </Button>
        )
      }
    >
      <div className="space-y-5 text-sm">
        {reviewing && (
          <ReviewNewRun
            slug={slug}
            onClose={() => setReviewing(false)}
            onCreated={(id) => {
              setReviewing(false);
              setSelected(id);
            }}
          />
        )}
        <InlinePhase
          phase={phase}
          error={list.error}
          loadingMessage="Loading verification runs…"
          emptyMessage="No verification runs are retained for this app."
          onRetry={() => void list.refetch()}
        />
        {phase === 'ready' && (
          <>
            <ul
              aria-label="Verification runs"
              className="divide-y divide-border rounded-lg border border-border"
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
                      {when(row.created_at)}
                      {row.scope ? ` · ${row.scope}` : ''}
                      {row.deployment_id ? ` · deployment ${short(row.deployment_id)}` : ''}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Open run ${short(row.id)}`}
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
              The list shows stored state. Open a run to recheck it against current evidence.
            </p>
          </>
        )}
        {selected && <RunDetail key={selected} slug={slug} runId={selected} />}
      </div>
    </Panel>
  );
}

// --- Detail -----------------------------------------------------------------

function RunDetail({ slug, runId }: { slug: string; runId: string }) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const run = useVerificationRun(accountId, slug, runId);
  const diagnostics = useRunDiagnostics(accountId, slug, runId, run.data?.status === 'pending');
  const refresh = useRunWrites(accountId, slug);
  const confirm = useConfirm();
  const [notice, setNotice] = useState<ReactNode>(null);
  const [completeConflict, setCompleteConflict] = useState(false);
  const phase = queryPhase({ error: run.error, loading: run.isLoading });

  const act = useMutation({
    mutationFn: (action: RunAction) => {
      setCompleteConflict(false);
      return runAction(slug, runId, action);
    },
    onSuccess: (result, action) => {
      if (action === 'complete' && result.status === 'pending' && result.qualification) {
        setNotice(
          <div role="status" className="space-y-1">
            <p>Not passed yet. These readiness conditions are still settling:</p>
            <ul className="list-disc pl-5">
              {result.qualification.conditions.map((c, i) => (
                <li key={i} className="break-all">
                  <span className="font-mono">{c.code}</span>
                  {c.name ? ` · ${c.name}` : ''}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Complete again before the run expires; nothing new was admitted.
            </p>
          </div>
        );
      } else if (action === 'resume') {
        setNotice(<p role="status">The original review still holds.</p>);
      } else setNotice(null);
    },
    onError: (error, action) => {
      // Complete's 409 means different things by step state, which the
      // refetch below brings in; it is explained from the run as rendered.
      if (
        action === 'complete' &&
        error instanceof ApiError &&
        error.code === 'binding_verification_run_changed'
      ) {
        setNotice(null);
        setCompleteConflict(true);
      } else setNotice(<p role="alert">{explain(error, 'run')}</p>);
    },
    onSettled: refresh,
  });
  const admit = useMutation({
    mutationFn: (index: number) => admitStep(slug, runId, index),
    onSuccess: () => setNotice(null),
    onError: (error) => setNotice(<p role="alert">{explain(error, 'run')}</p>),
    onSettled: refresh,
  });

  async function requestAdmit(step: VerificationRunStep, index: number) {
    const plan = step.plan;
    if (plan.action === 'queue-canary') {
      const ok = await confirm({
        title: `Publish a canary message to ${plan.binding || plan.name}?`,
        description:
          'One reserved canary message goes through this push queue binding to the deployment’s consumer, which must handle it safely. It uses normal queue capacity and changes no traffic.',
        confirmLabel: 'Publish',
      });
      if (!ok) return;
    } else if (plan.type === 'object_storage' && plan.probe_mode && plan.probe_mode !== 'read') {
      const ok = await confirm({
        title: `Write a disposable object under ${plan.prefix ?? plan.binding}?`,
        description:
          'The probe uploads a test object with this binding’s credentials and then deletes it.',
        confirmLabel: 'Admit probe',
      });
      if (!ok) return;
    }
    admit.mutate(index);
  }

  async function cancel() {
    const ok = await confirm({
      title: 'Cancel this verification run?',
      description:
        'Blocks further admissions and cancels the unfinished probes and canary messages this run started. A handler already running may still finish. Evidence that already succeeded is kept.',
      confirmLabel: 'Cancel run',
      destructive: true,
    });
    if (ok) act.mutate('cancel');
  }

  const data = run.data;
  const blockersByStep = new Map<number, string[]>();
  for (const blocker of diagnostics.data?.blockers ?? [])
    if (blocker.step_index !== undefined)
      blockersByStep.set(blocker.step_index, [
        ...(blockersByStep.get(blocker.step_index) ?? []),
        blocker.message,
      ]);
  const busy = act.isPending || admit.isPending;
  const blocker = data ? completeBlocker(data) : null;

  return (
    <section
      aria-label={`Run ${short(runId)}`}
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <InlinePhase
        phase={phase}
        error={run.error}
        loadingMessage="Checking the run against current evidence…"
        onRetry={() => void run.refetch()}
      />
      {phase === 'ready' && data && (
        <>
          <RunHeader run={data} />
          {data.status === 'passed' && (
            <p className="text-xs text-muted-foreground">
              Passed is an observation at the last check. It moves no traffic: promotion still
              rechecks policy and evidence when traffic changes.
            </p>
          )}
          <ol aria-label="Steps" className="divide-y divide-border rounded-lg border border-border">
            {data.steps.map((step, index) => (
              <StepRow
                key={index}
                index={index}
                step={step}
                blockers={blockersByStep.get(index) ?? []}
                admittable={stepAdmittable(data, step)}
                busy={busy}
                onAdmit={() => void requestAdmit(step, index)}
              />
            ))}
          </ol>
          {notice}
          {data.status === 'pending' && blocker && (
            <p role="status" className="text-xs">
              {blockerText(blocker)}
            </p>
          )}
          {data.status === 'pending' && completeConflict && !blocker && (
            <p role="alert">
              Every step succeeded, but the final policy check is blocked: the policy, configuration
              or evidence may have changed since the review. Check the diagnostics below; if they
              show the review changed, review a new run.
            </p>
          )}
          {data.status === 'pending' && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || blocker !== null}
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
                Cancel run
              </Button>
            </div>
          )}
          {data.status === 'pending' && (
            <p className="text-xs text-muted-foreground">
              Complete passes only when every step this run admitted succeeded and a fresh policy
              check passes. Recheck confirms the original review still holds; neither extends the
              deadline.
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

function RunHeader({ run }: { run: VerificationRun }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={run.status} />
        <span className="font-mono text-xs break-all">{run.id}</span>
      </div>
      {run.reason && <p className="text-xs text-muted-foreground">Reason: {run.reason}</p>}
      <p className="text-xs text-muted-foreground">
        Deployment <span className="font-mono">{short(run.deployment_id)}</span> in {run.scope} ·
        policy revision {run.policy.revision} · created {when(run.created_at)} · expires{' '}
        {when(run.expires_at)}
      </p>
      <p className="text-xs text-muted-foreground">
        Up to {run.max_concurrency ?? RUN_DEFAULT_CONCURRENCY} unfinished resources at once · queue
        publication {run.queue_publish ? 'consented' : 'not consented'} · storage writes{' '}
        {run.object_storage_write ? 'consented' : 'not consented'}
      </p>
    </div>
  );
}

function bindingLabel(plan: VerificationPlanStep) {
  if (!plan.name) return `${plan.type} · hidden without access to this binding domain`;
  const binding = plan.binding && plan.binding !== plan.name ? ` (${plan.binding})` : '';
  return `${plan.type} · ${plan.name}${binding}`;
}

function StepRow({
  index,
  step,
  blockers,
  admittable,
  busy,
  onAdmit,
}: {
  index: number;
  step: VerificationRunStep;
  blockers: string[];
  admittable: boolean;
  busy: boolean;
  onAdmit: () => void;
}) {
  return (
    <li className="space-y-1 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">{index + 1}.</span>
          <span className="min-w-0 break-all font-medium">{bindingLabel(step.plan)}</span>
          <Badge variant="outline">{ACTION[step.plan.action] ?? step.plan.action}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{step.status}</span>
        </div>
        {admittable && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            aria-label={`Admit step ${index + 1}`}
            onClick={onAdmit}
          >
            Admit
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{stepExplanation(step)}</p>
      {step.resource_id && (
        <p className="text-xs text-muted-foreground">
          {step.resource_kind === 'queue' ? 'Canary' : 'Task'}{' '}
          <span className="font-mono">{step.resource_id}</span>
          {step.owned ? ' · started by this run' : ' · reused from earlier work'}
        </p>
      )}
      {blockers.map((message) => (
        <p key={message} className="text-xs" style={{ color: 'var(--status-warning)' }}>
          {message}
        </p>
      ))}
    </li>
  );
}

function Diagnostics({
  phase,
  error,
  data,
  onRetry,
}: {
  phase: ReturnType<typeof queryPhase>;
  error: unknown;
  data: VerificationDiagnostics | undefined;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="label-mono text-foreground">Diagnostics</h3>
      <InlinePhase
        phase={phase}
        error={error}
        loadingMessage="Loading diagnostics…"
        onRetry={onRetry}
      />
      {phase === 'ready' && data && (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            Checked {when(data.checked_at)}.{' '}
            {data.check_passed === undefined
              ? 'The current policy check was not evaluated.'
              : data.check_passed
                ? 'Current evidence satisfies the current policy.'
                : 'Current evidence does not yet satisfy the current policy.'}{' '}
            {!data.complete && 'Some reads failed; retry for a full picture.'}
          </p>
          {data.budget && (
            <p className="text-muted-foreground tabular-nums">
              {data.budget.active_resources} of {data.budget.max_concurrency} unfinished resources
              in use · {data.budget.waiting_steps} steps waiting
              {data.budget.full ? ' · budget full' : ''}
            </p>
          )}
          {data.blockers.filter((b) => b.step_index === undefined).length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {data.blockers
                .filter((b) => b.step_index === undefined)
                .map((b, i) => (
                  <li key={i}>
                    {b.message} <span className="font-mono text-muted-foreground">{b.code}</span>
                  </li>
                ))}
            </ul>
          )}
          {data.changes.length > 0 && (
            <div>
              <p className="text-muted-foreground">Changed since review:</p>
              <ul className="list-disc space-y-1 pl-5">
                {data.changes.map((c, i) => (
                  <li key={i} className="break-all">
                    {c.name ? `${c.name} ` : ''}
                    <span className="font-mono">{c.field}</span>: {c.reviewed} → {c.current}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.recovery.length > 0 && (
            <div>
              <p className="text-muted-foreground">
                Suggested next steps (nothing runs on its own):
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {data.recovery.map((r, i) => (
                  <li key={i}>{r.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Review and create ------------------------------------------------------

function ReviewNewRun({
  slug,
  onClose,
  onCreated,
}: {
  slug: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { account } = useAuth();
  const refresh = useRunWrites(account?.id ?? '', slug);
  const [deployment, setDeployment] = useState('');
  const review = useMutation({
    mutationFn: () => reviewVerification(slug, deployment.trim() || undefined),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    review.mutate();
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Deployment ID (leave empty for the live deployment)
          </span>
          <Input
            aria-label="Deployment ID"
            value={deployment}
            onChange={(e) => setDeployment(e.target.value)}
            className="w-80 max-w-full font-mono"
          />
        </label>
        <Button type="submit" size="sm" disabled={review.isPending}>
          {review.isPending ? 'Reviewing…' : 'Review plan'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        A review only reads: it creates no run, runs no probe and publishes no message.
      </p>
      {review.error && <p role="alert">{explain(review.error, 'review')}</p>}
      {review.data && (
        <ReviewResult
          key={review.data.reviewed_at}
          slug={slug}
          review={review.data}
          onCreated={(id) => {
            refresh();
            onCreated(id);
          }}
        />
      )}
    </div>
  );
}

function ReviewResult({
  slug,
  review,
  onCreated,
}: {
  slug: string;
  review: VerificationReview;
  onCreated: (id: string) => void;
}) {
  const [ttl, setTtl] = useState(String(RUN_MAX_TTL_SECONDS));
  const [concurrency, setConcurrency] = useState(String(RUN_DEFAULT_CONCURRENCY));
  const [queuePublish, setQueuePublish] = useState(false);
  const [storageWrite, setStorageWrite] = useState(false);
  const [id] = useState(() => crypto.randomUUID());
  const create = useMutation({
    mutationFn: () =>
      createVerificationRun(slug, {
        id,
        deployment_id: review.deployment_id,
        review_digest: review.review_digest,
        ...(Object.keys(review.service_targets).length
          ? { service_targets: review.service_targets }
          : {}),
        ttl_seconds: Number(ttl),
        max_concurrency: Number(concurrency),
        queue_publish: queuePublish,
        object_storage_write: storageWrite,
      }),
    onSuccess: (run) => onCreated(run.id),
  });
  const ttlValid = /^\d+$/.test(ttl) && Number(ttl) >= 1 && Number(ttl) <= RUN_MAX_TTL_SECONDS;
  const concurrencyValid =
    /^\d+$/.test(concurrency) &&
    Number(concurrency) >= 1 &&
    Number(concurrency) <= RUN_MAX_CONCURRENCY;
  const consented =
    (!review.queue_publish_required || queuePublish) &&
    (!review.object_storage_write_required || storageWrite);

  return (
    <section aria-label="Reviewed plan" className="space-y-3">
      <p>
        Deployment <span className="font-mono">{short(review.deployment_id)}</span> in{' '}
        {review.scope} · policy revision {review.policy.revision} · reviewed{' '}
        {when(review.reviewed_at)}
      </p>
      {review.blockers.length > 0 && (
        <ul role="alert" className="list-disc space-y-1 pl-5">
          {review.blockers.map((b, i) => (
            <li key={i}>
              {b.message} <span className="font-mono text-xs text-muted-foreground">{b.code}</span>
            </li>
          ))}
        </ul>
      )}
      {review.plan.length > 0 && (
        <ol aria-label="Planned steps" className="list-decimal space-y-1 pl-5 text-xs">
          {review.plan.map((step, i) => (
            <li key={i}>
              {bindingLabel(step)} · {ACTION[step.action] ?? step.action}
              {step.reason ? ` (${step.reason})` : ''}
            </li>
          ))}
        </ol>
      )}
      {review.ready ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Lifetime (1–600 seconds)</span>
              <Input
                aria-label="Lifetime in seconds"
                inputMode="numeric"
                value={ttl}
                onChange={(e) => setTtl(e.target.value)}
                className="w-28"
                aria-invalid={!ttlValid || undefined}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Unfinished at once (1–8)</span>
              <Input
                aria-label="Concurrency"
                inputMode="numeric"
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
                className="w-28"
                aria-invalid={!concurrencyValid || undefined}
              />
            </label>
          </div>
          {review.queue_publish_required && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={queuePublish}
                onChange={(e) => setQueuePublish(e.target.checked)}
              />
              <span>
                Publish queue canary messages
                <span className="block text-xs text-muted-foreground">
                  The plan sends one reserved message per queue step to the consumer.
                </span>
              </span>
            </label>
          )}
          {review.object_storage_write_required && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={storageWrite}
                onChange={(e) => setStorageWrite(e.target.checked)}
              />
              <span>
                Write disposable objects to object storage
                <span className="block text-xs text-muted-foreground">
                  Write probes upload a test object and delete it.
                </span>
              </span>
            </label>
          )}
          {create.error && <p role="alert">{explain(create.error, 'create')}</p>}
          <Button
            size="sm"
            disabled={!consented || !ttlValid || !concurrencyValid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Create run'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Creating records the plan and admits nothing. You admit each step from the run.
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">
          This plan is not ready, so no run can be created from it. Resolve the blockers and review
          again.
        </p>
      )}
    </section>
  );
}
