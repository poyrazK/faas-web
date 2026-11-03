import { describe, expect, it } from 'vitest';
import {
  NO_RETRY_DRAFT,
  describeRetryPolicy,
  durationSeconds,
  invocationLimits,
  retryDraftErrors,
  retryDraftFrom,
  retryPolicyFromDraft,
} from './invocation-options';

describe('retryDraftErrors', () => {
  it('accepts a blank draft, which keeps the default', () => {
    expect(retryDraftErrors(NO_RETRY_DRAFT)).toEqual({});
  });

  it('holds max attempts to a whole number from 1 to 25, as apid does', () => {
    expect(retryDraftErrors({ ...NO_RETRY_DRAFT, maxAttempts: '26' }).maxAttempts).toMatch(/1.*25/);
    expect(retryDraftErrors({ ...NO_RETRY_DRAFT, maxAttempts: '2.5' }).maxAttempts).toBeDefined();
    expect(retryDraftErrors({ ...NO_RETRY_DRAFT, maxAttempts: '0' }).maxAttempts).toBeDefined();
    expect(retryDraftErrors({ ...NO_RETRY_DRAFT, maxAttempts: '25' })).toEqual({});
  });

  it('refuses negative delays and a ceiling below the first delay', () => {
    expect(retryDraftErrors({ ...NO_RETRY_DRAFT, baseSeconds: '-1' }).baseSeconds).toBeDefined();
    expect(
      retryDraftErrors({ ...NO_RETRY_DRAFT, baseSeconds: '10', maxSeconds: '5' }).maxSeconds
    ).toMatch(/at least/);
  });

  it('holds jitter to 0–100 percent', () => {
    expect(retryDraftErrors({ ...NO_RETRY_DRAFT, jitter: '120' }).jitter).toBeDefined();
    expect(retryDraftErrors({ ...NO_RETRY_DRAFT, jitter: '20' })).toEqual({});
  });
});

describe('retryPolicyFromDraft', () => {
  it('sends nothing for a blank draft', () => {
    expect(retryPolicyFromDraft(NO_RETRY_DRAFT)).toBeUndefined();
  });

  it('sends only the fields that were set, with jitter as a fraction', () => {
    expect(
      retryPolicyFromDraft({ maxAttempts: '4', baseSeconds: '1', maxSeconds: '', jitter: '20' })
    ).toEqual({ max_attempts: 4, base_seconds: 1, jitter_seconds: 0.2 });
  });

  it('throws the first problem rather than sending a policy apid refuses', () => {
    expect(() => retryPolicyFromDraft({ ...NO_RETRY_DRAFT, maxAttempts: '40' })).toThrow(/25/);
  });

  it('round-trips through retryDraftFrom', () => {
    const policy = { max_attempts: 5, base_seconds: 2, max_seconds: 60, jitter_seconds: 0.25 };
    expect(retryPolicyFromDraft(retryDraftFrom(policy))).toEqual(policy);
    expect(retryDraftFrom(null)).toEqual(NO_RETRY_DRAFT);
  });
});

describe('describeRetryPolicy', () => {
  it('says the plan decides when no policy is set', () => {
    expect(describeRetryPolicy(null, 'pro')).toBe(
      'Plan default: up to 10 attempts, first retry after 1 s, doubling each time'
    );
  });

  it('describes a full curve', () => {
    expect(
      describeRetryPolicy(
        { max_attempts: 4, base_seconds: 1, max_seconds: 30, jitter_seconds: 0.2 },
        'pro'
      )
    ).toBe('Up to 4 attempts, first retry after 1 s, doubling to at most 30 s, ±20% jitter');
  });

  it('notes when the plan caps the attempts that were asked for', () => {
    expect(describeRetryPolicy({ max_attempts: 8 }, 'hobby')).toMatch(
      /^Up to 3 attempts \(8 asked, capped by the plan\)/
    );
  });
});

describe('invocationLimits', () => {
  it("mirrors apid's plan ceilings for attempts and result retention", () => {
    expect(invocationLimits('hobby')).toEqual({ maxAttempts: 3, retentionSeconds: 604_800 });
    expect(invocationLimits('scale')).toEqual({ maxAttempts: 25, retentionSeconds: 7_776_000 });
    expect(invocationLimits(undefined)).toBeUndefined();
  });
});

describe('durationSeconds', () => {
  it('converts an amount and unit to whole seconds', () => {
    expect(durationSeconds({ amount: '30', unit: 'minutes' })).toBe(1800);
    expect(durationSeconds({ amount: '1.5', unit: 'hours' })).toBe(5400);
    expect(durationSeconds({ amount: '', unit: 'days' })).toBeNull();
  });

  it('refuses a non-positive or fractional-second amount', () => {
    expect(durationSeconds({ amount: '0', unit: 'hours' })).toBeNaN();
    expect(durationSeconds({ amount: '1.5', unit: 'seconds' })).toBeNaN();
    expect(durationSeconds({ amount: 'soon', unit: 'hours' })).toBeNaN();
  });
});
