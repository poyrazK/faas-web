import { useState } from 'react';
import { CheckCircle, Clock, Hourglass, Circle, XmarkCircle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, Select, Textarea } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  APPROVAL_LIMITS,
  APPROVAL_STATES,
  approvalPath,
  useApprovalPolicy,
  useDecideRelease,
  useReleaseApproval,
  useRemoveApprovalPolicy,
  useSetApprovalPolicy,
  useWaitingApprovals,
  type ApprovalPolicy,
  type ApprovalStatus,
} from '@/lib/api/release-approvals';
import { minutesLabel } from '@/lib/api/release-freezes';
import { cn } from '@/lib/utils';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ReleaseChannelPicker } from './release-channel-picker';

const STATE_STYLE: Record<ApprovalStatus['state'], { color: string; icon: typeof Clock }> = {
  not_required: { color: 'var(--muted-foreground)', icon: Circle },
  waiting: { color: 'var(--status-warning)', icon: Clock },
  approved: { color: 'var(--status-good)', icon: CheckCircle },
  rejected: { color: 'var(--status-critical)', icon: XmarkCircle },
  expired: { color: 'var(--status-serious)', icon: Hourglass },
};

export function ApprovalStateBadge({ state }: { state: ApprovalStatus['state'] }) {
  const { color, icon: Icon } = STATE_STYLE[state] ?? STATE_STYLE.not_required;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {APPROVAL_STATES[state] ?? state}
    </span>
  );
}

const approversLabel = (a: ApprovalPolicy['approvers']) =>
  a === 'developer' ? 'owners, admins and developers' : 'owners and admins';

/** Why a decision was refused, by code (release_approvals.go:345-406). */
function decisionFailure(
  err: unknown,
  app: string
): { kind: 'info' | 'error'; title: string; description?: string; error?: unknown } {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'release_approval_self':
        return {
          kind: 'error',
          title: 'You deployed this release',
          description: 'Its approval policy needs someone else to approve it.',
        };
      case 'release_approval_decided':
        return { kind: 'info', title: 'Decision not accepted', description: err.detail };
      case 'org_role_forbidden':
        return {
          kind: 'error',
          title: 'Your role cannot decide on this release',
          description: `The approval policy of ${app} names who may approve; ask one of them.`,
        };
      case 'release_approval_session_required':
        return {
          kind: 'error',
          title: 'Approve while signed in',
          description: 'An API key or token cannot approve; sign in again and retry.',
        };
    }
  }
  return { kind: 'error', title: 'Could not record your decision', error: err };
}

/**
 * One release's approvals: where it waits, who decided, and Approve or Reject.
 * `intent` comes from the Slack or email button and only prepares the action;
 * nothing is decided without a click and a confirmation.
 */
