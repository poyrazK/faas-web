import { describe, expect, it } from 'vitest';
import {
  policyWrite,
  parseVerificationAge,
  stepAdmittable,
  stepExplanation,
  type ReleasePolicy,
  type VerificationRun,
  type VerificationRunStep,
} from './binding-verification';

const POLICY: ReleasePolicy = {
  app_id: '00000000-0000-4000-8000-000000000001',
  scope: 'default',
  mode: 'enforce',
  revision: 3,
  max_verification_age: '10m0s',
  require_application_ack: false,
};

const form = {
  mode: 'enforce' as const,
  maxAge: '10m',
  requireAck: false,
  reason: '',
  queue: {},
  storage: {},
};

describe('policyWrite', () => {
  // faas pkg/apid/bindings/release_policy.go:11-25 and the Go client's
  // SetBindingReleasePolicy (pkg/api/binding_release_policy.go:86-96).
  it('uses the base route when neither the policy nor the form has requirements', () => {
    const write = policyWrite(POLICY, form);
    expect(write.route).toBe('/v1/apps/{slug}/bindings/release-policy');
    expect(write.body).toEqual({
      mode: 'enforce',
      expected_revision: 3,
      max_verification_age: '10m',
      require_application_ack: false,
    });
    expect('queue_requirements' in write.body).toBe(false);
    expect('object_storage_requirements' in write.body).toBe(false);
  });

  it('uses the queues route, and states storage too, once queue requirements exist', () => {
    const write = policyWrite(POLICY, { ...form, queue: { orders: 'handler_completion' } });
    expect(write.route).toBe('/v1/apps/{slug}/bindings/release-policy-with-queues');
    expect(write.body.queue_requirements).toEqual({ orders: 'handler_completion' });
  });

  it('clears stored queue requirements with an explicit empty map, never by omission', () => {
    const write = policyWrite(
      { ...POLICY, queue_requirements: { orders: 'consumer_readiness' } },
      form
    );
    expect(write.route).toBe('/v1/apps/{slug}/bindings/release-policy-with-queues');
    expect(write.body.queue_requirements).toEqual({});
  });

  it('retains stored storage requirements on the queues route', () => {
    const write = policyWrite(
      { ...POLICY, object_storage_requirements: { MEDIA: 'read' } },
      { ...form, queue: { orders: 'consumer_readiness' }, storage: { MEDIA: 'read' } }
    );
    expect(write.route).toBe('/v1/apps/{slug}/bindings/release-policy-with-queues');
    expect(write.body.object_storage_requirements).toEqual({ MEDIA: 'read' });
  });

  it('uses the storage route for storage-only requirements, including an explicit clear', () => {
    const set = policyWrite(POLICY, { ...form, storage: { MEDIA: 'read_write' } });
    expect(set.route).toBe('/v1/apps/{slug}/bindings/release-policy-with-object-storage');
    const clear = policyWrite({ ...POLICY, object_storage_requirements: { MEDIA: 'read' } }, form);
    expect(clear.route).toBe('/v1/apps/{slug}/bindings/release-policy-with-object-storage');
    expect(clear.body.object_storage_requirements).toEqual({});
    expect('queue_requirements' in clear.body).toBe(false);
  });

  it('sends a trimmed reason only when one is given', () => {
    expect(policyWrite(POLICY, { ...form, mode: 'off', reason: '  incident  ' }).body.reason).toBe(
      'incident'
    );
    expect('reason' in policyWrite(POLICY, form).body).toBe(false);
  });
});

describe('parseVerificationAge', () => {
  // ValidateBindingReleasePolicyRequest: whole seconds from 1s through 24h.
  it.each([
    ['10m', 600],
    ['10m0s', 600],
    ['1h30m', 5400],
    ['90s', 90],
    ['24h', 86400],
    ['1s', 1],
  ])('accepts %s', (text, seconds) => expect(parseVerificationAge(text)).toBe(seconds));

  it.each(['', '0s', '25h', '24h1s', '1.5s', '500ms', 'ten minutes', '10'])('rejects %s', (text) =>
    expect(parseVerificationAge(text)).toBeNull()
  );
});

const step = (over: Partial<VerificationRunStep> & { action?: string; reason?: string } = {}) => {
  const { action = 'probe', reason, ...rest } = over;
  return {
    plan: { type: 'service', name: 'billing', binding: 'BILLING', scope: 'app', action, reason },
    owned: false,
    status: 'planned',
    ...rest,
  } as VerificationRunStep;
};
const run = (status: VerificationRun['status']) => ({ status }) as VerificationRun;

describe('stepAdmittable', () => {
  it('admits only planned probe and queue-canary steps of a pending run', () => {
    expect(stepAdmittable(run('pending'), step())).toBe(true);
    expect(stepAdmittable(run('pending'), step({ action: 'queue-canary' }))).toBe(true);
    for (const action of ['reuse', 'wait', 'wait-queue', 'observe', 'skip', 'blocked'])
      expect(stepAdmittable(run('pending'), step({ action }))).toBe(false);
  });

  it('never admits a step twice or on a run that is no longer pending', () => {
    expect(stepAdmittable(run('pending'), step({ resource_id: 'x', status: 'queued' }))).toBe(
      false
    );
    for (const status of ['passed', 'blocked', 'cancelled', 'expired'] as const)
      expect(stepAdmittable(run(status), step())).toBe(false);
  });
});

describe('stepExplanation', () => {
  it('says a planned probe is waiting to be admitted', () => {
    expect(stepExplanation(step())).toMatch(/waiting for you to admit/i);
  });
  it('says a published canary has not proved anything yet', () => {
    expect(
      stepExplanation(
        step({
          action: 'queue-canary',
          resource_kind: 'queue',
          resource_id: 'q',
          status: 'published',
        })
      )
    ).toMatch(/not.*delivered/i);
  });
  it('names a failed or missing resource as needing a new run', () => {
    expect(
      stepExplanation(
        step({ resource_kind: 'task', resource_id: 't', status: 'failed', owned: true })
      )
    ).toMatch(/new run/i);
    expect(
      stepExplanation(step({ resource_kind: 'task', resource_id: 't', status: 'missing' }))
    ).toMatch(/new run/i);
  });
  it('explains reuse, skip and blocked plans from their reason', () => {
    expect(stepExplanation(step({ action: 'reuse', reason: 'evidence_current' }))).toMatch(
      /current evidence/i
    );
    expect(stepExplanation(step({ action: 'skip', reason: 'binding_disabled' }))).toMatch(
      /not checked/i
    );
    expect(
      stepExplanation(step({ action: 'blocked', reason: 'binding_selection_invalid' }))
    ).toMatch(/binding_selection_invalid/);
  });
});
