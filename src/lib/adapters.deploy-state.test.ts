import { describe, expect, it } from 'vitest';
import { toDeployment } from './api/adapters';
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
