import { describe, expect, it } from 'vitest';
import {
  appQuotaExceeded,
  appQuotaRemaining,
  isPaidPlan,
  memoryAllowed,
  type PlanSnapshot,
} from './plan';

const free: PlanSnapshot = {
  plan: 'free',
  app_count: 1,
  limits: { ram_mb: 128, deployed_apps: 1 },
};

describe('plan capabilities', () => {
  it('recognises only non-free plans as paid', () => {
    expect(isPaidPlan('free')).toBe(false);
    expect(isPaidPlan('hobby')).toBe(true);
    expect(isPaidPlan(undefined)).toBe(false);
  });

  it('calculates app quota from the account snapshot', () => {
    expect(appQuotaRemaining(free)).toBe(0);
    expect(appQuotaExceeded(free)).toBe(true);
    expect(appQuotaRemaining({ ...free, app_count: 0 })).toBe(1);
    expect(appQuotaExceeded(null)).toBe(false);
  });

  it('checks the server-provided per-app memory ceiling', () => {
    expect(memoryAllowed(free, 128)).toBe(true);
    expect(memoryAllowed(free, 512)).toBe(false);
    // Unknown account state should not make the local designer unusable.
    expect(memoryAllowed(null, 2048)).toBe(true);
  });
});
