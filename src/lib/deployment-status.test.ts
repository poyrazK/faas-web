import { describe, expect, it } from 'vitest';
import {
  deploymentPhase,
  hasRollbackTarget,
  hasRunnableDeployment,
  isDeploymentTerminal,
} from './deployment-status';

describe('deploymentPhase', () => {
  it('treats active and succeeded deployments as live', () => {
    expect(deploymentPhase('active')).toBe('live');
    expect(deploymentPhase('succeeded')).toBe('live');
  });

  it('distinguishes queued work from a running build', () => {
    expect(deploymentPhase('pending')).toBe('queued');
    expect(deploymentPhase('running')).toBe('building');
    expect(deploymentPhase('snapshotting')).toBe('building');
  });

  it('maps failures to a terminal phase', () => {
    expect(deploymentPhase('failed')).toBe('failed');
    expect(deploymentPhase('cancelled')).toBe('failed');
    expect(isDeploymentTerminal('error')).toBe(true);
  });

  /**
   * The vocabulary `apid` actually emits, from `pkg/state/types.go`. The
   * OpenAPI types `status` as a bare string with `example: "active"`, which is
   * a value the API has never produced — so this is pinned against the source
   * rather than the spec.
   */
  it('covers every status apid emits', () => {
    expect(deploymentPhase('pending')).toBe('queued');
    expect(deploymentPhase('building')).toBe('building');
    expect(deploymentPhase('imaging')).toBe('building');
    expect(deploymentPhase('snapshotting')).toBe('building');
    expect(deploymentPhase('live')).toBe('live');
    expect(deploymentPhase('failed')).toBe('failed');
    expect(deploymentPhase('superseded')).toBe('superseded');
    expect(deploymentPhase('cancelled')).toBe('failed');
  });

  it('treats a superseded deployment as finished, so nothing polls it', () => {
    // It deployed, then a newer one replaced it. Every redeploy makes one, so
    // reading it as unfinished kept the deployments list polling forever.
    expect(isDeploymentTerminal('superseded')).toBe(true);
  });

  it('keeps unknown statuses safe and non-terminal', () => {
    expect(deploymentPhase('future_status')).toBe('queued');
    expect(isDeploymentTerminal('future_status')).toBe(false);
    expect(isDeploymentTerminal(undefined)).toBe(false);
  });
});

describe('hasRollbackTarget', () => {
  it('requires an earlier successful deployment', () => {
    expect(hasRollbackTarget([])).toBe(false);
    expect(hasRollbackTarget([{ state: 'succeeded' }])).toBe(false);
    expect(hasRollbackTarget([{ state: 'succeeded' }, { state: 'failed' }])).toBe(false);
    expect(hasRollbackTarget([{ state: 'succeeded' }, { state: 'succeeded' }])).toBe(true);
  });
});

describe('hasRunnableDeployment', () => {
  it('requires a successful deployment', () => {
    expect(hasRunnableDeployment([])).toBe(false);
    expect(hasRunnableDeployment([{ state: 'building' }])).toBe(false);
    expect(hasRunnableDeployment([{ state: 'failed' }])).toBe(false);
    expect(hasRunnableDeployment([{ state: 'failed' }, { state: 'succeeded' }])).toBe(true);
  });
});
