import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle, Circle, Pause, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, Textarea } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { CliCommand } from '@/components/dashboard/cli-command';
import { InlinePhase, Panel, StatTile, queryPhase } from '@/components/dashboard/primitives';
import { ProblemHelp } from '@/components/dashboard/problem-help';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  previewRecoveryPolicyChange,
  useControlRecoveryPolicy,
  useRecoveryPolicy,
  useRecoveryPolicyHealth,
  useSetRecoveryPolicy,
  type RecoveryPolicy,
  type RecoveryPolicyChangePreview,
  type RecoveryPolicyHealth,
  type RecoveryPolicyState,
} from '@/lib/api/workflow-automation';

/**
 * App › Automate › Recovery policy (capability `workflow-recovery`, beta):
 * whether apid prepares recovery plans for failed workflow runs, and whether
 * it may retry them by itself within budgets
 * (faas docs/automation-authoring.md "Preview recovery policies").
 *
 * The policy is replaced whole and fenced to the version read; the change is
 * previewed first, because a replacement suppresses older pending automatic
 * retries. Reviewing and applying the plans it prepares stays in the CLI.
 */
export function RecoveryPolicyBody({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability="workflow-recovery" title="Recovery policy">
      <Recovery slug={slug} />
    </CapabilityGate>
  );
}

type Mode = RecoveryPolicy['mode'];
type Trigger = RecoveryPolicy['triggers'][number];
type FailureStatus = RecoveryPolicy['failure_statuses'][number];

const MODES: { key: Mode; label: string; hint: string }[] = [
  {
    key: 'preview',
    label: 'Prepare plans for review',
    hint: 'Prepares recovery plans from failed runs. Nothing runs until someone approves and applies a plan.',
  },
  {
    key: 'automatic_retry',
    label: 'Retry saved failures automatically',
    hint: 'Retries failures that a recovery job saved, one at a time, within the execution budget. Pauses after repeated failed retries.',
  },
  {
    key: 'automatic_initial',
    label: 'Recover first failures automatically',
    hint: 'Recovers runs on their first failure, within the execution budget. Needs the workflow runtime.',
  },
];

const TRIGGERS: { key: Trigger; label: string }[] = [
  { key: 'saved_failure', label: 'A recovery job saved a failure' },
  { key: 'stalled', label: 'A recovery stalled' },
  { key: 'deadline_exceeded', label: 'A recovery passed its deadline' },
  { key: 'initial_failure', label: 'A run failed for the first time' },
];

/** The single trigger each automatic mode allows (pkg/api/workflow_recovery_policy.go:157). */
const AUTOMATIC_TRIGGER: Partial<Record<Mode, Trigger>> = {
  automatic_retry: 'saved_failure',
  automatic_initial: 'initial_failure',
};

const POLICY_STATUS: Record<
  RecoveryPolicyState['status'],
  { label: string; color: string; icon: typeof CheckCircle; text: string }
> = {
  disabled: {
    label: 'Off',
    color: 'var(--chart-muted)',
    icon: Circle,
    text: 'The policy prepares nothing.',
  },
  monitoring: {
    label: 'Watching',
    color: 'var(--status-good)',
    icon: CheckCircle,
    text: 'The scheduler evaluates matching failures every minute.',
  },
  review_limit: {
    label: 'Review limit',
    color: 'var(--status-warning)',
    icon: WarningTriangle,
    text: '1,000 reviews are retained, so no new plan is prepared until retention frees room.',
  },
  paused: {
    label: 'Paused',
    color: 'var(--status-warning)',
    icon: Pause,
    text: 'Automatic retries are paused. Prepared retries are kept and committed ones continue.',
  },
};

const HEALTH: Record<RecoveryPolicyHealth['status'], { label: string; color: string }> = {
  healthy: { label: 'No blocker seen', color: 'var(--status-good)' },
  inactive: { label: 'Inactive', color: 'var(--chart-muted)' },
  paused: { label: 'Paused', color: 'var(--status-warning)' },
  blocked: { label: 'Blocked', color: 'var(--status-warning)' },
  stalled: { label: 'Stalled', color: 'var(--status-critical)' },
  unknown: { label: 'Unknown', color: 'var(--chart-muted)' },
};

