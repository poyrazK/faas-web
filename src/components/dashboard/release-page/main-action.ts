import type { Deployment, DeploymentSummary } from '@/lib/api/queries';
import { deploymentPhase } from '@/lib/deployment-status';
import { canAdvanceCanary } from '../deployment-actions';

export type MainAction =
  | { kind: 'retry' }
  | { kind: 'advance-canary' }
  | { kind: 'rollback-to-this' }
  | { kind: 'rollback-to'; targetId: string; targetLabel: string }
  | { kind: 'promote' };

/**
 * The one action a release page leads with, first match wins. Each kind is a
 * flow the console already has; this only picks which one the state calls for.
 */
export function chooseMainAction(
  deployment: Deployment,
  summary?: DeploymentSummary
): MainAction | null {
  const phase = deploymentPhase(deployment.status);
  if (phase === 'failed' && deployment.status.toLowerCase() !== 'cancelled')
    return { kind: 'retry' };
  if (canAdvanceCanary(deployment)) return { kind: 'advance-canary' };
  if (phase === 'superseded') return { kind: 'rollback-to-this' };
  if (phase !== 'live') return null;
  // A live release with no traffic is promoted, not rolled back to (rollback-status.tsx).
  if ((deployment.traffic_percent ?? 0) === 0) return { kind: 'promote' };
  const targetId = summary?.rollback_target_id;
  if (!targetId) return null;
  const revision = summary.rollback_target_revision;
  return {
    kind: 'rollback-to',
    targetId,
    targetLabel: revision ? `v${revision}` : targetId.slice(0, 8),
  };
}
