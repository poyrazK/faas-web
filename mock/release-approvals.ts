import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { channels } from './notification-channels';
import { GuardProblem } from './release-freezes';

type S = components['schemas'];
export type Policy = S['ReleaseApprovalPolicy'];
type Status = S['ReleaseApprovalStatus'];
type Decision = S['ReleaseApprovalDecision'];

/**
 * Release approvals (faas apidserver/release_approvals.go). The mock's apps
 * are personal, so the one person's own approval always counts (role
 * `personal`). A release waits once its canary reaches the policy's stage.
 */
const at = (msAgo: number) => db.iso(msAgo).replace(/\.\d{3}Z$/, 'Z');
const policy = (slug: string, over: Partial<Policy> = {}): Policy => ({
  app: slug,
  required_approvals: 1,
  after_stage: 1,
  timeout_minutes: 1440,
  approvers: 'admin',
  allow_self_approval: true,
  notify_channels: ['ops-slack'],
  updated_by: db.account.email,
  created_at: at(5 * 86_400_000),
  updated_at: at(5 * 86_400_000),
  ...over,
});

/** webhook-router requires approvals (app-release-settings warns about it); so does the app whose canary is rolling out. */
export const policies = new Map<string, Policy>(
  db.EMPTY
    ? []
    : [
        [db.apps[2].slug, policy(db.apps[2].slug, { timeout_minutes: 60 })],
        [db.apps[0].slug, policy(db.apps[0].slug)],
      ]
);
export const decisions = new Map<string, Decision[]>();

export const requiresApproval = (slug: string) => policies.has(slug);

const validation = (detail: string) => new GuardProblem(400, 'validation_failed', detail);

/** GET /v1/apps/{slug}/release-approval-policy. */
export function getPolicy(slug: string): Policy {
  const p = policies.get(slug);
  if (!p)
    throw new GuardProblem(
      404,
      'release_approval_policy_not_found',
      `${slug} does not require release approvals.`
    );
  return p;
}

/** PUT: SetReleaseApprovalPolicyRequest.Normalize, then channel names (release_approvals.go:60-112). */
export function setPolicy(
  slug: string,
  body: Partial<S['SetReleaseApprovalPolicyRequest']>,
  now = Date.now()
): Policy {
  const required = body.required_approvals ?? 0;
  if (!Number.isInteger(required) || required < 1 || required > 5)
    throw validation('required_approvals must be between 1 and 5');
  const stage = body.after_stage ?? 1;
  if (!Number.isInteger(stage) || stage < 1 || stage > 10)
    throw validation('after_stage must be between 1 and 10');
  const timeout = body.timeout_minutes ?? 1440;
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 10080)
    throw validation('timeout_minutes must be between 10 and 10080');
  const approvers = body.approvers ?? 'admin';
  if (approvers !== 'admin' && approvers !== 'developer')
    throw validation('approvers must be "admin" or "developer"');
  const names = body.notify_channels ?? [];
  if (!names.length)
    throw validation(
      'notify_channels must name at least one Slack or email channel, so the approvers learn a release is waiting'
    );
  if (names.length > 5 || new Set(names).size !== names.length)
    throw validation('notify_channels must name at most 5 distinct channels');
  for (const n of names) {
    const c = channels.find((x) => x.name === n);
    if (!c)
      throw validation(
        `no notification channel is named "${n}"; create it with \`gregale channels add\``
      );
    if (c.kind === 'pagerduty')
      throw validation(
        `"${n}" is a PagerDuty channel; release notifications go to Slack or email channels`
      );
  }
  const stamp = new Date(now).toISOString();
  const saved: Policy = {
    app: slug,
    required_approvals: required,
    after_stage: stage,
    timeout_minutes: timeout,
    approvers,
    // A personal app has one person, whose own approval always counts.
    allow_self_approval: true,
    notify_channels: names,
    updated_by: db.account.email,
    created_at: policies.get(slug)?.created_at ?? stamp,
    updated_at: stamp,
  };
  policies.set(slug, saved);
  return saved;
}

