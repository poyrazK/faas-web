import { expect, it } from 'vitest';
import * as db from './data';
import { applyWarmStarts, warmPoolRows, warmStartsRefusal } from './warm-starts';

const fresh = (fields: Partial<db.App> = {}) =>
  ({
    ...db.apps[0],
    max_concurrency: 4,
    warm_pool_size: 0,
    warm_snapshot_enabled: false,
    manifest: { entrypoint: ['node'] },
    ...fields,
  }) as db.App;
const visible = new Set<string>();

it('stores the warm fields it is sent, and nothing else', () => {
  const app = fresh();
  const body = { warm_pool_size: 2, warm_snapshot_enabled: true, warm_snapshot_min_ms: 500 };
  expect(warmStartsRefusal(app, body, 'pro', visible)).toBeUndefined();
  applyWarmStarts(app, body);
  expect(app).toMatchObject({
    warm_pool_size: 2,
    warm_snapshot_enabled: true,
    warm_snapshot_min_ms: 500,
  });
});

it('refuses what apid refuses, with its codes (handlers_ext.go)', () => {
  const cases: [Partial<db.App>, Record<string, unknown>, string, number, string][] = [
    [{}, { warm_pool_size: 1 }, 'free', 403, 'plan_warm_pool_not_allowed'],
    [{}, { warm_pool_size: 5 }, 'hobby', 422, 'invalid_warm_pool_size'],
    [{}, { warm_pool_size: 6, max_concurrency: 6 }, 'hobby', 0, ''],
    [{ warm_pool_size: 3 }, { max_concurrency: 2 }, 'pro', 422, 'invalid_warm_pool_size'],
    [{}, { warm_snapshot_enabled: true }, 'hobby', 403, 'plan_warm_snapshot_not_allowed'],
    [{}, { warm_snapshot_min_ms: 99 }, 'pro', 422, 'invalid_warm_snapshot_min_ms'],
    [{}, { warm_snapshot_min_requests: 101 }, 'pro', 422, 'invalid_warm_snapshot_min_requests'],
  ];
  for (const [fields, body, plan, status, code] of cases) {
    const refusal = warmStartsRefusal(fresh(fields), body, plan, visible);
    if (!status) expect(refusal).toBeUndefined();
    else expect(refusal).toMatchObject({ status, code });
  }
  // Zero is always allowed: it turns the pool off, on any plan.
  expect(warmStartsRefusal(fresh(), { warm_pool_size: 0 }, 'free', visible)).toBeUndefined();
});

it('refuses a warm setting while the capability is hidden, but not turning one off', () => {
  const hidden = new Set(['warm-pool']);
  expect(warmStartsRefusal(fresh(), { warm_pool_size: 1 }, 'pro', hidden)).toMatchObject({
    status: 403,
    code: 'capability_not_released',
  });
  expect(
    warmStartsRefusal(fresh({ warm_pool_size: 2 }), { warm_pool_size: 0 }, 'pro', hidden)
  ).toBeUndefined();
});

it('reports a pool as paused instances, and none at the spend cap or for a worker', () => {
  const app = fresh({ warm_pool_size: 2 });
  const rows = warmPoolRows(app, 'pro', false);
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.state === 'warm' && row.resident)).toBe(true);
  expect(warmPoolRows(app, 'pro', false)[0].id).toBe(rows[0].id);
  expect(warmPoolRows(app, 'pro', true)).toEqual([]);
  expect(warmPoolRows(app, 'free', false)).toEqual([]);
  const worker = fresh({
    warm_pool_size: 2,
    manifest: { entrypoint: ['node'], execution_mode: 'worker' },
  });
  expect(warmPoolRows(worker, 'pro', false)).toEqual([]);
});
