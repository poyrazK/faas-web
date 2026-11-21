import { describe, expect, it } from 'vitest';
import type { Deployment, DeploymentSummary } from '@/lib/api/queries';
import { chooseMainAction } from './main-action';

const release = (overrides: Partial<Deployment>): Deployment =>
  ({
    id: 'dep-1',
    app_id: 'app-1',
    status: 'active',
    traffic_percent: 100,
    ...overrides,
  }) as Deployment;
const summary = (overrides: Partial<DeploymentSummary>): DeploymentSummary =>
  ({ deployment: release({}), ...overrides }) as DeploymentSummary;

describe('chooseMainAction', () => {
  it.each([
    [
      'a failed release retries',
      release({ status: 'failed', traffic_percent: 0 }),
      undefined,
      { kind: 'retry' },
    ],
    [
      'a cancelled release offers nothing',
      release({ status: 'cancelled', traffic_percent: 0 }),
      undefined,
      null,
    ],
    [
      'a canary mid-rollout advances',
      release({
        rollout_state: 'rolling_out',
        canary_total_steps: 4,
        canary_step: 2,
        traffic_percent: 25,
      }),
      undefined,
      { kind: 'advance-canary' },
    ],
    [
      'a superseded release rolls back to itself',
      release({ status: 'superseded', traffic_percent: 0 }),
      undefined,
      { kind: 'rollback-to-this' },
    ],
    [
      'a live release with no traffic is promoted',
      release({ traffic_percent: 0 }),
      summary({ rollback_target_id: 'dep-0' }),
      { kind: 'promote' },
    ],
    [
      'a serving release rolls back to its target',
      release({}),
      summary({ rollback_target_id: 'dep-0', rollback_target_revision: 13 }),
      { kind: 'rollback-to', targetId: 'dep-0', targetLabel: 'v13' },
    ],
    [
      'a target without a revision is named by its ID',
      release({}),
      summary({ rollback_target_id: '0123456789abcdef' }),
      { kind: 'rollback-to', targetId: '0123456789abcdef', targetLabel: '01234567' },
    ],
    ['a serving release with nothing to return to offers nothing', release({}), undefined, null],
  ] as const)('%s', (_name, deployment, given, expected) => {
    expect(chooseMainAction(deployment, given)).toEqual(expected);
  });
});
