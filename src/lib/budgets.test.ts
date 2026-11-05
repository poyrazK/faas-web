import { describe, expect, it } from 'vitest';
import { ApiError } from './api/errors';
import {
  budgetLevel,
  budgetRefusal,
  draftErrors,
  draftFromSpec,
  effectText,
  emptyDraft,
  guaranteeText,
  isStrictCompute,
  reasonText,
  specFromDraft,
  stopSummary,
  type BudgetDraft,
  type BudgetSpec,
} from './budgets';

const SPEC: BudgetSpec = {
  name: 'Monthly compute',
  scope: { kind: 'account' },
  currency: 'USD',
  meters: ['compute'],
  basis: 'net_usage',
  limit_millicents: 1_000_000,
  notify_millicents: [800_000],
  mode: 'monitored',
  action: 'notify',
  drain_seconds: 0,
  resume_rule: 'next_period',
  enabled: true,
};

const draft = (over: Partial<BudgetDraft> = {}): BudgetDraft => ({
  ...emptyDraft(),
  name: 'Budget',
  limit: '10',
  ...over,
});

const problem = (code: string, status = 422) =>
  new ApiError({ code, status, title: code, detail: `${code} detail` });

describe('budgetLevel', () => {
  it('grades the three intents the console authors and leaves the rest to the API', () => {
    expect(budgetLevel(SPEC)).toBe('alert');
    expect(budgetLevel({ ...SPEC, action: 'stop_previews' })).toBe('stop-previews');
    expect(budgetLevel({ ...SPEC, mode: 'strict', action: 'suspend_workloads' })).toBe('strict');
    expect(budgetLevel({ ...SPEC, action: 'reject_traffic' })).toBe('api');
    expect(budgetLevel({ ...SPEC, action: 'suspend_background' })).toBe('api');
    // stop_previews only activates over compute alone (pkg/financial/stop.go:7).
    expect(budgetLevel({ ...SPEC, action: 'stop_previews', meters: ['compute', 'egress'] })).toBe(
      'api'
    );
  });
});

describe('isStrictCompute', () => {
  const strict: BudgetSpec = {
    ...SPEC,
    mode: 'strict',
    action: 'suspend_workloads',
    notify_millicents: [],
    scope: { kind: 'app', id: 'a' },
    basis: 'gross_usage',
  };
  it('mirrors pkg/financial/compute.go: gross for a resource, net for the account', () => {
    expect(isStrictCompute(strict)).toBe(true);
    expect(isStrictCompute({ ...strict, basis: 'net_usage' })).toBe(false);
    expect(isStrictCompute({ ...strict, scope: { kind: 'account' }, basis: 'net_usage' })).toBe(
      true
    );
    expect(
      isStrictCompute({
        ...strict,
        scope: { kind: 'account' },
        basis: 'net_usage',
        meters: ['compute', 'egress'],
      })
    ).toBe(true);
    expect(isStrictCompute({ ...strict, meters: ['compute', 'egress'] })).toBe(false);
    expect(isStrictCompute({ ...strict, notify_millicents: [1] })).toBe(false);
    expect(isStrictCompute({ ...strict, drain_seconds: 5 })).toBe(false);
  });
});

