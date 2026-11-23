import { formatPercent } from '@/lib/usage-format';
import type { ReactNode } from 'react';
import { ShimmerText } from '@/components/ui/shimmer';
import { PageHeader } from '../primitives';
import { ReleaseStatusLabel } from '../release-status-label';
import { DeploymentPreviewUrl } from '../deployment-insights';
import { deploymentPhase, isDeploymentTerminal } from '@/lib/deployment-status';
import type { Deployment } from '@/lib/api/queries';

/** `v14`, or the deployment ID's first eight characters before it has a revision. */
export function releaseName(d: { revision?: number | null; id: string }): string {
  return d.revision ? `v${d.revision}` : d.id.slice(0, 8);
}

export function ReleaseHeader({
  deployment,
  actions,
}: {
  deployment: Deployment;
  actions?: ReactNode;
}) {
  const live = deploymentPhase(deployment.status) === 'live';
  return (
    <PageHeader
      title={releaseName(deployment)}
      actions={actions}
      meta={
        <>
          {live ? (
            <span className="text-sm font-medium text-[color:var(--status-good)]">
              Live · {formatPercent(deployment.traffic_percent ?? 0)} of traffic
            </span>
          ) : (
            <ReleaseStatusLabel status={deployment.status} />
          )}
          {!isDeploymentTerminal(deployment.status) && (
            <ShimmerText className="text-xs text-muted-foreground">Updating</ShimmerText>
          )}
          <DeploymentPreviewUrl deploymentId={deployment.id} />
        </>
      }
    />
  );
}
