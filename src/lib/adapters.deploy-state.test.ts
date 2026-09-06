import { describe, expect, it } from 'vitest';
import { toDeployment } from './api/adapters';
import { hasRollbackTarget, hasRunnableDeployment } from './deployment-status';
import type { components } from './api/schema';

/**
 * The list's state pill is derived from the API status, and it used to be
 * derived by a second, drifted copy of the vocabulary: `live` fell through to
 * "building", so a deployment that was actually serving traffic was labelled
 * as still building.
 */
function deployment(status: string) {
  return {
    id: 'd1',
    app_id: 'a1',
    image_digest: 'sha256:abc',
    kind: 'github',
    status,
    created_at: '2026-09-06T10:00:00Z',
  } as components['schemas']['DeploymentResponse'];
}

const slugs = new Map([['a1', 'api']]);

describe('toDeployment state', () => {
  it.each([
    ['live', 'succeeded'],
    ['superseded', 'succeeded'],
    ['failed', 'failed'],
    ['cancelled', 'failed'],
    ['pending', 'building'],
    ['building', 'building'],
    ['imaging', 'building'],
    ['snapshotting', 'building'],
  ])('renders %s as %s', (status, expected) => {
    expect(toDeployment(deployment(status), slugs).state).toBe(expected);
  });

  it('keeps an unknown status out of the succeeded bucket', () => {
    // succeeded gates rollback and invoke, so an unrecognised status must not
    // land there just because it is not obviously a failure.
    expect(toDeployment(deployment('future_status'), slugs).state).toBe('building');
  });
});

/**
 * `succeeded` is not just a label: it gates the Logs page and the rollback
 * button. While the mapping only recognised `active` / `succeeded` /
 * `complete` — none of which apid emits — nothing ever reached `succeeded`,
 * so against the real API those two surfaces were permanently switched off.
 * The dev mock seeded the spec's `"active"` example, which is why it looked
 * fine in development.
 */
describe('what the state gates', () => {
  const slugs = new Map([['a1', 'api']]);
  const account = ['live', 'superseded', 'superseded', 'failed'].map((status) =>
    toDeployment(deployment(status), slugs)
  );

  it('lets a live deployment serve logs', () => {
    expect(hasRunnableDeployment(account)).toBe(true);
  });

  it('offers rollback once an earlier deployment has shipped', () => {
    expect(hasRollbackTarget(account)).toBe(true);
  });

  it('offers neither while the first deployment is still building', () => {
    const building = [toDeployment(deployment('building'), slugs)];
    expect(hasRunnableDeployment(building)).toBe(false);
    expect(hasRollbackTarget(building)).toBe(false);
  });
});
