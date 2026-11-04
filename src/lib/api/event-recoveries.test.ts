import { describe, expect, it } from 'vitest';
import { recoveryTarget, type RecoveryAction } from './event-recoveries';

const body = {
  event_source: 'billing',
  event_id: 'inv_1',
  subscription_id: '5f2b7c1e-1d0a-4c55-9d0e-6a1f1e0b3c02',
};
const action = (kind: RecoveryAction['kind'], url: string, extra = {}): RecoveryAction => ({
  kind,
  method: 'POST',
  url,
  ...extra,
});

describe('recoveryTarget', () => {
  it('maps each receipt action to the typed operation apid named', () => {
    expect(
      recoveryTarget(
        action(
          'routing_replay',
          '/v1/apps/billing%20recon/event-deliveries:replay-fanout-failure',
          {
            body,
          }
        )
      )
    ).toEqual({ op: 'routing_replay', slug: 'billing recon', body });
    expect(recoveryTarget(action('handler_replay', '/v1/invocations/abc/replay'))).toEqual({
      op: 'handler_replay',
      id: 'abc',
    });
    expect(
      recoveryTarget(action('keyed_handler_replay', '/v1/invocations/abc/replay-keyed'))
    ).toEqual({ op: 'keyed_handler_replay', id: 'abc' });
    expect(recoveryTarget(action('dead_letter_replay', '/v1/apps/api/dlq/d1/replay'))).toEqual({
      op: 'dead_letter_replay',
      slug: 'api',
      id: 'd1',
    });
  });

  it('refuses a URL that is not the operation its kind names', () => {
    expect(recoveryTarget(action('handler_replay', '/v1/invocations/abc/replay-keyed'))).toBeNull();
    expect(
      recoveryTarget(action('handler_replay', 'https://evil.example/v1/invocations/a/replay'))
    ).toBeNull();
    expect(recoveryTarget(action('dead_letter_replay', '/v1/apps/api/dlq/../x/replay'))).toBeNull();
    // A routing replay without its guarded body is not submitted.
    expect(
      recoveryTarget(
        action('routing_replay', '/v1/apps/api/event-deliveries:replay-fanout-failure')
      )
    ).toBeNull();
    expect(
      recoveryTarget({
        ...action('handler_replay', '/v1/invocations/a/replay'),
        method: 'GET' as never,
      })
    ).toBeNull();
  });
});