export function Badge({
  label,
  color,
  icon: Icon,
}: {
  label: string;
  color: string;
  icon?: typeof CheckCircle;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs"
      style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
    >
      {Icon ? <Icon aria-hidden className="h-3 w-3" /> : null}
      {label}
    </span>
  );
}

const automatic = (mode: Mode) => mode === 'automatic_retry' || mode === 'automatic_initial';

function Recovery({ slug }: { slug: string }) {
  const stage = useCapabilityStage('workflow-recovery');
  const policy = useRecoveryPolicy(slug);
  const [editing, setEditing] = useState(false);
  const [controlling, setControlling] = useState<'pause' | 'resume' | null>(null);
  const current = policy.data;
  const p = current?.policy;
  const status = current ? POLICY_STATUS[current.status] : undefined;
  const auto = p ? p.enabled && automatic(p.mode) : false;
  const paused = Boolean(current?.automatic_execution?.paused_at);

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Recovery policy"
        actions={
          current && (
            <div className="flex flex-wrap gap-2">
              {auto && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setControlling(paused ? 'resume' : 'pause')}
                >
                  {paused ? 'Resume automatic recovery' : 'Pause automatic recovery'}
                </Button>
              )}
              <Button size="sm" onClick={() => setEditing(true)}>
                {current.version === 0 ? 'Set up policy' : 'Edit policy'}
              </Button>
            </div>
          )
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{`${stage ? `${stage} · ` : ''}What happens when a workflow run fails: prepare a recovery plan for review, or retry within budgets. Cancelling stays manual.`}</p>

        {!current || policy.error ? (
          <InlinePhase
            phase={queryPhase({ loading: policy.isPending, error: policy.error })}
            error={policy.error}
            loadingMessage="Loading the policy…"
            onRetry={() => void policy.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              {status && <Badge label={status.label} color={status.color} icon={status.icon} />}
              <span className="text-muted-foreground">{status?.text}</span>
            </div>
            {current.version === 0 ? (
              <p className="text-muted-foreground">
                No policy yet. Failed runs are left for you to resume or retry by hand.
              </p>
            ) : (
              p && (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Fact label="Mode">{MODES.find((m) => m.key === p.mode)?.label ?? p.mode}</Fact>
                  <Fact label="Workflows">{p.workflow_names.join(', ') || '—'}</Fact>
                  <Fact label="When">
                    {p.triggers
                      .map((t) => TRIGGERS.find((x) => x.key === t)?.label ?? t)
                      .join('; ')}
                  </Fact>
                  <Fact label="Failure statuses">{p.failure_statuses.join(', ') || 'Any'}</Fact>
                  <Fact label="Resumes per run">{`Up to ${p.max_resume_count}`}</Fact>
                  <Fact label="Cooldown">{formatDuration(p.cooldown_seconds)}</Fact>
                  <Fact label="Plans prepared per hour">{p.hourly_action_budget}</Fact>
                  {automatic(p.mode) && (
                    <>
                      <Fact label="Automatic retries per hour">
                        {p.hourly_execution_budget ?? '—'}
                      </Fact>
                      <Fact label="Pause after">{`${p.pause_after_failures ?? '—'} failed retries in a row`}</Fact>
                    </>
                  )}
                  <Fact label="Version">
                    {current.version}, updated <Timestamp value={current.updated_at} />
                  </Fact>
                  <Fact label="Last evaluated">
                    <Timestamp value={current.last_evaluation_at} />
                  </Fact>
                  <Fact label="Reason">{p.reason}</Fact>
                </dl>
              )
            )}
            {current.automatic_execution?.paused_at && (
              <p style={{ color: 'var(--status-warning)' }}>
                Paused <Timestamp value={current.automatic_execution.paused_at} />
                {current.automatic_execution.pause_reason
                  ? `: ${current.automatic_execution.pause_reason}`
                  : ''}
                . {current.automatic_execution.consecutive_failures} failed retries in a row.
              </p>
            )}
            {current.automatic_execution?.polling_failure && (
              <p style={{ color: 'var(--status-critical)' }}>
                The scheduler could not read this policy&apos;s work (
                <code className="font-mono text-xs">
                  {current.automatic_execution.polling_failure.code}
                </code>
                , {current.automatic_execution.polling_failure.attempts} attempts). It tries again{' '}
                <Timestamp value={current.automatic_execution.polling_failure.retry_at} />.
              </p>
            )}
          </div>
        )}
      </Panel>
      {current && current.version > 0 && <Health slug={slug} />}
      <Panel title="Reviewing prepared plans">
        <p className="mb-3 text-sm text-muted-foreground">
          Plans the policy prepares are approved, applied and followed in the CLI for now. The
          history lists each review with its decision and status.
        </p>
        <CliCommand
          command={`gregale automation recovery-policy history --app ${slug}`}
          copyLabel={`recovery policy history command for ${slug}`}
        />
      </Panel>
      {editing && current && (
        <PolicyDialog slug={slug} current={current} onClose={() => setEditing(false)} />
      )}
      {controlling && current && (
        <ControlDialog
          slug={slug}
          current={current}
          operation={controlling}
          onClose={() => setControlling(null)}
        />
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} d`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** Figures, not a chart: health is one snapshot of the automatic queue. */
function Health({ slug }: { slug: string }) {
  const q = useRecoveryPolicyHealth(slug);
  const h = q.data;
  const badge = h ? HEALTH[h.status] : undefined;
  return (
    <Panel title="Recovery health">
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {
          'A snapshot of the automatic retry queue. Advisory: it never releases a slot or starts a retry.'
        }
      </p>

      {!h ? (
        <InlinePhase
          phase={queryPhase({ loading: q.isPending, error: q.error })}
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="flex flex-wrap items-center gap-3 text-sm">
            {badge && <Badge label={badge.label} color={badge.color} />}
            <span className="text-muted-foreground">{h.reason.replaceAll('_', ' ')}</span>
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Waiting retries" value={String(h.queue.pending)} />
            <StatTile label="Retries without a result" value={String(h.queue.outstanding)} />
            <StatTile label="Retries this hour" value={String(h.queue.hourly_executions)} />
            <StatTile label="Budget left this hour" value={String(h.queue.remaining_budget)} />
          </div>
          {h.queue.cooldown_until && (
            <p className="text-sm text-muted-foreground">
              Cooling down until <Timestamp value={h.queue.cooldown_until} />.
            </p>
          )}
          {h.overview && (
            <p className="text-sm text-muted-foreground">
              Prepared plans awaiting approval: {h.overview.manual_awaiting_approval}. Approved
              without a result yet: {h.overview.manual_unresolved}. Needing attention:{' '}
              {h.overview.manual_attention}.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/* --- Edit ------------------------------------------------------------------- */

interface Draft {
  enabled: boolean;
  mode: Mode;
  workflows: string;
  triggers: Trigger[];
  statuses: FailureStatus[];
  maxResume: string;
  cooldown: string;
  hourlyActions: string;
  rate: string;
  hourlyExecutions: string;
  pauseAfter: string;
  alerts: boolean;
  stallAfter: string;
  alertAfter: string;
  reason: string;
}

function toDraft(p: RecoveryPolicy): Draft {
  return {
    enabled: p.enabled,
    mode: p.mode,
    workflows: p.workflow_names.join(', '),
    triggers: p.triggers.length ? p.triggers : ['saved_failure'],
    statuses: p.failure_statuses,
    maxResume: String(p.max_resume_count || 3),
    cooldown: String(p.cooldown_seconds || 300),
    hourlyActions: String(p.hourly_action_budget || 10),
    rate: String(p.rate_per_second || 1),
    hourlyExecutions: String(p.hourly_execution_budget || 3),
    pauseAfter: String(p.pause_after_failures || 2),
    alerts: p.health_alerts?.enabled ?? false,
    stallAfter: String(p.health_alerts?.stall_after_seconds ?? 900),
    alertAfter: String(p.health_alerts?.alert_after_seconds ?? 900),
    reason: p.reason,
  };
}

const int = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : NaN);
const within = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

/**
 * The policy apid would accept, or what is wrong with the draft — the same
 * rules as SetWorkflowRecoveryPolicyRequest.Validate (pkg/api/workflow_recovery_policy.go:144).
 */
export function draftToPolicy(d: Draft): { policy?: RecoveryPolicy; problems: string[] } {
  const problems: string[] = [];
  const names = d.workflows
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const auto = automatic(d.mode);
  const triggers = auto ? [AUTOMATIC_TRIGGER[d.mode]!] : d.triggers;
  if (names.length < 1 || names.length > 10) problems.push('Name 1 to 10 workflows.');
  if (new Set(names).size !== names.length) problems.push('A workflow is named twice.');
  if (names.some((n) => n.length > 256 || /[/\\]/.test(n)))
    problems.push('Workflow names cannot contain slashes or exceed 256 characters.');
  if (triggers.length < 1) problems.push('Choose at least one trigger.');
  if ((auto || triggers.includes('initial_failure')) && d.statuses.length === 0)
    problems.push('Choose which failure statuses count.');
  const maxResume = int(d.maxResume);
  const cooldown = int(d.cooldown);
  const hourly = int(d.hourlyActions);
  const rate = int(d.rate);
  if (!within(maxResume, 1, 16)) problems.push('Resumes per run must be 1 to 16.');
  if (!within(cooldown, 60, 604_800))
    problems.push('Cooldown must be 60 to 604,800 seconds (7 days).');
  if (!within(hourly, 1, 100)) problems.push('Plans per hour must be 1 to 100.');
  if (!within(rate, 1, 100)) problems.push('Rate must be 1 to 100 per second.');
  const executions = int(d.hourlyExecutions);
  const pauseAfter = int(d.pauseAfter);
  if (auto && !within(executions, 1, 100))
    problems.push('Automatic retries per hour must be 1 to 100.');
  if (auto && !within(pauseAfter, 1, 10)) problems.push('Pause after must be 1 to 10 failures.');
  const stall = int(d.stallAfter);
  const alertAfter = int(d.alertAfter);
  if (d.alerts && (!within(stall, 1, 86_400) || !within(alertAfter, 1, 86_400)))
    problems.push('Alert thresholds must be 1 to 86,400 seconds.');
  const reason = d.reason.trim();
  if (!reason || reason.length > 512) problems.push('Give a reason of up to 512 characters.');
  if (problems.length) return { problems };
  return {
    problems,
    policy: {
      enabled: d.enabled,
      mode: d.mode,
      workflow_names: names,
      triggers,
      failure_statuses: d.statuses,
      max_resume_count: maxResume,
      cooldown_seconds: cooldown,
      hourly_action_budget: hourly,
      rate_per_second: rate,
      reason,
      ...(auto ? { hourly_execution_budget: executions, pause_after_failures: pauseAfter } : {}),
      ...(d.alerts
        ? {
            health_alerts: {
              enabled: true,
              stall_after_seconds: stall,
              alert_after_seconds: alertAfter,
            },
          }
        : {}),
    },
  };
}

function conflictMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === 'conflict')
    return 'The policy changed since you opened it. Close this dialog to load the current version, then edit again.';
  if (err instanceof ApiError && err.code === 'workflow_deployment_unavailable')
    return 'Automatic first-failure recovery needs the workflow runtime, which is off on this installation.';
  return errorMessage(err);
}

function PolicyDialog({
  slug,
  current,
  onClose,
}: {
  slug: string;
  current: RecoveryPolicyState;
  onClose: () => void;
}) {
  const id = useId();
  const { toast } = useToast();
  const save = useSetRecoveryPolicy(slug);
  const [draft, setDraft] = useState<Draft>(() => toDraft(current.policy));
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState<RecoveryPolicyChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [reviews, setReviews] = useState(0);
  const outcome = useRef<HTMLDivElement>(null);
  const { policy, problems } = draftToPolicy(draft);
  // The outcome of Review change lands below a long form; bring it into view.
  // (Optional call: jsdom has no scrollIntoView.)
  useEffect(() => {
    if (reviews) outcome.current?.scrollIntoView?.({ block: 'nearest' });
  }, [reviews, preview, previewError]);
  const auto = automatic(draft.mode);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setPreview(null);
  };
  const toggle = <T extends string>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const review = async () => {
    setTouched(true);
    setReviews((n) => n + 1);
    if (!policy) return;
    setChecking(true);
    setPreviewError(null);
    try {
      setPreview(await previewRecoveryPolicyChange(slug, current.version, policy));
    } catch (err) {
      setPreviewError(err);
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    if (!policy || !preview) return;
    try {
      const saved = await save.mutateAsync({ expectedVersion: current.version, policy });
      toast({ kind: 'success', title: `Recovery policy saved as version ${saved.version}` });
      onClose();
    } catch {
      // Rendered below from save.error.
    }
  };

  const field = (
    key: keyof Draft,
    label: string,
    hint: string,
    extra: React.ComponentProps<typeof Input> = {}
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-${key}`} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={`${id}-${key}`}
        value={String(draft[key])}
        onChange={(e) => set(key, e.target.value as never)}
        inputMode="numeric"
        {...extra}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={current.version === 0 ? 'Set up a recovery policy' : 'Edit the recovery policy'}
      description={`Replaces version ${current.version} whole. Review the change before saving: a new version suppresses older pending automatic retries, and keeps work already applied.`}
      width="max-w-2xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" variant="outline" busy={checking} onClick={() => void review()}>
            Review change
          </Button>
          <Button
            size="sm"
            disabled={!preview || !policy}
            busy={save.isPending}
            onClick={() => void submit()}
          >
            Save policy
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void review();
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[color:var(--brand)]"
            checked={draft.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          Policy on
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-mode`} className="text-sm font-medium">
            What it does
          </label>
          <Select
            id={`${id}-mode`}
            value={draft.mode}
            onChange={(e) => set('mode', e.target.value as Mode)}
          >
            {MODES.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            {MODES.find((m) => m.key === draft.mode)?.hint}
          </p>
        </div>
        {field('workflows', 'Workflows', 'Exact names, comma-separated; 1 to 10.', {
          inputMode: 'text',
          spellCheck: false,
        })}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">When</legend>
          {TRIGGERS.map((t) => (
            <label key={t.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[color:var(--brand)]"
                checked={
                  auto ? AUTOMATIC_TRIGGER[draft.mode] === t.key : draft.triggers.includes(t.key)
                }
                disabled={auto}
                onChange={() => set('triggers', toggle(draft.triggers, t.key))}
              />
              {t.label}
            </label>
          ))}
          {auto && (
            <p className="text-xs text-muted-foreground">
              An automatic mode has exactly one trigger.
            </p>
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Failure statuses</legend>
          {(['failed', 'dead'] as const).map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[color:var(--brand)]"
                checked={draft.statuses.includes(s)}
                onChange={() => set('statuses', toggle(draft.statuses, s))}
              />
              {s === 'failed' ? 'Failed' : 'Dead'}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          {field(
            'maxResume',
            'Resumes per run',
            'Total resumes of a run, manual ones included; 1 to 16.'
          )}
          {field('cooldown', 'Cooldown (seconds)', 'Across the selected workflows; 60 to 604,800.')}
          {field(
            'hourlyActions',
            'Plans prepared per hour',
            'Preparing counts even if never applied; 1 to 100.'
          )}
          {field('rate', 'Rate per second', 'How fast a plan’s retries are admitted; 1 to 100.')}
          {auto &&
            field(
              'hourlyExecutions',
              'Automatic retries per hour',
              'Counted separately from preparing; 1 to 100.'
            )}
          {auto && field('pauseAfter', 'Pause after failed retries', 'In a row; 1 to 10.')}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[color:var(--brand)]"
            checked={draft.alerts}
            onChange={(e) => set('alerts', e.target.checked)}
          />
          Send health alerts to the app&apos;s webhooks
        </label>
        {draft.alerts && (
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              'stallAfter',
              'Stalled after (seconds)',
              'Scheduler evaluation overdue by; 1 to 86,400.'
            )}
            {field('alertAfter', 'Alert after (seconds)', 'Unhealthy for at least; 1 to 86,400.')}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-reason`} className="text-sm font-medium">
            Reason
          </label>
          <Textarea
            id={`${id}-reason`}
            value={draft.reason}
            onChange={(e) => set('reason', e.target.value)}
            rows={2}
            maxLength={512}
          />
          <p className="text-xs text-muted-foreground">Recorded with the version for the audit.</p>
        </div>
        <div ref={outcome} className="flex flex-col gap-4 empty:hidden">
          {touched && problems.length > 0 && (
            <ul
              role="alert"
              className="flex flex-col gap-1 text-xs"
              style={{ color: 'var(--status-critical)' }}
            >
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {previewError ? (
            <div role="alert" className="flex flex-col gap-1 text-sm">
              <span style={{ color: 'var(--status-critical)' }}>
                {conflictMessage(previewError)}
              </span>
              <ProblemHelp error={previewError} />
            </div>
          ) : null}
          {preview && <ChangeImpact preview={preview} />}
          {save.error && (
            <div role="alert" className="flex flex-col gap-1 text-sm">
              <span style={{ color: 'var(--status-critical)' }}>{conflictMessage(save.error)}</span>
              <ProblemHelp error={save.error} />
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}

function ChangeImpact({ preview }: { preview: RecoveryPolicyChangePreview }) {
  const prepared = preview.candidates.filter((c) => c.decision.outcome === 'would_prepare').length;
  return (
    <section
      aria-label="What saving changes"
      className="flex flex-col gap-2 well rounded-xl bg-muted/40 p-3 text-sm"
    >
      <h3 className="font-medium">Saving creates version {preview.next_version}</h3>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
        <li>
          {preview.pending_suppressed} pending automatic{' '}
          {preview.pending_suppressed === 1 ? 'retry is' : 'retries are'} suppressed;{' '}
          {preview.outstanding_retained} already applied{' '}
          {preview.outstanding_retained === 1 ? 'stays' : 'stay'}.
        </li>
        <li>
          Of the {preview.inspected_jobs} newest recovery jobs inspected
          {preview.jobs_truncated ? ' (more exist)' : ''}, matching failures:{' '}
          {preview.candidates.length}
          {preview.candidates_truncated ? ' (more not shown)' : ''}
          {preview.candidates.length ? `; ${prepared} would get a plan now` : ''}.
        </li>
        <li>
          {preview.remaining_preparation_budget} plans left this hour
          {preview.automatic_execution_enabled
            ? `, ${preview.remaining_execution_budget} automatic retries left`
            : '; automatic retries stay off'}
          .
        </li>
        {preview.initial_failures && (
          <li>
            Of {preview.initial_failures.inspected_failures} sampled first failures,{' '}
            {preview.initial_failures.eligible} qualify, {preview.initial_failures.would_prepare}{' '}
            would get a plan and {preview.initial_failures.would_submit} would start automatically.
          </li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground">
        Advisory: the queue can change before you save. Saving is refused if the policy changed.
      </p>
    </section>
  );
}

/* --- Pause and resume ------------------------------------------------------- */

function ControlDialog({
  slug,
  current,
  operation,
  onClose,
}: {
  slug: string;
  current: RecoveryPolicyState;
  operation: 'pause' | 'resume';
  onClose: () => void;
}) {
  const id = useId();
  const { toast } = useToast();
  const control = useControlRecoveryPolicy(slug);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const missing = !reason.trim();

  const submit = async () => {
    setTouched(true);
    if (missing) return;
    try {
      await control.mutateAsync({
        expected_version: current.version,
        expected_updated_at: current.updated_at,
        ...(current.automatic_execution?.paused_at
          ? { expected_paused_at: current.automatic_execution.paused_at }
          : {}),
        operation,
        reason: reason.trim(),
      });
      toast({
        kind: 'success',
        title: operation === 'pause' ? 'Automatic recovery paused' : 'Automatic recovery resumed',
      });
      onClose();
    } catch {
      // Rendered below.
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={operation === 'pause' ? 'Pause automatic recovery?' : 'Resume automatic recovery?'}
      description={
        operation === 'pause'
          ? 'No new automatic retry starts. Prepared retries are kept, and retries already started continue. The policy itself is unchanged.'
          : 'Automatic retries start again within the budgets, and the failed-retry streak resets to zero.'
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" busy={control.isPending} onClick={() => void submit()}>
            {operation === 'pause' ? 'Pause' : 'Resume'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-reason`} className="text-sm font-medium">
          Reason
        </label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={512}
          aria-invalid={touched && missing ? true : undefined}
        />
        {touched && missing && (
          <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
            Say why; it is recorded for the audit.
          </p>
        )}
        {control.error && (
          <div role="alert" className="mt-2 flex flex-col gap-1 text-sm">
            <span style={{ color: 'var(--status-critical)' }}>
              {conflictMessage(control.error)}
            </span>
            <ProblemHelp error={control.error} />
          </div>
        )}
      </div>
    </Modal>
  );
}
