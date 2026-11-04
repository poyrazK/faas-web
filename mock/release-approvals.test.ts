import { describe, expect, it } from 'vitest';
import { mockCapabilities } from './capabilities';
import * as db from './data';
import {
  decide,
  getPolicy,
  policies,
  removePolicy,
  setPolicy,
  statusOf,
  waiting,
} from './release-approvals';
import { GuardProblem } from './release-freezes';

const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof GuardProblem ? { status: err.status, code: err.code } : err;
  }
  return null;
};

it('lists release approvals as a preview on every plan', () => {
  const free = mockCapabilities('free', []).capabilities.find((c) => c.key === 'release-approvals');
  expect(free).toMatchObject({ maturity: 'preview', enabled: true });
});

describe('approval policies', () => {
  it('seeds webhook-router’s policy in the shape the API returns', () => {
    expect(getPolicy('webhook-router')).toMatchObject({
      approvers: 'admin',
      required_approvals: 1,
    });
    expect(refused(() => getPolicy('nightly-etl'))).toMatchObject({
      status: 404,
      code: 'release_approval_policy_not_found',
    });
  });

  it('normalizes a policy, needs a Slack or email channel, and counts a personal app’s own approval', () => {
    expect(refused(() => setPolicy('nightly-etl', { required_approvals: 1 }))).toMatchObject({
      status: 400,
    });
    expect(
      refused(() =>
        setPolicy('nightly-etl', { required_approvals: 1, notify_channels: ['oncall'] })
      )
    ).toMatchObject({
      code: 'validation_failed',
    });
    expect(
      setPolicy('nightly-etl', { required_approvals: 2, notify_channels: ['ops-slack'] })
    ).toMatchObject({
      after_stage: 1,
      timeout_minutes: 1440,
      approvers: 'admin',
      allow_self_approval: true,
    });
    removePolicy('nightly-etl');
    expect(policies.has('nightly-etl')).toBe(false);
    expect(refused(() => removePolicy('nightly-etl'))).toMatchObject({
      code: 'release_approval_policy_not_found',
    });
  });
});

describe('decisions', () => {
  const canary = () =>
    db.deployments.find(
      (d) => d.app_id === db.apps[0].id && d.rollout_state === 'rolling_out' && !d.scope
    )!;

  it('holds the rolling canary at its policy’s stage', () => {
    expect(statusOf(canary())).toMatchObject({
      state: 'waiting',
      required_approvals: 1,
      approvals: 0,
    });
    expect(waiting(db.apps[0].slug).map((s) => s.deployment_id)).toContain(canary().id);
  });

  it('needs a reason to reject, takes one decision per person, and is decided once approved', () => {
    const d = canary();
    expect(refused(() => decide(d, { decision: 'reject' }))).toMatchObject({
      code: 'validation_failed',
    });
    expect(decide(d, { decision: 'approve', comment: 'looks clean' })).toMatchObject({
      state: 'approved',
      approvals: 1,
    });
    expect(refused(() => decide(d, { decision: 'reject', comment: 'no' }))).toMatchObject({
      status: 409,
      code: 'release_approval_decided',
    });
  });

  it('answers a release without a policy as not required', () => {
    const other = db.deployments.find((d) => d.app_id === db.apps[4].id)!;
    expect(statusOf(other).state).toBe('not_required');
    expect(refused(() => decide(other, { decision: 'approve' }))).toMatchObject({
      code: 'release_approval_decided',
    });
  });
});
