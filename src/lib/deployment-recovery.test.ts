import { describe, expect, it } from 'vitest';
import { deploymentRecovery } from './deployment-recovery';
describe('deployment recovery state policy', () => {
  it.each(['pending', 'building', 'imaging', 'snapshotting'])(
    'allows cancellation in supported %s state',
    (status) => {
      expect(deploymentRecovery(status).kind).toBe('cancel');
    }
  );
  it('allows retry only for an exact failed release', () => {
    expect(deploymentRecovery('failed').kind).toBe('retry');
    expect(deploymentRecovery('failed').explanation).toContain('new attempt');
  });
  it.each(['live', 'superseded', 'cancelled', 'complete', 'running', 'FAILED', 'future-state', ''])(
    'explains unavailable recovery without guessing support for %s',
    (status) => {
      const availability = deploymentRecovery(status);
      expect(availability.kind).toBe('unavailable');
      expect(availability.explanation.length).toBeGreaterThan(0);
    }
  );
});
