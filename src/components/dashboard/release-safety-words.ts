import type { CapabilityAccess } from '@/lib/capability-state';
import type { ApprovalPolicy, ApprovalStatus } from '@/lib/api/release-approvals';
import {
  freezeCoverage,
  minutesLabel,
  weeklyLabel,
  type FreezeOwner,
  type ReleaseFreeze,
  type ReleaseFreezeStatus,
} from '@/lib/api/release-freezes';
import type { ReleaseGate } from '@/lib/api/release-gates';
import type { ScheduledRelease } from '@/lib/api/scheduled-releases';

/**
 * The Release safety tab in plain words (docs/console-plain-english.md): one
 * answer to "what can stop or delay a release right now", and one sentence
 * per mechanism saying what it does and whether it is on. Every sentence is
 * built from fields the API returns; a source that could not be read makes
 * the answer say less, never "nothing".
 *
 * Semantics, from faas:
 * - `/freeze-status` is the authority on whether a production release of the
 *   app is refused now: it folds in the owner's freezes on all apps
 *   (release_freezes.go). `active` lists the ones refusing; `next` is the
 *   next one to start within a week.
 * - `/release-approvals` lists the app's live releases waiting in their
 *   canary stage, and those past `expires_at` about to be aborted
 *   (release_approvals.go). Aborting hands traffic back to the version
 *   serving before, which the console calls a roll back.
 * - A schedule in state `scheduled` is a release held without traffic until
 *   `release_at` (scheduled_releases.go).
 */

export type SafetyTone = 'good' | 'active' | 'warning' | 'critical' | 'idle';

/** One read behind the answer, as far as the page could get with it. */
export type Source<T> =
  { state: 'off' } | { state: 'loading' } | { state: 'failed' } | { state: 'ready'; data: T };

/**
 * A read gated on a capability: `off` when the account does not have it (it
 * cannot hold a release), `failed` when its availability could not be
 * checked or the read failed.
 */
export function sourceOf<T>(
  access: CapabilityAccess,
  query: { data: T | undefined; error: unknown; isPending: boolean }
): Source<T> {
  if (access === 'loading') return { state: 'loading' };
  if (access === 'registry-error') return { state: 'failed' };
  if (access !== 'on') return { state: 'off' };
  if (query.error) return { state: 'failed' };
  if (query.isPending || query.data === undefined) return { state: 'loading' };
  return { state: 'ready', data: query.data };
}

export type SafetyAction =
  | { kind: 'lift'; freeze: ReleaseFreeze }
  | { kind: 'freezes' }
  | { kind: 'review'; deploymentId: string }
  | { kind: 'open'; deploymentId: string; version: string };

/** One thing holding a release now. */
export interface Hold {
  key: string;
  word: string;
  tone: SafetyTone;
  sentence: string;
  detail?: string;
  action?: SafetyAction;
}

export type Mechanism = 'freezes' | 'approvals' | 'schedules';

export interface SafetyAnswer {
  phase: 'loading' | 'held' | 'clear' | 'partial';
  word: string;
  tone: SafetyTone;
  sentence: string;
  detail: string[];
  /** Everything holding a release, the headline first. */
  holds: Hold[];
  /** Reads that failed, in plain words: the answer cannot speak for them. */
  unchecked: Mechanism[];
}

export interface SafetyInput {
  freezes: Source<ReleaseFreezeStatus>;
  policy: Source<ApprovalPolicy | null>;
  waiting: Source<ApprovalStatus[]>;
  schedules: Source<ScheduledRelease[]>;
  /** "v44", or the short id when the version is not known. */
  version: (deploymentId: string, revision?: number) => string;
  /** "Friday at 18:00": see `spokenTime`. */
  when: (iso: string) => string;
  now?: number;
}

const DAY = 86_400_000;

/**
 * An instant as it is said aloud, in the viewer's zone: "today at 18:00",
 * "tomorrow at 09:30", "Friday at 16:00" within the week, "Nov 20 at 16:00"
 * further out. Unparseable input stays unknown.
 */
export function spokenTime(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 'at an unknown time';
  const at = new Date(ms);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(at) - midnight(new Date(now))) / DAY);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days === -1) return `yesterday at ${time}`;
  if (days > 1 && days < 7)
    return `${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(at)} at ${time}`;
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  }).format(at);
  return `${date} at ${time}`;
}

/** Who may approve, as a phrase: "an owner or admin", "owners, admins or developers". */
export function approversPhrase(approvers: ApprovalPolicy['approvers'], count: number): string {
  if (approvers === 'developer')
    return count === 1 ? 'an owner, admin or developer' : 'owners, admins or developers';
  return count === 1 ? 'an owner or admin' : 'owners or admins';
}

