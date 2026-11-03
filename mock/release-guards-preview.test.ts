import { describe, expect, it } from 'vitest';
import type { components } from '../src/lib/api/schema';
import { mockCapabilities } from './capabilities';
import * as db from './data';
import { list as rollbacks, get as rollback } from './alert-rollbacks';
import { ALWAYS_STRIPPED, replay, summary } from './mirrors';
import { GuardProblem } from './release-freezes';
import { get as getGate, set as setGate } from './route-health-gate';

type Rule = components['schemas']['MirrorRuleResponse'];
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof GuardProblem ? { status: err.status, code: err.code } : err;
  }
  return null;
};

it('lists the three capabilities as previews on the plans the catalog names', () => {
  const pro = mockCapabilities('pro', []).capabilities;
  const hobby = mockCapabilities('hobby', []).capabilities;
  for (const key of ['alert-rollbacks', 'route-health-canary-guard', 'traffic-mirroring'])
    expect(pro.find((c) => c.key === key)).toMatchObject({ maturity: 'preview', enabled: true });
  expect(hobby.find((c) => c.key === 'traffic-mirroring')).toMatchObject({
    enabled: false,
    unavailable_reason: 'plan_not_entitled',
  });
});

describe('mirrors', () => {
  const rule: Rule = {
    id: 'r',
    account_id: 'a',
    app_id: 'app',
    source_deployment_id: 's',
    mirror_deployment_id: 'm',
    percent: 10,
    enabled: true,
    include_body: true,
    allow_unsafe_methods: false,
    redact_headers: [],
    always_stripped_headers: ALWAYS_STRIPPED,
    created_at: '',
    updated_at: '',
  };

  it('answers every count the summary schema requires, changed share over complete comparisons', () => {
    const s = summary(rule, '24h');
    expect(s.incomplete_comparison_count).toBeGreaterThan(0);
    expect(s.changed_response_percent).toBeCloseTo(
      (100 * s.changed_response_count) / (s.total_invocations - s.incomplete_comparison_count)
    );
    expect(refused(() => summary(rule, '2d'))).toMatchObject({ code: 'invalid_mirror_window' });
  });

  it('queues a corpus, refuses writes without the acknowledgement and a disabled rule', () => {
    expect(replay(rule, { requests: [{ method: 'GET', path: '/orders' }] })).toMatchObject({
      queued: 1,
      invocations: [{ status: 'queued' }],
    });
    expect(
      refused(() => replay(rule, { requests: [{ method: 'POST', path: '/orders' }] }))
    ).toMatchObject({
      status: 400,
    });
    expect(
      replay(rule, { requests: [{ method: 'POST', path: '/orders' }], allow_unsafe_methods: true })
        .queued
    ).toBe(1);
    expect(
      refused(() =>
        replay({ ...rule, enabled: false }, { requests: [{ method: 'GET', path: '/' }] })
      )
    ).toMatchObject({
      status: 409,
      code: 'debug_replay_unsupported',
    });
  });
});

describe('route health guard', () => {
  const a = db.apps[1];

  it('starts in report mode at revision 0, and saves only at the revision read', () => {
    expect(getGate(a.slug, a.id)).toMatchObject({ mode: 'report', revision: 0, routes: [] });
    const saved = setGate(a.slug, a.id, {
      mode: 'enforce',
      on_regression: 'abort',
      expected_revision: 0,
      routes: [{ method: 'GET', path: '/v1/items/{id}', probe: { path: '/v1/items/1' } }],
    });
    expect(saved).toMatchObject({ revision: 1, mode: 'enforce' });
    expect(saved.warnings?.length).toBe(1);
    expect(
      refused(() => setGate(a.slug, a.id, { mode: 'report', expected_revision: 0, routes: [] }))
    ).toMatchObject({ status: 409, code: 'conflict' });
  });

  it('refuses enforce without routes, wildcards and probes on writes', () => {
    const b = db.apps[3];
    expect(
      refused(() => setGate(b.slug, b.id, { mode: 'enforce', expected_revision: 0, routes: [] }))
    ).toMatchObject({
      status: 400,
    });
    expect(
      refused(() =>
        setGate(b.slug, b.id, {
          mode: 'report',
          expected_revision: 0,
          routes: [{ method: 'GET', path: '/x/*' }],
        })
      )
    ).toMatchObject({ status: 400 });
    expect(
      refused(() =>
        setGate(b.slug, b.id, {
          mode: 'report',
          expected_revision: 0,
          routes: [{ method: 'POST', path: '/x', probe: { path: '/x' } }],
        })
      )
    ).toMatchObject({ status: 400 });
  });
});

describe('alert rollbacks', () => {
  it('lists the first app’s receipts newest update first and reads one by its fire', () => {
    const rows = rollbacks(db.apps[0].id);
    expect(rows.map((r) => r.status)).toEqual(['blocked', 'complete']);
    expect(rollback(db.apps[0].id, rows[1].id).historical).toBe(true);
    expect(refused(() => rollback(db.apps[1].id, rows[0].id))).toMatchObject({ status: 404 });
    expect(refused(() => rollback(db.apps[0].id, 'nope'))).toMatchObject({ status: 422 });
  });
});