describe('specFromDraft', () => {
  it('writes an alert as monitored notify with no drain', () => {
    const spec = specFromDraft(draft({ thresholds: '5, 8' }));
    expect(spec).toEqual({
      name: 'Budget',
      scope: { kind: 'account' },
      currency: 'USD',
      meters: ['compute'],
      basis: 'net_usage',
      limit_millicents: 1_000_000,
      notify_millicents: [500_000, 800_000],
      mode: 'monitored',
      action: 'notify',
      drain_seconds: 0,
      resume_rule: 'next_period',
      enabled: true,
    });
  });

  it('keeps meters sorted, as apid requires (pkg/financial/budget.go:56)', () => {
    const spec = specFromDraft(draft({ meters: ['object_storage', 'compute', 'egress'] }));
    expect(spec.meters).toEqual(['compute', 'egress', 'object_storage']);
  });

  it('drops object storage outside an account budget', () => {
    const spec = specFromDraft(
      draft({ scopeKind: 'app', scopeId: 'app-1', meters: ['compute', 'object_storage'] })
    );
    expect(spec.meters).toEqual(['compute']);
    expect(spec.scope).toEqual({ kind: 'app', id: 'app-1' });
  });

  it('stops previews over compute only, with the drain and resume rule', () => {
    const spec = specFromDraft(
      draft({
        level: 'stop-previews',
        meters: ['compute', 'egress'],
        drainSeconds: '30',
        resumeRule: 'manual',
      })
    );
    expect(spec).toMatchObject({
      mode: 'monitored',
      action: 'stop_previews',
      meters: ['compute'],
      drain_seconds: 30,
      resume_rule: 'manual',
    });
  });

  it('writes a strict cap the way apid can activate it: no thresholds, no drain', () => {
    const app = specFromDraft(
      draft({
        level: 'strict',
        scopeKind: 'app',
        scopeId: 'a',
        thresholds: '5',
        basis: 'net_usage',
      })
    );
    expect(app).toMatchObject({
      mode: 'strict',
      action: 'suspend_workloads',
      basis: 'gross_usage',
      meters: ['compute'],
      notify_millicents: [],
      drain_seconds: 0,
    });
    expect(isStrictCompute(app)).toBe(true);
    const account = specFromDraft(draft({ level: 'strict', meters: ['compute', 'egress'] }));
    expect(account).toMatchObject({ basis: 'net_usage', meters: ['compute', 'egress'] });
    expect(isStrictCompute(account)).toBe(true);
  });

  it('round-trips through draftFromSpec', () => {
    expect(specFromDraft(draftFromSpec(SPEC))).toEqual(SPEC);
    const strict: BudgetSpec = {
      ...SPEC,
      mode: 'strict',
      action: 'suspend_workloads',
      notify_millicents: [],
      scope: { kind: 'project', id: 'p' },
      basis: 'gross_usage',
      resume_rule: 'manual',
      enabled: false,
    };
    expect(specFromDraft(draftFromSpec(strict))).toEqual(strict);
  });
});

describe('draftErrors', () => {
  it('accepts a complete alert', () => {
    expect(draftErrors(draft())).toEqual({});
  });
  it('names each rule apid enforces', () => {
    expect(draftErrors(draft({ name: '  ' })).name).toMatch(/name/i);
    expect(draftErrors(draft({ name: 'x'.repeat(129) })).name).toMatch(/128/);
    expect(draftErrors(draft({ limit: 'ten' })).limit).toMatch(/dollar/i);
    expect(draftErrors(draft({ scopeKind: 'app' })).scope).toMatch(/choose/i);
    expect(draftErrors(draft({ thresholds: '8, 5' })).thresholds).toMatch(/increase/i);
    expect(draftErrors(draft({ thresholds: '12' })).thresholds).toMatch(/limit/i);
    expect(draftErrors(draft({ thresholds: '1,2,3,4,5,6,7,8,9' })).thresholds).toMatch(/8/);
    expect(draftErrors(draft({ meters: [] })).meters).toMatch(/meter/i);
    expect(draftErrors(draft({ level: 'stop-previews', drainSeconds: '301' })).drain).toMatch(
      /300/
    );
  });
  it('does not offer a stopping action on a job, which apid refuses (budget.go:80)', () => {
    expect(
      draftErrors(draft({ level: 'stop-previews', scopeKind: 'job', scopeId: 'j' })).scope
    ).toMatch(/job/i);
  });
  it('ignores thresholds on a strict cap, which carries none', () => {
    expect(draftErrors(draft({ level: 'strict', thresholds: 'nope' }))).toEqual({});
  });
});

