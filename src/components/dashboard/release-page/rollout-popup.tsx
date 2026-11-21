import { useEffect, type ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { AdvanceCanaryButton, ReorderDeploymentControl } from '../deployment-actions';
import { DeploymentAliasesHere } from '../deployment-aliases';
import { DeploymentStages } from '../deployment-insights';
import { DeploymentLifecycle } from '../deployment-lifecycle';
import { PromoteDeployment } from '../deployment-promote';
import { DeploymentRolloutState } from '../deployment-rollout-state';
import { ReleaseApprovalSection } from '../release-approvals';
import { ReleaseSchedule } from '../release-schedule';
import { RolloutObservation } from '../rollout-observation';
import { RolloutRecovery } from '../rollout-recovery';
import { WhenCapable } from '../capability-gate';
import { releaseName } from './release-header';
import type { ReleaseContext } from './release-page';

export type RolloutGroup = 'now' | 'move' | 'approval' | 'recover' | 'stages';

/**
 * Today's Lifecycle tab, grouped so it reads as answers rather than one long
 * column. The header's rollback is not repeated here: it leads the page.
 */
/** The group a header action opened the popup at, carried as `#rollout-<group>`. */
function useRolloutFocus(): RolloutGroup | undefined {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const group = hash.replace(/^#?rollout-/, '');
  return (['now', 'move', 'approval', 'recover', 'stages'] as const).find((id) => id === group);
}

export function RolloutPopup({ ctx }: { ctx: ReleaseContext }) {
  const { slug, deployment } = ctx;
  const focus = useRolloutFocus();
  const approvals = useCapabilityAccess('release-approvals').access === 'on';
  useEffect(() => {
    if (focus) document.getElementById(`rollout-${focus}`)?.scrollIntoView({ block: 'start' });
  }, [focus]);
  return (
    <div className="flex flex-col gap-6">
      <Group id="now" title="Now" lead="Where this release's rollout stands.">
        <DeploymentRolloutState deployment={deployment} />
        <RolloutObservation slug={slug} deployment={deployment} />
      </Group>
      <Group id="move" title="Move traffic" lead="Send more or less traffic to this release.">
        <AdvanceCanaryButton deployment={deployment} slug={slug} />
        <PromoteDeployment slug={slug} deployment={deployment} />
        <ReorderDeploymentControl deployment={deployment} />
        <WhenCapable capability="scheduled-releases">
          <ReleaseSchedule slug={slug} deployment={deployment} />
        </WhenCapable>
      </Group>
      {approvals && (
        <Group id="approval" title="Approval" lead="Who has to sign off before it continues.">
          <ReleaseApprovalSection deploymentId={deployment.id} release={releaseName(deployment)} />
        </Group>
      )}
      <Group id="recover" title="Recover" lead="Retry, resume or stop a release that went wrong.">
        <RolloutRecovery slug={slug} deployment={deployment} />
        <DeploymentLifecycle key={deployment.id} deployment={deployment} />
      </Group>
      <Group id="stages" title="Stages" lead="Each step the release went through.">
        <DeploymentStages deploymentId={deployment.id} />
      </Group>
      {/* Aliases heads its own section, and hides itself when the capability is off. */}
      <DeploymentAliasesHere slug={slug} deployment={deployment} />
    </div>
  );
}

function Group({
  id,
  title,
  lead,
  children,
}: {
  id: RolloutGroup;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <section
      id={`rollout-${id}`}
      aria-labelledby={`rollout-${id}-title`}
      className="flex flex-col gap-3"
    >
      <div>
        <h3 id={`rollout-${id}-title`} className="text-sm font-medium">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{lead}</p>
      </div>
      {children}
    </section>
  );
}
