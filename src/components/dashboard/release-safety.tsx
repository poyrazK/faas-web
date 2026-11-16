import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { approvalPath, useApprovalPolicy, useWaitingApprovals } from '@/lib/api/release-approvals';
import { FREEZE_BLOCKS, FREEZE_SPARES, useFreezeStatus } from '@/lib/api/release-freezes';
import { useScheduledReleases } from '@/lib/api/scheduled-releases';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { WhenCapable } from './capability-gate';
import { ReleaseApprovals } from './release-approvals';
import { ReleaseFreezes, useLiftFreeze } from './release-freezes';
import { ReleaseGates } from './release-gates';
import { SafetyCapabilityGate, SafetyDot, useVersionName } from './release-safety-card';
import {
  describeReleaseSafety,
  sourceOf,
  spokenTime,
  type Hold,
  type SafetyAction,
} from './release-safety-words';
import { ScheduledReleases } from './release-schedule';
import type { ScopeGate } from './scope-gate';

/** The explanation each mechanism's `?` gives, also when the account does not have it. */
const HELP = {
  freezes: `${FREEZE_BLOCKS} ${FREEZE_SPARES}`,
  approvals:
    'Production releases wait in a canary stage until enough eligible people approve them. A rejection or the timeout rolls the release back.',
  gates:
    'Also called release gates. Your own signals, judged on every canary step and for 30 minutes after a release reaches 100%. A failed check aborts the canary or rolls the release back.',
  schedules:
    'A version that is live without traffic can wait for a set time before its rollout starts.',
};

/**
 * An app's release guards in one place, as faas's own dashboard groups them
 * (handlers_dashboard_release_safety.go). The tab opens with one answer —
 * what can stop or delay a release right now — built from the app's freeze
 * status, its releases waiting for approval and its pending schedules; then
 * each mechanism as a card saying what it does and whether it is on. Each is
 * its own preview capability, so each card is gated on its own and explains
 * itself when the account does not have it.
 */
export function ReleaseSafety({
  slug,
  onOpenDeployment,
}: {
  slug: string;
  onOpenDeployment: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ReleaseSafetyAnswer slug={slug} onOpenDeployment={onOpenDeployment} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SafetyCapabilityGate capability="deploy-freezes" title="Freezes" help={HELP.freezes}>
          <ReleaseFreezes owner={{ kind: 'app', slug }} />
        </SafetyCapabilityGate>
        <SafetyCapabilityGate
          capability="release-approvals"
          title="Approvals"
          help={HELP.approvals}
        >
          <ReleaseApprovals slug={slug} />
        </SafetyCapabilityGate>
        <SafetyCapabilityGate
          capability="scheduled-releases"
          title="Scheduled releases"
          help={HELP.schedules}
        >
          <ScheduledReleases app={slug} onOpen={onOpenDeployment} />
        </SafetyCapabilityGate>
        <SafetyCapabilityGate capability="release-gates" title="Rollout checks" help={HELP.gates}>
          <ReleaseGates slug={slug} />
        </SafetyCapabilityGate>
      </div>
    </div>
  );
}

/**
 * Rule 1 of the console: answer first. One sentence, set larger than anything
 * else, saying what holds a release of the app now — or that nothing does —
 * with the one action that deals with it. Reads run only for the mechanisms
 * the account has; one that could not be read makes the answer say so.
 */
