/** The small, stable vocabulary the customer UI needs from an open API status. */
export type DeploymentPhase = 'queued' | 'building' | 'live' | 'failed';

const LIVE_STATUSES = new Set(['active', 'complete', 'completed', 'live', 'succeeded']);
const FAILED_STATUSES = new Set(['cancelled', 'crashed', 'error', 'failed']);
const BUILDING_STATUSES = new Set([
  'building',
  'deploying',
  'dispatching',
  'imaging',
  'running',
  'snapshotting',
]);

/**
 * Deployment status is intentionally an open string in the API. Keep the
 * console forward-compatible while giving the common states useful labels.
 */
export function deploymentPhase(status: string | undefined): DeploymentPhase {
  const normalized = (status ?? '').toLowerCase();
  if (LIVE_STATUSES.has(normalized)) return 'live';
  if (FAILED_STATUSES.has(normalized)) return 'failed';
  if (BUILDING_STATUSES.has(normalized)) return 'building';
  return 'queued';
}

export function isDeploymentTerminal(status: string | undefined): boolean {
  const phase = deploymentPhase(status);
  return phase === 'live' || phase === 'failed';
}
