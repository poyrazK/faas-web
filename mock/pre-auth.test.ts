import { describe, expect, it } from 'vitest';
import { policies, refusal } from './pre-auth';

const login = {
  mode: 'observe' as const,
  requests_per_second: 20,
  burst: 40,
  routes: [
    {
      method: 'POST' as const,
      path: '/login',
      requests_per_second: 2,
      burst: 4,
      coordination: 'central' as const,
      failed_responses: { failures_per_minute: 5, burst: 3 },
      observe_targets: true,
    },
  ],
};

describe('pre-auth mock', () => {
  it('stores the documented login guard and any off guard', () => {
    expect(refusal(login, 'pro')).toBeUndefined();
    expect(refusal({ mode: 'off', requests_per_second: 9999 }, 'free')).toBeUndefined();
  });

  it("refuses a rate over the plan's, in apid's words", () => {
    expect(refusal({ ...login, requests_per_second: 30, routes: [] }, 'hobby')).toBe(
      'pre_auth_rate_limit requests_per_second must be 1..20 and burst must be 1..100'
    );
  });

  it('refuses a route over the app-wide rate and a target signal without central coordination', () => {
    const fast = { ...login, routes: [{ ...login.routes[0], requests_per_second: 21 }] };
    expect(refusal(fast, 'pro')).toMatch(/must not exceed the app-wide rate/);
    const local = { ...login, routes: [{ ...login.routes[0], coordination: 'local' as const }] };
    expect(refusal(local, 'pro')).toMatch(/observe_targets requires POST/);
  });

  it('counts one policy per configured slot, none for an off guard', () => {
    const n = (v: number) => v;
    expect(policies(login, n).map((p) => p.policy_id)).toEqual([
      'app',
      'route_0',
      'failures_0',
      'targets_0',
    ]);
    expect(policies({ ...login, mode: 'off' }, n)).toEqual([]);
    expect(policies(undefined, n)).toEqual([]);
  });
});
