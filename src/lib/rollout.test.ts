import { describe, expect, it } from 'vitest';
import { inFlightRollout } from './rollout';

const d = (id: string, traffic_percent: number | undefined, created_at: string) =>
  ({
    id,
    app_id: 'a',
    image_digest: 'sha',
    kind: 'source',
    status: 'running',
    created_at,
    traffic_percent,
  }) as never;

/**
 * A rollout is in flight when a deployment holds part, not all, of the
 * traffic; the newest partial is the canary, so its complement is what the
 * previous deployment still holds.
 */
describe('inFlightRollout', () => {
  it('returns the newest partial-traffic deployment', () => {
    expect(
      inFlightRollout([d('new', 25, '2026-08-02T00:00:00Z'), d('old', 75, '2026-08-01T00:00:00Z')])
        ?.id
    ).toBe('new');
  });

  it('is null when traffic is whole or absent', () => {
    expect(
      inFlightRollout([
        d('only', 100, '2026-08-02T00:00:00Z'),
        d('idle', undefined, '2026-08-01T00:00:00Z'),
      ])
    ).toBeNull();
    expect(inFlightRollout([])).toBeNull();
  });
});