export function ReleaseApproval({
  deploymentId,
  release,
  intent,
}: {
  deploymentId: string;
  /** "v44" or a short id, for the confirmations. */
  release: string;
  intent?: 'approve' | 'reject';
}) {
  const status = useReleaseApproval(deploymentId);
  const decide = useDecideRelease();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [comment, setComment] = useState('');
  const [rejecting, setRejecting] = useState(intent === 'reject');
  const [tried, setTried] = useState(false);
  const data = status.data;
  const phase = queryPhase({ error: status.error, loading: status.isPending });
  if (phase !== 'ready' || !data)
    return (
      <InlinePhase
        phase={phase}
        error={status.error}
        loadingMessage="Reading the release’s approvals…"
        onRetry={() => void status.refetch()}
      />
    );
  const commentProblem =
    comment.length > APPROVAL_LIMITS.comment
      ? `At most ${APPROVAL_LIMITS.comment} characters.`
      : rejecting && !comment.trim()
        ? 'A rejection needs a reason; it is sent to everyone told about the release.'
        : undefined;

  const send = async (decision: 'approve' | 'reject') => {
    setTried(true);
    if (decision === 'reject' && !rejecting) {
      setRejecting(true);
      return;
    }
    if (decision === 'reject' ? commentProblem : comment.length > APPROVAL_LIMITS.comment) return;
    const remaining = Math.max((data.required_approvals ?? 1) - data.approvals, 0);
    const ok = await confirm(
      decision === 'approve'
        ? {
            title: `Approve ${data.app} ${release}?`,
            description: `Your approval counts toward the ${data.required_approvals ?? 1} the policy needs (${remaining} still missing). Once enough people approve, the rollout continues past stage ${data.after_stage ?? 1} on its next step and the release takes more production traffic. An approved release can no longer be rejected; abort its rollout to stop it.`,
            confirmLabel: 'Approve release',
          }
        : {
            title: `Reject ${data.app} ${release}?`,
            description: `The rollout is aborted at once and the release serving before it takes its traffic back. A rejection is final: shipping this change again needs a new deploy. Your reason, “${comment.trim()}”, is recorded and sent to the policy’s channels.`,
            confirmLabel: 'Reject release',
            destructive: true,
          }
    );
    if (!ok) return;
    try {
      const next = await decide.mutateAsync({
        id: deploymentId,
        decision,
        comment: comment.trim() || undefined,
      });
      setComment('');
      setRejecting(false);
      setTried(false);
      toast({
        kind: 'success',
        title: decision === 'approve' ? 'Approved' : 'Rejected',
        description:
          decision === 'reject'
            ? 'The rollout is being aborted.'
            : next.state === 'approved'
              ? 'The rollout continues on its next step.'
              : `${Math.max((next.required_approvals ?? 1) - next.approvals, 0)} more approval(s) needed.`,
      });
    } catch (err) {
      toast(decisionFailure(err, data.app));
    }
  };

  return (
    <section aria-label="Release approval" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ApprovalStateBadge state={data.state} />
          {data.state !== 'not_required' && (
            <span>
              {data.approvals} of {data.required_approvals ?? 1} approvals
            </span>
          )}
        </p>
        {data.state !== 'not_required' && (
          <p className="text-xs text-muted-foreground">
            Waits at canary stage {data.after_stage ?? 1}
            {data.deployed_by && ` · deployed by ${data.deployed_by}`}
            {data.waiting_since && (
              <>
                {' · waiting since '}
                <Timestamp value={data.waiting_since} />
              </>
            )}
            {data.expires_at && data.state === 'waiting' && (
              <>
                {' · aborts '}
                <Timestamp value={data.expires_at} mode="absolute" /> unless approved
              </>
            )}
          </p>
        )}
        {data.state === 'not_required' && (
          <p className="text-xs text-muted-foreground">
            The app does not require approvals for this release.
          </p>
        )}
      </div>
      {data.decisions.length > 0 && (
        <ul aria-label="Decisions" className="flex flex-col gap-1.5 text-xs">
          {data.decisions.map((d) => (
            <li
              key={`${d.approver}-${d.decided_at}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
            >
              {d.decision === 'approve' ? (
                <span
                  className="inline-flex items-center gap-1"
                  style={{ color: 'var(--status-good)' }}
                >
                  <CheckCircle aria-hidden className="h-3.5 w-3.5" /> Approved
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1"
                  style={{ color: 'var(--status-critical)' }}
                >
                  <XmarkCircle aria-hidden className="h-3.5 w-3.5" /> Rejected
                </span>
              )}
              <span className="font-medium">{d.approver}</span>
              <span className="text-muted-foreground">{d.role}</span>
              {d.decision === 'approve' && !d.counted && (
                <span className="text-muted-foreground">
                  (not counted: the deployer’s own approval)
                </span>
              )}
              {d.comment && <span className="text-muted-foreground">“{d.comment}”</span>}
              <Timestamp value={d.decided_at} className="text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
      {data.state === 'waiting' && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">
              {rejecting ? 'Reason for rejecting' : 'Comment (optional)'}
            </span>
            <Textarea
              rows={2}
              value={comment}
              maxLength={APPROVAL_LIMITS.comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={rejecting ? 'checkout latency is up' : 'canary looks clean'}
              aria-invalid={Boolean(tried && commentProblem) || undefined}
              aria-describedby={
                tried && commentProblem ? `approval-comment-${deploymentId}` : undefined
              }
            />
          </label>
          {tried && commentProblem && (
            <FieldError id={`approval-comment-${deploymentId}`}>{commentProblem}</FieldError>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={intent === 'reject' ? 'outline' : 'default'}
              busy={decide.isPending}
              onClick={() => void send('approve')}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending}
              onClick={() => void send('reject')}
            >
              {rejecting ? 'Reject release' : 'Reject'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Your organization role, MFA and the self-approval rule apply as in the CLI. A rejection
            is final and aborts the rollout.
          </p>
        </div>
      )}
    </section>
  );
}

/** The app's releases waiting for approval, each linking to its approval page. */
export function WaitingApprovals({ slug }: { slug: string }) {
  const waiting = useWaitingApprovals(slug);
  const rows = waiting.data ?? [];
  const phase = queryPhase({
    error: waiting.error,
    loading: waiting.isPending,
    isEmpty: rows.length === 0,
  });
  if (phase !== 'ready')
    return (
      <InlinePhase
        phase={phase}
        error={waiting.error}
        loadingMessage="Reading releases waiting for approval…"
        emptyMessage="No release is waiting for approval."
        onRetry={() => void waiting.refetch()}
      />
    );
  return (
    <ul aria-label="Waiting for approval" className="divide-y divide-border">
      {rows.map((s) => (
        <li
          key={s.deployment_id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-x-3 text-sm">
              <ApprovalStateBadge state={s.state} />
              <span className="font-mono text-xs">{s.deployment_id.slice(0, 8)}</span>
              <span>
                {s.approvals} of {s.required_approvals ?? 1}
              </span>
            </p>
            {s.expires_at && (
              <p className="text-xs text-muted-foreground">
                {s.state === 'expired' ? 'Timed out ' : 'Aborts '}
                <Timestamp value={s.expires_at} mode="absolute" />
                {s.deployed_by && ` · deployed by ${s.deployed_by}`}
              </p>
            )}
          </div>
          <a
            className="text-xs text-brand underline-offset-4 hover:underline"
            href={approvalPath(s.deployment_id)}
          >
            Review and decide
          </a>
        </li>
      ))}
    </ul>
  );
}

function policyFailure(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'plan_traffic_split_not_allowed':
        return 'Approvals wait in a canary stage, and canaries need the Pro or Scale plan.';
      case 'org_role_forbidden':
        return 'Only the organization’s owners and admins change an app’s approval policy.';
      case 'conflict':
        return (
          err.detail ??
          'The app releases without a canary; set its release policy to safe or fast first.'
        );
    }
  }
  return errorMessage(err);
}

type Draft = {
  required: number;
  stage: number;
  timeout: number;
  approvers: ApprovalPolicy['approvers'];
  self: boolean;
  notify: string[];
};
const draftOf = (p: ApprovalPolicy | null): Draft => ({
  required: p?.required_approvals ?? 1,
  stage: p?.after_stage ?? 1,
  timeout: p?.timeout_minutes ?? 1440,
  approvers: p?.approvers ?? 'admin',
  self: p?.allow_self_approval ?? false,
  notify: p?.notify_channels ?? [],
});
const inRange = (n: number, [lo, hi]: readonly [number, number]) =>
  Number.isInteger(n) && n >= lo && n <= hi;

/**
 * The app's approval policy and the releases waiting for it. Changing or
 * removing it needs the admin scope and, in an organization, an owner or
 * admin. Mount it behind the `release-approvals` capability.
 */
export function ReleaseApprovals({ slug }: { slug: string }) {
  const policy = useApprovalPolicy(slug);
  const stage = useCapabilityStage('release-approvals');
  const save = useSetApprovalPolicy(slug);
  const remove = useRemoveApprovalPolicy(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [failure, setFailure] = useState('');
  const [tried, setTried] = useState(false);
  const current = policy.data ?? null;
  const phase = queryPhase({ error: policy.error, loading: policy.isPending });

  const errors = {
    required: inRange(draft.required, APPROVAL_LIMITS.required) ? undefined : 'From 1 to 5 people.',
    stage: inRange(draft.stage, APPROVAL_LIMITS.stage) ? undefined : 'A stage from 1 to 10.',
    timeout: inRange(draft.timeout, APPROVAL_LIMITS.timeoutMinutes)
      ? undefined
      : 'From 10 minutes to 7 days (10080 minutes).',
    notify: draft.notify.length
      ? undefined
      : 'Name at least one channel, so approvers learn a release waits.',
  };
  const invalid = Object.values(errors).some(Boolean);

  const start = () => {
    setDraft(draftOf(current));
    setFailure('');
    setTried(false);
    setEditing(true);
  };

  const submit = async () => {
    setTried(true);
    if (invalid || save.isPending) return;
    const ok = await confirm({
      title: `${current ? 'Change' : 'Require'} release approvals for ${slug}?`,
      description: `Each production release of ${slug} then waits at canary stage ${draft.stage} until ${draft.required} ${approversLabel(draft.approvers)}${draft.self ? '' : ' other than the deployer'} approve it, and is aborted after ${minutesLabel(draft.timeout)} without them. Releases without a canary are refused (release_approval_canary_required). ${draft.notify.join(', ')} hear when a release waits, is decided or times out.`,
      confirmLabel: current ? 'Save policy' : 'Require approvals',
    });
    if (!ok) return;
    setFailure('');
    try {
      await save.mutateAsync({
        required_approvals: draft.required,
        after_stage: draft.stage,
        timeout_minutes: draft.timeout,
        approvers: draft.approvers,
        allow_self_approval: draft.self,
        notify_channels: draft.notify,
      });
      toast({ kind: 'success', title: 'Approval policy saved' });
      setEditing(false);
    } catch (err) {
      setFailure(policyFailure(err));
    }
  };

  const onRemove = async () => {
    const ok = await confirm({
      title: `Stop requiring approvals for ${slug}?`,
      description: `Production releases of ${slug} no longer wait for anyone. Releases waiting for approval now continue on the canary’s next step and take more traffic.`,
      confirmLabel: 'Remove policy',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync();
      toast({ kind: 'success', title: 'Approvals no longer required' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'release_approval_policy_not_found')
        toast({ kind: 'info', title: 'Already removed' });
      else
        toast({
          kind: 'error',
          title: 'Could not remove the policy',
          description: policyFailure(err),
        });
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const shown = (key: keyof typeof errors) => (tried ? errors[key] : undefined);

  return (
    <section aria-label="Release approvals">
      <Panel
        title="Release approvals"
        actions={
          phase === 'ready' &&
          !editing && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={start}>
                {current ? 'Edit policy' : 'Require approvals'}
              </Button>
              {current && (
                <Button
                  size="sm"
                  variant="ghost"
                  busy={remove.isPending}
                  onClick={() => void onRemove()}
                >
                  Remove
                </Button>
              )}
            </div>
          )
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{`${stage ? `${stage} · ` : ''}Production releases wait in a canary stage until enough eligible people approve them. A rejection or the timeout aborts the rollout.`}</p>

        <div className="flex flex-col gap-4">
          {phase !== 'ready' ? (
            <InlinePhase
              phase={phase}
              error={policy.error}
              loadingMessage="Reading the approval policy…"
              onRetry={() => void policy.refetch()}
            />
          ) : current ? (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="label-mono text-muted-foreground">Approvals</dt>
                <dd>
                  {current.required_approvals} from {approversLabel(current.approvers)}
                  {current.allow_self_approval
                    ? ', the deployer’s own counts'
                    : ', not the deployer'}
                </dd>
              </div>
              <div>
                <dt className="label-mono text-muted-foreground">Waits</dt>
                <dd>
                  At stage {current.after_stage}, aborted after{' '}
                  {minutesLabel(current.timeout_minutes)}
                </dd>
              </div>
              <div>
                <dt className="label-mono text-muted-foreground">Tells</dt>
                <dd className="font-mono text-xs">{current.notify_channels.join(', ') || '—'}</dd>
              </div>
              <div>
                <dt className="label-mono text-muted-foreground">Last changed</dt>
                <dd className="text-xs">
                  by {current.updated_by} <Timestamp value={current.updated_at} />
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{slug} does not require approvals.</p>
          )}
          {editing && (
            <form
              noValidate
              aria-label="Approval policy"
              className="flex flex-col gap-3 well rounded-xl bg-muted/40 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <NumberField
                  label="People who must approve"
                  value={draft.required}
                  onChange={(n) => set('required', n)}
                  error={shown('required')}
                  id="approval-required"
                />
                <NumberField
                  label="Wait at canary stage"
                  value={draft.stage}
                  onChange={(n) => set('stage', n)}
                  error={shown('stage')}
                  id="approval-stage"
                />
                <NumberField
                  label="Abort after (minutes)"
                  value={draft.timeout}
                  onChange={(n) => set('timeout', n)}
                  error={shown('timeout')}
                  hint={minutesLabel(draft.timeout)}
                  id="approval-timeout"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="approval-approvers" className="label-mono text-muted-foreground">
                    Who may approve
                  </label>
                  <Select
                    id="approval-approvers"
                    value={draft.approvers}
                    onChange={(e) => set('approvers', e.target.value as Draft['approvers'])}
                  >
                    <option value="admin">Owners and admins</option>
                    <option value="developer">Owners, admins and developers</option>
                  </Select>
                </div>
                <label className="flex items-center gap-2 self-end text-xs">
                  <input
                    type="checkbox"
                    checked={draft.self}
                    onChange={(e) => set('self', e.target.checked)}
                  />
                  The deployer’s own approval counts. An app outside an organization always counts
                  it.
                </label>
              </div>
              <ReleaseChannelPicker
                value={draft.notify}
                onChange={(n) => set('notify', n)}
                idPrefix={`approval-${slug}`}
              />
              {shown('notify') && (
                <FieldError id="approval-notify-error">{shown('notify')}</FieldError>
              )}
              {failure && (
                <p role="alert" className="text-xs text-[color:var(--status-critical)]">
                  {failure}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" busy={save.isPending}>
                  {current ? 'Save policy' : 'Require approvals'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          <div className="flex flex-col gap-2">
            <p className="label-mono text-muted-foreground">Waiting now</p>
            <WaitingApprovals slug={slug} />
          </div>
        </div>
      </Panel>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  error,
  hint,
  id,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  error?: string;
  hint?: string;
  id: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(Math.trunc(Number(e.target.value)))}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(FIELD, 'w-full')}
      />
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : (
        hint && <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

/**
 * A release's approval in its Lifecycle section, shown only when the policy
 * applies to it; deciding happens on the approval page or right here.
 */
export function ReleaseApprovalSection({
  deploymentId,
  release,
}: {
  deploymentId: string;
  release: string;
}) {
  const status = useReleaseApproval(deploymentId);
  if (status.error)
    return (
      <InlinePhase
        phase={queryPhase({ error: status.error })}
        error={status.error}
        onRetry={() => void status.refetch()}
      />
    );
  if (!status.data || status.data.state === 'not_required') return null;
  return (
    <section aria-label="Approval" className="flex flex-col gap-3 well rounded-xl bg-muted/40 p-4">
      <p className="label-mono text-muted-foreground">Approval</p>
      <ReleaseApproval deploymentId={deploymentId} release={release} />
      <a
        className="text-xs text-brand underline-offset-4 hover:underline"
        href={approvalPath(deploymentId)}
      >
        Open the approval page
      </a>
    </section>
  );
}
