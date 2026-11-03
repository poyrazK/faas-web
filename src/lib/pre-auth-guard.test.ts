import { describe, expect, it } from 'vitest';
import {
  enforceEffect,
  preAuthConfig,
  preAuthDraft,
  preAuthSummary,
  samePreAuth,
  validatePreAuth,
  type PreAuthConfig,
} from './pre-auth-guard';

const login: PreAuthConfig = {
  mode: 'observe',
  requests_per_second: 20,
  burst: 40,
  routes: [
    {
      method: 'POST',
      path: '/login',
      requests_per_second: 2,
      burst: 4,
      coordination: 'central',
      failed_responses: { failures_per_minute: 5, burst: 3, statuses: [401, 403] },
      observe_targets: true,
    },
  ],
};

describe('preAuthDraft / preAuthConfig', () => {
  it('round-trips a stored guard, route overrides included', () => {
    expect(preAuthConfig(preAuthDraft(login, { rps: 10, burst: 20 }))).toEqual(login);
  });

  it('reads an app with no stored guard as off, with the default rate ready for observe', () => {
    const draft = preAuthDraft(undefined, { rps: 5, burst: 20 });
    expect(draft).toMatchObject({ mode: 'off', requests_per_second: 5, burst: 20, routes: [] });
  });

  it('leaves the local defaults out rather than writing them', () => {
    const draft = preAuthDraft(
      {
        mode: 'observe',
        requests_per_second: 10,
        burst: 20,
        routes: [
          {
            method: 'GET',
            path: '/search',
            requests_per_second: 5,
            burst: 10,
            coordination: 'local',
            failed_responses: { failures_per_minute: 30, burst: 5, coordination: 'local' },
          },
        ],
      },
      { rps: 10, burst: 20 }
    );
    expect(preAuthConfig(draft).routes).toEqual([
      {
        method: 'GET',
        path: '/search',
        requests_per_second: 5,
        burst: 10,
        failed_responses: { failures_per_minute: 30, burst: 5 },
      },
    ]);
  });

  it('carries the rate and routes over when switching off, as the CLI does', () => {
    const draft = { ...preAuthDraft(login, { rps: 10, burst: 20 }), mode: 'off' as const };
    expect(preAuthConfig(draft)).toEqual({ ...login, mode: 'off' });
  });

  it('treats a stored local coordination and an omitted one as the same guard', () => {
    const withLocal: PreAuthConfig = {
      mode: 'observe',
      requests_per_second: 10,
      burst: 20,
      routes: [
        { method: 'POST', path: '/a', requests_per_second: 1, burst: 1, coordination: 'local' },
      ],
    };
    const draft = preAuthDraft(withLocal, { rps: 10, burst: 20 });
    expect(samePreAuth(withLocal, draft)).toBe(true);
    expect(samePreAuth(withLocal, { ...draft, mode: 'enforce' })).toBe(false);
  });

  it('reads no stored guard and an off draft as nothing to save', () => {
    const draft = preAuthDraft(undefined, { rps: 10, burst: 20 });
    expect(samePreAuth(undefined, draft)).toBe(true);
    expect(samePreAuth(undefined, { ...draft, mode: 'observe' })).toBe(false);
  });
});

describe('validatePreAuth', () => {
  const draft = (over: Partial<ReturnType<typeof preAuthDraft>> = {}) => ({
    ...preAuthDraft(login, { rps: 10, burst: 20 }),
    ...over,
  });

  it('accepts the documented login example', () => {
    expect(validatePreAuth(draft())).toEqual({});
  });

  it('checks nothing while off: apid stores an off guard without validating it', () => {
    expect(validatePreAuth(draft({ mode: 'off', requests_per_second: undefined }))).toEqual({});
  });

  it('needs a positive rate and burst within the schema bounds', () => {
    expect(validatePreAuth(draft({ requests_per_second: 0 }))).toHaveProperty(
      'requests_per_second'
    );
    expect(validatePreAuth(draft({ burst: 2001 }))).toHaveProperty('burst');
    expect(validatePreAuth(draft({ requests_per_second: 2.5 }))).toHaveProperty(
      'requests_per_second'
    );
  });

  it('keeps a route at or under the app-wide rate and burst', () => {
    const d = draft();
    d.routes[0] = { ...d.routes[0], requests_per_second: 21 };
    expect(validatePreAuth(d)['routes.0.requests_per_second']).toMatch(/app-wide/);
  });

  it('wants a canonical absolute path with no query or encoding', () => {
    for (const path of ['login', '/login/', '/a//b', '/a/./b', '/a/../b', '/login?x=1', '/a%20b']) {
      const d = draft();
      d.routes[0] = { ...d.routes[0], path };
      expect(validatePreAuth(d), path).toHaveProperty('routes.0.path');
    }
    const root = draft();
    root.routes[0] = { ...root.routes[0], path: '/' };
    expect(validatePreAuth(root)).not.toHaveProperty('routes.0.path');
  });

  it('refuses the same method and path twice', () => {
    const d = draft();
    d.routes = [d.routes[0], { ...d.routes[0] }];
    expect(validatePreAuth(d)['routes.1.path']).toMatch(/already/);
  });

  it('caps a failed-response budget at the route rate and burst', () => {
    const d = draft();
    d.routes[0] = { ...d.routes[0], failures_per_minute: 121, failed_burst: 5 };
    const errors = validatePreAuth(d);
    expect(errors['routes.0.failures_per_minute']).toMatch(/120/);
    expect(errors['routes.0.failed_burst']).toMatch(/4/);
  });

  it('takes up to four distinct 4xx statuses other than 429', () => {
    for (const statuses of [
      ['429'],
      ['500'],
      ['401', '401'],
      ['400', '401', '403', '404', '409'],
    ]) {
      const d = draft();
      d.routes[0] = { ...d.routes[0], statuses };
      expect(validatePreAuth(d), statuses.join()).toHaveProperty('routes.0.statuses');
    }
  });

  it('observes targets only on a central POST route with a failed-response budget', () => {
    const d = draft();
    d.routes[0] = { ...d.routes[0], coordination: 'local' };
    expect(validatePreAuth(d)['routes.0.observe_targets']).toMatch(/POST/);
  });

  it('allows at most 16 route overrides', () => {
    const d = draft();
    d.routes = Array.from({ length: 17 }, (_, i) => ({
      ...d.routes[0],
      path: `/r${i}`,
      observe_targets: false,
    }));
    expect(validatePreAuth(d).routes).toMatch(/16/);
  });
});

describe('preAuthSummary', () => {
  it('reads like the CLI line', () => {
    expect(preAuthSummary(login)).toBe('Observe · 20 rps, burst 40 per source · 1 route override');
    expect(preAuthSummary(undefined)).toBe('Off');
    expect(preAuthSummary({ ...login, mode: 'off' })).toBe('Off');
  });
});

describe('enforceEffect', () => {
  it('says what enforce refuses, with the response a client sees', () => {
    const text = enforceEffect(login);
    expect(text).toMatch(/over 20 requests a second \(burst 40\)/);
    expect(text).toMatch(/429/);
    expect(text).toMatch(/before credentials are checked/);
    expect(text).toMatch(/1 route override/);
    expect(text).toMatch(/shared NAT/);
  });
});
