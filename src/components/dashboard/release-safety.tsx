import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { CapabilityGate, WhenCapable } from './capability-gate';
import { ReleaseApprovals } from './release-approvals';
import { ReleaseFreezes } from './release-freezes';
import { ReleaseGates } from './release-gates';
import { ScheduledReleases } from './release-schedule';

/**
 * An app's release guards in one place, as faas's own dashboard groups them
 * (handlers_dashboard_release_safety.go): its freezes, approval policy and
 * waiting releases, gates, and scheduled releases. Each is its own preview
 * capability, so each section is gated on its own and explains itself when
 * the account does not have it.
 */
export function ReleaseSafety({
  slug,
  onOpenDeployment,
}: {
  slug: string;
  onOpenDeployment: (id: string) => void;
}) {
  return (
    <>
      <CapabilityGate capability="deploy-freezes" title="Deploy freezes">
        <ReleaseFreezes owner={{ kind: 'app', slug }} />
      </CapabilityGate>
      <CapabilityGate capability="release-approvals" title="Release approvals">
        <ReleaseApprovals slug={slug} />
      </CapabilityGate>
      <CapabilityGate capability="release-gates" title="Release gates">
        <ReleaseGates slug={slug} />
      </CapabilityGate>
      <CapabilityGate capability="scheduled-releases" title="Scheduled releases">
        <ScheduledReleases app={slug} onOpen={onOpenDeployment} />
      </CapabilityGate>
    </>
  );
}

/**
 * The workspace's guards on Releases: the freezes on all of its apps (an
 * organization's on `/v1/orgs/{slug}/freezes`, the account's personal ones on
 * `/v1/freezes`, never one for the other) and the account's scheduled
 * releases. A section the account does not have is left out rather than
 * explained, since the page is about releases, not previews.
 */
export function WorkspaceReleaseGuards({ onOpen }: { onOpen: (deploymentId: string) => void }) {
  const workspace = useWorkspaceTarget();
  return (
    <>
      <WhenCapable capability="deploy-freezes">
        {workspace.ready && (
          <ReleaseFreezes
            owner={workspace.org ? { kind: 'org', org: workspace.org } : { kind: 'account' }}
          />
        )}
      </WhenCapable>
      <WhenCapable capability="scheduled-releases">
        <ScheduledReleases onOpen={onOpen} />
      </WhenCapable>
    </>
  );
}