export function removePolicy(slug: string) {
  if (!policies.delete(slug))
    throw new GuardProblem(
      404,
      'release_approval_policy_not_found',
      `${slug} does not require release approvals.`
    );
}

/** releaseApprovalState: where one release stands against its app's policy. */
export function statusOf(d: db.Deployment, now = Date.now()): Status {
  const slug = db.slugById(d.app_id);
  const p = policies.get(slug);
  const made = decisions.get(d.id) ?? [];
  const base = { deployment_id: d.id, app: slug, approvals: 0, decisions: made };
  // Only production releases (the default scope) are gated.
  if (!p || (d.scope && d.scope !== 'default')) return { ...base, state: 'not_required' };
  const approvals = made.filter((x) => x.decision === 'approve' && x.counted).length;
  const view = {
    ...base,
    approvals,
    required_approvals: p.required_approvals,
    after_stage: p.after_stage,
    deployed_by: d.deployed_by ?? db.account.email,
  };
  if (made.some((x) => x.decision === 'reject')) return { ...view, state: 'rejected' };
  if (approvals >= p.required_approvals) return { ...view, state: 'approved' };
  const inFlight =
    Boolean(d.canary_total_steps) &&
    (d.rollout_state === 'rolling_out' || d.rollout_state === 'pending');
  if (!inFlight || (d.canary_step ?? 0) < p.after_stage) return { ...view, state: 'not_required' };
  const since = d.canary_step_started_at ?? d.created_at;
  const expires = Date.parse(since) + p.timeout_minutes * 60_000;
  return {
    ...view,
    state: now >= expires ? 'expired' : 'waiting',
    waiting_since: since,
    expires_at: new Date(expires).toISOString(),
  };
}

/** GET /v1/apps/{slug}/release-approvals: live releases waiting, or past their timeout. */
export function waiting(slug: string): Status[] {
  const app = db.appBySlug(slug);
  return db.deployments
    .filter((d) => d.app_id === app?.id && d.status === 'live')
    .map((d) => statusOf(d))
    .filter((s) => s.state === 'waiting' || s.state === 'expired');
}

/** POST /v1/deployments/{id}/approvals (release_approvals.go:303-389). */
export function decide(
  d: db.Deployment,
  body: { decision?: unknown; comment?: unknown },
  now = Date.now()
): Status {
  const decision = body.decision;
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (decision !== 'approve' && decision !== 'reject')
    throw validation('decision must be approve or reject');
  if (decision === 'reject' && !comment) throw validation('a rejection needs a comment');
  if (comment.length > 200) throw validation('comment must be at most 200 characters');
  const current = statusOf(d, now);
  const refusals: Partial<Record<Status['state'], string>> = {
    not_required: 'This release does not need approval.',
    rejected: 'This release was already rejected.',
    expired: 'This release waited past its approval timeout.',
    approved: 'This release is already approved; abort its rollout to stop it.',
  };
  if (refusals[current.state])
    throw new GuardProblem(409, 'release_approval_decided', refusals[current.state]!);
  const made = decisions.get(d.id) ?? [];
  if (made.some((x) => x.approver === db.account.email))
    throw new GuardProblem(409, 'release_approval_decided', 'You already decided on this release.');
  made.push({
    approver: db.account.email,
    role: 'personal',
    decision,
    ...(comment ? { comment } : {}),
    counted: true,
    decided_at: new Date(now).toISOString(),
  });
  decisions.set(d.id, made);
  if (decision === 'reject')
    Object.assign(d, {
      rollout_state: 'aborted',
      rollout_aborted_at: new Date(now).toISOString(),
      rollout_aborted_reason: 'abort_approval_rejected',
      traffic_percent: 0,
    });
  return statusOf(d, now);
}
