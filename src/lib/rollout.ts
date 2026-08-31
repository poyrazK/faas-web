import type { components } from '@/lib/api/schema';

export type Deployment = components['schemas']['DeploymentResponse'];

const partial = (d: Deployment) =>
  d.traffic_percent != null && d.traffic_percent > 0 && d.traffic_percent < 100;

/**
 * A rollout is in flight when a deployment holds part, not all, of the
 * traffic. Returns the NEWEST partial deployment — the canary taking
 * traffic — so `100 - traffic_percent` is what the previous deployment
 * still holds.
 */
export function inFlightRollout(deployments: Deployment[]): Deployment | null {
  const partials = deployments.filter(partial);
  if (partials.length === 0) return null;
  return partials.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
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
