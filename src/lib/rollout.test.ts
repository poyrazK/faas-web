import { describe, expect, it } from 'vitest';
import { inFlightRollout } from './rollout';

const d = (id: string, traffic_percent?: number) =>
  ({
    id,
    app_id: 'a',
    image_digest: 'sha',
    kind: 'source',
    status: 'running',
    created_at: '2026-08-01T00:00:00Z',
    traffic_percent,
  }) as never;

/** A rollout is in flight when a deployment holds part, not all, of the traffic. */
describe('inFlightRollout', () => {
  it('finds the partial-traffic deployment', () => {
    expect(inFlightRollout([d('old', 75), d('new', 25)])?.id).toBe('old');
  });
  it('is null when traffic is whole or absent', () => {
    expect(inFlightRollout([d('only', 100), d('idle')])).toBeNull();
    expect(inFlightRollout([])).toBeNull();
  });
});