/** What an approval policy makes a new version do, as one sentence. */
export function approvalPolicySentence(policy: ApprovalPolicy | null): string {
  if (!policy) return 'New versions don’t wait for anyone’s approval.';
  const n = policy.required_approvals;
  const who =
    n === 1
      ? `${approversPhrase(policy.approvers, 1)} approves them`
      : `${n} ${approversPhrase(policy.approvers, n)} approve them`;
  return `New versions pause partway through their rollout until ${who}.`;
}

/** The parts of an approval policy kept out of the sentence, for "Show details". */
export function approvalPolicyDetails(policy: ApprovalPolicy): { label: string; value: string }[] {
  return [
    {
      label: 'Whose approval counts',
      value: policy.allow_self_approval
        ? 'Anyone eligible, including the person who deployed'
        : 'Anyone eligible except the person who deployed',
    },
    { label: 'Where it pauses', value: `Canary stage ${policy.after_stage}` },
    {
      label: 'Gives up after',
      value: `${minutesLabel(policy.timeout_minutes)}, then the version is rolled back`,
    },
    {
      label: 'Tells',
      value: policy.notify_channels.length ? policy.notify_channels.join(', ') : 'No one',
    },
  ];
}

/** Who wrote a freeze, and why. */
function freezeOrigin(freeze: ReleaseFreeze): string {
  if (freeze.source === 'automatic_rollback')
    return `Gregale froze it after rolling a version back on its own (“${freeze.reason}”).`;
  return `“${freeze.reason}”, set by ${freeze.created_by}.`;
}

function frozenHold(status: ReleaseFreezeStatus, when: (iso: string) => string): Hold {
  const active = status.active;
  if (active.length === 1) {
    const freeze = active[0];
    const sentence =
      freeze.kind === 'weekly'
        ? 'Releases are frozen by a weekly freeze.'
        : freeze.ends_at
          ? `Releases are frozen until ${when(freeze.ends_at)}.`
          : 'Releases are frozen until someone lifts the freeze.';
    const parts = [freezeOrigin(freeze)];
    if (freeze.kind === 'weekly' && freeze.weekly) parts.push(`${weeklyLabel(freeze.weekly)}.`);
    if (!freeze.app) parts.push(`It covers ${freezeCoverage(freeze)}.`);
    return {
      key: 'frozen',
      word: 'Frozen',
      tone: 'critical',
      sentence,
      detail: parts.join(' '),
      action: { kind: 'lift', freeze },
    };
  }
  // Every active freeze runs from now to its end, so together they hold
  // releases until the latest one ends — known only when each has an end.
  const ends = active.map((f) => (f.ends_at ? Date.parse(f.ends_at) : NaN));
  const until = ends.every((ms) => !Number.isNaN(ms))
    ? active[ends.indexOf(Math.max(...ends))].ends_at
    : undefined;
  return {
    key: 'frozen',
    word: 'Frozen',
    tone: 'critical',
    sentence: until
      ? `Releases are frozen until ${when(until)} by ${active.length} freezes.`
      : `Releases are frozen by ${active.length} freezes.`,
    detail: `${active.map((f) => `“${f.reason}”`).join(', ')}.`,
    action: { kind: 'freezes' },
  };
}

function approvalHold(
  item: ApprovalStatus,
  policy: ApprovalPolicy | null | undefined,
  version: string,
  when: (iso: string) => string
): Hold {
  if (item.state === 'expired')
    return {
      key: `approval-${item.deployment_id}`,
      word: 'Approval timed out',
      tone: 'critical',
      sentence: `${version} ran out of time waiting for approval and is being rolled back.`,
      detail: 'The version serving before it takes its traffic back.',
      action: { kind: 'open', deploymentId: item.deployment_id, version },
    };
  const remaining = Math.max((item.required_approvals ?? 1) - item.approvals, 0);
  const sentence =
    remaining > 1
      ? `${version} needs ${remaining} more approvals${policy ? ` from ${approversPhrase(policy.approvers, remaining)}` : ''}.`
      : policy
        ? `${version} is waiting for an approval from ${approversPhrase(policy.approvers, 1)}.`
        : `${version} is waiting for approval.`;
  return {
    key: `approval-${item.deployment_id}`,
    word: 'Waiting for approval',
    tone: 'warning',
    sentence,
    detail: item.expires_at
      ? `It’s paused partway through its rollout. If no one approves it by ${when(item.expires_at)}, it’s rolled back.`
      : 'It’s paused partway through its rollout.',
    action: { kind: 'review', deploymentId: item.deployment_id },
  };
}

