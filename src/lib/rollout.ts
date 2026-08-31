import type { components } from '@/lib/api/schema';

export type Deployment = components['schemas']['DeploymentResponse'];

/**
 * A rollout is in flight when a deployment holds part, not all, of the
 * traffic. The list is newest-first, so this finds the current canary pair's
 * partial half — enough to know the split and offer recovery.
 */
export function inFlightRollout(deployments: Deployment[]): Deployment | null {
  return (
    deployments.find(
      (d) => d.traffic_percent != null && d.traffic_percent > 0 && d.traffic_percent < 100
    ) ?? null
  );
}

export const ROLLOUT_ACTIONS = [
  {
    action: 'advance',
    label: 'Advance',
    description: 'Move to the next traffic step now instead of waiting for the timer.',
  },
  {
    action: 'promote',
    label: 'Promote',
    description: 'Send all traffic to the new deployment and finish the rollout.',
  },
  {
    action: 'abort',
    label: 'Abort',
    description: 'Return all traffic to the previous deployment.',
  },
] as const;
