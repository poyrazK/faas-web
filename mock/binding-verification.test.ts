import { describe, expect, it } from 'vitest';
import {
  BindingMockProblem,
  admitRunStep,
  completeRun,
  createRun,
  goDuration,
  listRuns,
  readReleasePolicy,
  reviewRun,
  writeReleasePolicy,
} from './binding-verification';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof BindingMockProblem) return error.code;
    throw error;
  }
  return 'ok';
};

describe('release policy routes (faas bindings/release_policy.go)', () => {
  const a = { id: 'app-policy', slug: 'policy-app' };

  it('defaults to off at revision 0 and writes with the read revision', () => {
    expect(readReleasePolicy(a, null)).toMatchObject({ mode: 'off', revision: 0 });
    const next = writeReleasePolicy(a, null, 'base', {
      mode: 'enforce',
      expected_revision: 0,
      max_verification_age: '90s',
    });
    expect(next).toMatchObject({ mode: 'enforce', revision: 1, max_verification_age: '1m30s' });
    expect(
      code(() => writeReleasePolicy(a, null, 'base', { mode: 'enforce', expected_revision: 0 }))
    ).toBe('bindings_release_policy_changed');
  });

  it('keeps queue requirements on their own route and refuses implicit removal', () => {
    expect(
      code(() =>
        writeReleasePolicy(a, null, 'base', {
          mode: 'enforce',
          expected_revision: 1,
          queue_requirements: { orders: 'consumer_readiness' },
        })
      )
    ).toBe('validation_failed');
    writeReleasePolicy(a, null, 'queues', {
      mode: 'enforce',
      expected_revision: 1,
      queue_requirements: { orders: 'consumer_readiness' },
    });
    expect(
      code(() => writeReleasePolicy(a, null, 'base', { mode: 'enforce', expected_revision: 2 }))
    ).toBe('validation_failed');
  });

  it('needs a reason to turn enforcement off', () => {
    expect(
      code(() => writeReleasePolicy(a, 'staging', 'base', { mode: 'off', expected_revision: 0 }))
    ).toBe('validation_failed');
  });

  it('prints Go durations', () => {
    expect([goDuration(600), goDuration(5), goDuration(3600)]).toEqual(['10m0s', '5s', '1h0m0s']);
  });
});

describe('verification runs (faas bindings/verification_runs.go)', () => {
  const a = { id: 'app-runs', slug: 'runs-app', live: '22222222-2222-4222-8222-222222222222' };

  it('refuses a review until the policy is enforced', () => {
    expect(code(() => reviewRun(a, a.live, {}))).toBe('binding_verification_run_changed');
  });

  it('walks review → create → admit → complete', async () => {
    writeReleasePolicy(a, null, 'queues', {
      mode: 'enforce',
      expected_revision: 0,
      queue_requirements: { orders: 'handler_completion' },
    });
    const review = reviewRun(a, a.live, {});
    expect(review.queue_publish_required).toBe(true);
    const id = '11111111-1111-4111-8111-111111111111';
    const base = {
      id,
      deployment_id: a.live,
      review_digest: review.review_digest,
      ttl_seconds: 600,
      object_storage_write: false,
    };
    expect(code(() => createRun(a, { ...base, queue_publish: false }))).toBe('validation_failed');
    const run = createRun(a, { ...base, queue_publish: true, max_concurrency: 1 });
    expect(run.status).toBe('pending');
    expect(listRuns(a, new URLSearchParams()).runs.map((r) => r.id)).toEqual([id]);

    const probe = run.steps.findIndex((s) => s.plan.action === 'probe');
    const canary = run.steps.findIndex((s) => s.plan.action === 'queue-canary');
    expect(code(() => completeRun(a, id))).toBe('binding_verification_run_changed');
    expect(admitRunStep(a, id, probe)).toMatchObject({ owned: true, resource_kind: 'task' });
    // max_concurrency 1: the unfinished probe holds the only slot.
    expect(code(() => admitRunStep(a, id, canary))).toBe('binding_verification_budget_full');
  });
});