function scheduleHold(
  schedule: ScheduledRelease,
  version: string,
  when: (iso: string) => string,
  now: number
): Hold {
  const due = Date.parse(schedule.release_at) <= now;
  return {
    key: `schedule-${schedule.id}`,
    word: 'Scheduled',
    tone: 'active',
    sentence: due
      ? `${version} is due to start its scheduled rollout.`
      : `${version} is scheduled to go live ${when(schedule.release_at)}.`,
    detail: 'Until then it waits without traffic, and the current version keeps serving.',
    action: { kind: 'open', deploymentId: schedule.deployment_id, version },
  };
}

const UNCHECKED: Record<Mechanism, string> = {
  freezes: 'freezes',
  approvals: 'approvals',
  schedules: 'scheduled releases',
};

/** "freezes", "freezes and approvals", "freezes, approvals and scheduled releases". */
export function uncheckedPhrase(list: Mechanism[]): string {
  const words = list.map((m) => UNCHECKED[m]);
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The tab's answer: what holds a release now, or that nothing does, and why that is known. */
export function describeReleaseSafety(input: SafetyInput): SafetyAnswer {
  const { freezes, policy, waiting, schedules, version, when } = input;
  const now = input.now ?? Date.now();
  const holds: Hold[] = [];
  const policyData = policy.state === 'ready' ? policy.data : undefined;

  if (freezes.state === 'ready' && freezes.data.frozen && freezes.data.active.length > 0)
    holds.push(frozenHold(freezes.data, when));
  if (waiting.state === 'ready')
    for (const item of waiting.data)
      if (item.state === 'waiting' || item.state === 'expired')
        holds.push(approvalHold(item, policyData, version(item.deployment_id), when));
  if (schedules.state === 'ready')
    for (const s of schedules.data
      .filter((s) => s.state === 'scheduled')
      .sort((a, b) => Date.parse(a.release_at) - Date.parse(b.release_at)))
      holds.push(scheduleHold(s, version(s.deployment_id, s.revision), when, now));

  const unchecked: Mechanism[] = [];
  if (freezes.state === 'failed') unchecked.push('freezes');
  if (waiting.state === 'failed' || policy.state === 'failed') unchecked.push('approvals');
  if (schedules.state === 'failed') unchecked.push('schedules');

  if (holds.length > 0) {
    const [first] = holds;
    return {
      phase: 'held',
      word: first.word,
      tone: first.tone,
      sentence: first.sentence,
      detail: first.detail ? [first.detail] : [],
      holds,
      unchecked,
    };
  }

  const pending = [freezes, policy, waiting, schedules].some((s) => s.state === 'loading');
  if (pending)
    return {
      phase: 'loading',
      word: 'Checking',
      tone: 'idle',
      sentence: 'Checking what could hold up a release…',
      detail: [],
      holds,
      unchecked,
    };

  const detail: string[] = [];
  if (policyData) detail.push(approvalPolicySentence(policyData));
  else if (policy.state !== 'failed')
    detail.push('New versions go live as soon as they pass their checks.');
  if (freezes.state === 'ready' && freezes.data.next?.next_starts_at)
    detail.push(
      `The next freeze, “${freezes.data.next.reason}”, starts ${when(freezes.data.next.next_starts_at)}.`
    );

  if (unchecked.length > 0)
    return {
      phase: 'partial',
      word: 'Partly checked',
      tone: 'idle',
      sentence: 'Nothing we could check is blocking releases.',
      detail: [`Couldn’t check ${uncheckedPhrase(unchecked)}.`, ...detail],
      holds,
      unchecked,
    };

  return {
    phase: 'clear',
    word: 'Clear',
    tone: 'good',
    sentence: 'Nothing is blocking releases.',
    detail,
    holds,
    unchecked,
  };
}

/* --- One sentence per mechanism --------------------------------------- */

export interface CardWords {
  word: string;
  tone: SafetyTone;
  sentence: string;
}

/** "Releases", "Releases of your personal apps", "Releases of acme's apps". */
function releasesOf(owner: FreezeOwner): string {
  if (owner.kind === 'account') return 'Releases of your personal apps';
  if (owner.kind === 'org') return `Releases of ${owner.org}’s apps`;
  return 'Releases';
}

/**
 * What one active freeze pauses, as the subject of a sentence. On an account
 * or an organization, a freeze on a single app pauses only that app.
 */
function pausedWhat(owner: FreezeOwner, freeze: ReleaseFreeze): string {
  if (owner.kind !== 'app' && freeze.app) return `Releases of ${freeze.app}`;
  return releasesOf(owner);
}

/**
 * The freezes card. For an app, `status` (the app's freeze status) decides
 * whether releases are frozen now, since it counts the owner's freezes too;
 * for an account or an organization, the list's own `active` flags do.
 */
export function freezeCardWords({
  owner,
  freezes,
  status,
  when,
}: {
  owner: FreezeOwner;
  freezes: ReleaseFreeze[];
  status?: ReleaseFreezeStatus;
  when: (iso: string) => string;
}): CardWords {
  const active = status ? status.active : freezes.filter((f) => f.active);
  if (active.length > 0)
    return {
      word: 'Frozen now',
      tone: 'critical',
      sentence:
        active.length === 1
          ? `${pausedWhat(owner, active[0])} are paused by “${active[0].reason}”.`
          : owner.kind === 'app' || active.every((f) => !f.app)
            ? `${releasesOf(owner)} are paused by ${active.length} freezes.`
            : `${active.length} freezes are pausing releases now.`,
    };
  if (freezes.length === 0)
    return {
      word: 'Off',
      tone: 'idle',
      sentence: 'No freeze is set. Add one to pause releases over a weekend or during an incident.',
    };
  const next =
    status?.next ??
    [...freezes]
      .filter((f) => f.next_starts_at)
      .sort((a, b) => Date.parse(a.next_starts_at!) - Date.parse(b.next_starts_at!))[0];
  const count = freezes.length === 1 ? 'One freeze' : `${freezes.length} freezes`;
  return {
    word: 'On',
    tone: 'active',
    sentence: next?.next_starts_at
      ? `${count} can pause releases; the next starts ${when(next.next_starts_at)}.`
      : `${count} can pause releases; none is active now.`,
  };
}

/** The approvals card. */
export function approvalCardWords(
  policy: ApprovalPolicy | null,
  waiting: ApprovalStatus[] | undefined
): CardWords {
  const holding = (waiting ?? []).filter((s) => s.state === 'waiting').length;
  return {
    word: holding > 0 ? 'Waiting' : policy ? 'On' : 'Off',
    tone: holding > 0 ? 'warning' : policy ? 'active' : 'idle',
    sentence: approvalPolicySentence(policy),
  };
}

/** The rollout checks card (release gates). */
export function gateCardWords(gates: ReleaseGate[]): CardWords {
  if (gates.length === 0)
    return {
      word: 'Built-in only',
      tone: 'idle',
      sentence:
        'Rollouts stop on server errors, slow responses, crashes and memory use. Add a check to stop them on your own signals too.',
    };
  return {
    word: 'On',
    tone: 'active',
    sentence:
      gates.length === 1
        ? 'Rollouts also stop when your own check fails.'
        : `Rollouts also stop when any of your ${gates.length} checks fails.`,
  };
}

/** The scheduled releases card; `app` is absent on the account-wide list. */
export function scheduleCardWords({
  schedules,
  app,
  version,
  when,
}: {
  schedules: ScheduledRelease[];
  app?: string;
  version: (s: ScheduledRelease) => string;
  when: (iso: string) => string;
}): CardWords {
  const pending = schedules
    .filter((s) => s.state === 'scheduled')
    .sort((a, b) => Date.parse(a.release_at) - Date.parse(b.release_at));
  if (pending.length === 0)
    return {
      word: 'None',
      tone: 'idle',
      sentence:
        'Nothing is scheduled, so new versions start their rollout as soon as they’re ready.',
    };
  const first = pending[0];
  const name = app ? version(first) : `${first.app} ${version(first)}`;
  return {
    word: pending.length === 1 ? 'Scheduled' : `${pending.length} scheduled`,
    tone: 'active',
    sentence:
      pending.length === 1
        ? `${name} goes live ${when(first.release_at)}.`
        : `${pending.length} releases are scheduled; the first, ${name}, goes live ${when(first.release_at)}.`,
  };
}

/** A schedule that ended without starting, in words; the code stays for a `title`. */
export function scheduleOutcome(s: ScheduledRelease): string | undefined {
  if (!s.outcome_code && !s.outcome_detail) return undefined;
  if (s.outcome_detail) return s.outcome_detail;
  switch (s.outcome_code) {
    case 'release_frozen':
      return 'Releases were frozen at that time.';
    case 'not_ready':
      return 'The version wasn’t ready in time.';
    default:
      return undefined;
  }
}