function ReleaseSafetyAnswer({
  slug,
  onOpenDeployment,
}: {
  slug: string;
  onOpenDeployment: (id: string) => void;
}) {
  const freezeGate = useCapabilityAccess('deploy-freezes');
  const approvalGate = useCapabilityAccess('release-approvals');
  const scheduleGate = useCapabilityAccess('scheduled-releases');
  const freezeAccess = freezeGate.access;
  const approvalAccess = approvalGate.access;
  const scheduleAccess = scheduleGate.access;
  const status = useFreezeStatus(slug, freezeAccess === 'on');
  const policy = useApprovalPolicy(slug, approvalAccess === 'on');
  const waiting = useWaitingApprovals(slug, approvalAccess === 'on');
  const schedules = useScheduledReleases(slug, scheduleAccess === 'on');
  const version = useVersionName(slug);
  const lift = useLiftFreeze();

  const answer = describeReleaseSafety({
    freezes: sourceOf(freezeAccess, status),
    policy: sourceOf(approvalAccess, policy),
    waiting: sourceOf(approvalAccess, waiting),
    schedules: sourceOf(scheduleAccess, schedules),
    version,
    when: (iso) => spokenTime(iso),
  });

  const retry = () => {
    if ([freezeAccess, approvalAccess, scheduleAccess].includes('registry-error'))
      freezeGate.refresh();
    if (status.error) void status.refetch();
    if (policy.error) void policy.refetch();
    if (waiting.error) void waiting.refetch();
    if (schedules.error) void schedules.refetch();
  };

  const actionFor = (action: SafetyAction | undefined, primary: boolean): ReactNode => {
    if (!action) return null;
    const size = primary ? 'sm' : 'xs';
    const variant = primary ? 'default' : 'outline';
    switch (action.kind) {
      case 'lift':
        return (
          <Button
            size={size}
            variant={variant}
            busy={lift.busy === action.freeze.id}
            disabled={lift.busy !== null}
            onClick={() => void lift.lift(action.freeze)}
          >
            Lift freeze
          </Button>
        );
      case 'freezes':
        return (
          <Button
            size={size}
            variant={variant}
            onClick={() => {
              const card = document.getElementById('release-freezes');
              card?.scrollIntoView?.({ block: 'start' });
              card?.focus({ preventScroll: true });
            }}
          >
            Review freezes
          </Button>
        );
      case 'review':
        return (
          <Button asChild size={size} variant={variant}>
            <a href={approvalPath(action.deploymentId)}>Review</a>
          </Button>
        );
      case 'open':
        return (
          <Button
            size={size}
            variant={variant}
            onClick={() => onOpenDeployment(action.deploymentId)}
          >
            Open {action.version}
          </Button>
        );
    }
  };

  const [, ...also] = answer.holds;
  return (
    <section
      aria-label="What can hold up a release"
      className="well flex flex-col gap-4 rounded-2xl bg-muted/40 px-5 py-5 sm:px-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div role="status" className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
          <span className="bento-label flex items-center gap-2">
            <SafetyDot tone={answer.tone} />
            {answer.word}
          </span>
          <p className="text-xl leading-7 font-medium tracking-[-0.01em] text-balance">
            {answer.sentence}
          </p>
          {answer.detail.length > 0 && (
            <p className="text-sm text-muted-foreground">{answer.detail.join(' ')}</p>
          )}
        </div>
        {answer.phase === 'held' && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {actionFor(answer.holds[0].action, true)}
          </div>
        )}
        {answer.phase === 'partial' && (
          <Button size="sm" variant="outline" onClick={retry}>
            Check again
          </Button>
        )}
      </div>
      {also.length > 0 && <AlsoHolding holds={also} actionFor={actionFor} />}
      {answer.phase === 'held' && answer.unchecked.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Couldn’t check everything else that can hold a release.{' '}
          <button type="button" className="text-brand underline" onClick={retry}>
            Check again
          </button>
        </p>
      )}
    </section>
  );
}

/** Whatever else holds a release, each as one line with its own quieter action. */
function AlsoHolding({
  holds,
  actionFor,
}: {
  holds: Hold[];
  actionFor: (action: SafetyAction | undefined, primary: boolean) => ReactNode;
}) {
  return (
    <ul aria-label="Also holding releases" className="flex flex-col divide-y divide-border/60">
      {holds.map((hold) => (
        <li
          key={hold.key}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
            <SafetyDot tone={hold.tone} />
            <span>{hold.sentence}</span>
          </span>
          {actionFor(hold.action, false)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The workspace's guards on Releases: the freezes on all of its apps (an
 * organization's on `/v1/orgs/{slug}/freezes`, the account's personal ones on
 * `/v1/freezes`, never one for the other) and the account's scheduled
 * releases. A section the account does not have is left out rather than
 * explained, since the page is about releases, not previews.
 */
export function WorkspaceReleaseGuards({
  onOpen,
  scope,
}: {
  onOpen: (deploymentId: string) => void;
  /** Inside a project: its apps' schedules and freezes, plus freezes on every app. */
  scope?: ScopeGate;
}) {
  const workspace = useWorkspaceTarget();
  return (
    <>
      <WhenCapable capability="deploy-freezes">
        {workspace.ready && (
          <ReleaseFreezes
            owner={workspace.org ? { kind: 'org', org: workspace.org } : { kind: 'account' }}
            scope={scope}
          />
        )}
      </WhenCapable>
      <WhenCapable capability="scheduled-releases">
        <ScheduledReleases onOpen={onOpen} scope={scope} />
      </WhenCapable>
    </>
  );
}