describe('budgetRefusal', () => {
  const strict = specFromDraft(draft({ level: 'strict', scopeKind: 'app', scopeId: 'a' }));
  it('reads activation_unavailable on an enabled strict cap as "not released"', () => {
    const refusal = budgetRefusal(problem('financial_budget_activation_unavailable'), strict);
    expect(refusal.strictNotReleased).toBe(true);
    expect(refusal.message).toMatch(/not released/i);
  });
  it('does not call a monitored refusal "not released"', () => {
    const refusal = budgetRefusal(problem('financial_budget_activation_unavailable'), {
      ...SPEC,
      action: 'reject_traffic',
    });
    expect(refusal.strictNotReleased).toBe(false);
    expect(refusal.message).toMatch(/draft/i);
  });
  it('explains the strict readiness and funding refusals by code', () => {
    expect(budgetRefusal(problem('financial_compute_not_ready'), strict).message).toMatch(/idle/i);
    expect(budgetRefusal(problem('financial_compute_budget_too_low'), strict).message).toMatch(
      /committed/i
    );
    expect(budgetRefusal(problem('conflict', 409), strict).message).toMatch(/changed/i);
  });
  it('falls back to the API sentence', () => {
    expect(budgetRefusal(problem('validation_failed', 400), SPEC).message).toBe(
      'validation_failed detail'
    );
  });
});

describe('words for codes', () => {
  it('translates reasons, including meter-prefixed evidence reasons', () => {
    expect(reasonText('notification_only_workloads_continue')).toMatch(/keep running/i);
    expect(reasonText('compute:missing_scope_attribution')).toMatch(/^Compute: /);
    expect(reasonText('compute:insufficient_history')).toMatch(/day/);
    expect(reasonText('something_new')).toBe('something new');
  });
  it('translates guarantees and target effects', () => {
    expect(guaranteeText('notification_only_after_retained_evidence;workloads_continue')).toMatch(
      /keep running/i
    );
    expect(effectText('block_traffic_and_wakes_then_stop_at_drain_deadline')).toMatch(/stopped/);
    expect(effectText('compute_can_continue')).toMatch(/keeps running/i);
  });
});

describe('stopSummary', () => {
  const preview = {
    targets: [
      { kind: 'app' as const, id: '1', name: 'pr-42-api', effect: 'x' },
      { kind: 'app' as const, id: '2', name: 'pr-43-api', effect: 'x' },
    ],
    continuing_targets: [{ kind: 'app' as const, id: '3', name: 'api', effect: 'x' }],
  };
  it('names what stops and what keeps running for a preview stop', () => {
    const spec = specFromDraft(
      draft({ level: 'stop-previews', drainSeconds: '30', resumeRule: 'next_period' })
    );
    const text = stopSummary(spec, 'the whole account', preview);
    expect(text).toMatch(/\$10\.00/);
    expect(text).toMatch(/pr-42-api, pr-43-api/);
    expect(text).toMatch(/30 seconds/);
    expect(text).toMatch(/api keeps running/);
    expect(text).toMatch(/next UTC month/);
  });
  it('names every held workload for a strict cap', () => {
    const spec = specFromDraft(draft({ level: 'strict', resumeRule: 'manual' }));
    const text = stopSummary(spec, 'the whole account', preview);
    expect(text).toMatch(/held/);
    expect(text).toMatch(/pr-42-api/);
    expect(text).toMatch(/until you change/i);
  });
  it('says what stops by scope when the preview could not be read', () => {
    const spec = specFromDraft(draft({ level: 'stop-previews' }));
    expect(stopSummary(spec, 'api', undefined)).toMatch(/every preview app in api/);
    expect(stopSummary(spec, 'api', undefined)).toMatch(/at once, with no drain/);
  });
  it('truncates a long list', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      kind: 'app' as const,
      id: String(i),
      name: `pr-${i}`,
      effect: 'x',
    }));
    const spec = specFromDraft(draft({ level: 'stop-previews' }));
    expect(stopSummary(spec, 'x', { targets: many, continuing_targets: [] })).toMatch(/and 4 more/);
  });
});
