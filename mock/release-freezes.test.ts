import { describe, expect, it } from 'vitest';
import { mockCapabilities } from './capabilities';
import * as db from './data';
import {
  GuardProblem,
  checkRelease,
  create,
  forApp,
  isActive,
  lift,
  list,
  status,
} from './release-freezes';

const H = 3_600_000;
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof GuardProblem
      ? { status: err.status, code: err.code, extra: err.extra }
      : err;
  }
  return null;
};

it('lists deploy freezes as a preview on every plan', () => {
  const free = mockCapabilities('free', []).capabilities.find((c) => c.key === 'deploy-freezes');
  expect(free).toMatchObject({ maturity: 'preview', enabled: true });
});

describe('freezes', () => {
  it('seeds an active incident window, a weekend policy and a company holiday freeze', () => {
    const app = db.apps[2].slug;
    expect(status(app)).toMatchObject({ app, frozen: true });
    expect(list({ account: true }).some((f) => f.kind === 'weekly')).toBe(true);
    const company = list({ org: db.orgs[0].slug });
    expect(company).toHaveLength(1);
    expect(company[0]).toMatchObject({ org: db.orgs[0].slug, active: false });
    expect(company[0].next_starts_at).toBeDefined();
  });

  it('validates each kind the way freeze.FromRequest does', () => {
    const owner = { account: true } as const;
    expect(refused(() => create(owner, 'x', { kind: 'window', reason: ' ' }, 'me'))).toMatchObject({
      status: 400,
    });
    expect(
      refused(() =>
        create(
          owner,
          'x',
          { kind: 'window', reason: 'r', ends_at: new Date(Date.now() - H).toISOString() },
          'me'
        )
      )
    ).toMatchObject({ code: 'validation_failed' });
    expect(
      refused(() =>
        create(
          owner,
          'x',
          {
            kind: 'weekly',
            reason: 'r',
            weekly: { days: ['fri'], start: '25:00', duration_minutes: 60, time_zone: 'UTC' },
          },
          'me'
        )
      )
    ).toMatchObject({ code: 'validation_failed' });
    expect(
      refused(() =>
        create(
          owner,
          'x',
          { kind: 'after_rollback', reason: 'r', after_rollback_minutes: 1441 },
          'me'
        )
      )
    ).toMatchObject({
      code: 'validation_failed',
    });
  });

  it('works out a weekly window in its own time zone', () => {
    // Friday 2026-11-06 16:00 in Istanbul (UTC+3) is 13:00 UTC.
    const row = {
      id: 'w',
      kind: 'weekly' as const,
      weekly: {
        days: ['fri' as const],
        start: '16:00',
        duration_minutes: 120,
        time_zone: 'Europe/Istanbul',
      },
      reason: 'r',
      source: 'manual' as const,
      created_by: 'me',
      created_at: '',
    };
    expect(isActive(row, Date.parse('2026-11-06T13:30:00Z'))).toBe(true);
    expect(isActive(row, Date.parse('2026-11-06T12:30:00Z'))).toBe(false);
    expect(isActive(row, Date.parse('2026-11-06T15:30:00Z'))).toBe(false);
  });

  it('covers an app with the account’s all-app freezes and its own, and lifts through the app', () => {
    const app = db.apps[3].slug;
    const created = create({ account: true }, app, { kind: 'window', reason: 'cleanup' }, 'me');
    expect(forApp(app).map((f) => f.id)).toContain(created.id);
    expect(forApp(db.apps[4].slug).map((f) => f.id)).not.toContain(created.id);
    expect(refused(() => lift({ account: true }, created.id, db.apps[4].slug))).toMatchObject({
      status: 404,
      code: 'release_freeze_not_found',
    });
    expect(lift({ account: true }, created.id, app).active).toBe(false);
    expect(forApp(app).map((f) => f.id)).not.toContain(created.id);
    expect(refused(() => lift({ account: true }, created.id))).toMatchObject({
      code: 'release_freeze_not_found',
    });
  });

  it('refuses a frozen release with the freezes, and lets an override through', () => {
    const app = db.apps[2].slug;
    expect(refused(() => checkRelease(app, Date.now()))).toMatchObject({
      status: 409,
      code: 'release_frozen',
      extra: {
        freezes: expect.arrayContaining([expect.objectContaining({ reason: 'incident 4711' })]),
      },
    });
    expect(checkRelease(app, Date.now(), 'hotfix').length).toBeGreaterThan(0);
    // The incident window ends within two hours.
    expect(checkRelease(app, Date.now() + 3 * H).filter(Boolean)).toBeDefined();
  });
});
