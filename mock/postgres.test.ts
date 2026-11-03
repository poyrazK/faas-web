import { describe, expect, it } from 'vitest';
import { pgCapState, pgConditions, pgSeedCompute, pgUsage, PG_PLAN_LIMITS } from './postgres';

const HOUR = 3600;

describe('pgCapState, as apid judges the compute cap', () => {
  it('warns at 80% of the allowance and suspends at it with overage off', () => {
    expect(pgCapState(59 * HOUR, 75 * HOUR, false)).toBe('healthy');
    expect(pgCapState(60 * HOUR, 75 * HOUR, false)).toBe('warning');
    expect(pgCapState(75 * HOUR, 75 * HOUR, false)).toBe('suspended');
  });
  it('runs on past the allowance with overage on, up to twice it', () => {
    expect(pgCapState(75 * HOUR, 75 * HOUR, true)).toBe('overage');
    expect(pgCapState(150 * HOUR, 75 * HOUR, true)).toBe('suspended');
  });
});

describe('pgUsage', () => {
  const now = Date.UTC(2026, 10, 3, 12);
  it('reports the plan’s allowance and a ceiling twice it with overage on', () => {
    const off = pgUsage({ plan: 'pro', used: 10 * HOUR, overage: false, readyDatabases: 1, now });
    const on = pgUsage({ plan: 'pro', used: 10 * HOUR, overage: true, readyDatabases: 1, now });
    expect(off).toMatchObject({
      period_start: '2026-11-01T00:00:00.000Z',
      database_limit: 3,
      compute_allowance_unit_seconds: 75 * HOUR,
      compute_ceiling_unit_seconds: 75 * HOUR,
      compute_cap_state: 'healthy',
    });
    expect(on.compute_ceiling_unit_seconds).toBe(150 * HOUR);
  });
  it('says when the cap suspended the databases only while it holds them', () => {
    const seeded = pgSeedCompute('suspended', PG_PLAN_LIMITS.pro.compute);
    const held = pgUsage({ plan: 'pro', used: seeded, overage: false, readyDatabases: 1, now });
    expect(held.compute_cap_state).toBe('suspended');
    expect(held.compute_suspended_at).toBeDefined();
    const lifted = pgUsage({ plan: 'pro', used: seeded, overage: true, readyDatabases: 1, now });
    expect(lifted.compute_cap_state).toBe('overage');
    expect(lifted.compute_suspended_at).toBeUndefined();
  });
});

describe('pgConditions', () => {
  it('reads a scaled-to-zero database as ready with reason suspended, not as stopped', () => {
    const status = pgConditions({ id: 'db', name: 'orders', state: 'ready', scale_to_zero: true });
    expect(status.conditions[0]).toMatchObject({
      type: 'Ready',
      status: 'True',
      reason: 'suspended',
    });
  });
  it('reads a scheduled delete as in progress and terminal for Ready', () => {
    const status = pgConditions({ id: 'db', name: 'orders', state: 'deleting' });
    expect(status.conditions[0]).toMatchObject({
      status: 'False',
      reason: 'deleting',
      terminal: true,
    });
    expect(status.conditions[1]).toMatchObject({ type: 'Progressing', status: 'True' });
  });
});
