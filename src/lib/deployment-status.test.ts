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
