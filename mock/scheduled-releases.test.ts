import { describe, expect, it } from 'vitest';
import { mockCapabilities } from './capabilities';
import * as db from './data';
import { GuardProblem } from './release-freezes';
import { advance, cancel, latest, list, schedule, schedules } from './scheduled-releases';

const H = 3_600_000;
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof GuardProblem ? { status: err.status, code: err.code } : err;
  }
  return null;
};
const parked = () =>
  db.deployments.find(
    (d) => d.status === 'live' && d.traffic_percent === 0 && !d.scope && d.scheduled_release
  )!;

it('lists scheduled releases as a preview on every plan', () => {
  const free = mockCapabilities('free', []).capabilities.find(
    (c) => c.key === 'scheduled-releases'
  );
  expect(free).toMatchObject({ maturity: 'preview', enabled: true });
});

describe('scheduled releases', () => {
  it('seeds the blocked schedule the dark release already shows', () => {
    const d = parked();
    expect(latest(d.id)).toMatchObject({ state: 'blocked', outcome_code: 'release_frozen' });
  });

  it('schedules a parked release, moves it, and cancels it', () => {
    const d = parked();
    const at = new Date(Date.now() + 2 * H).toISOString();
    const first = schedule(d.id, { release_at: at, notify_channels: ['ops-slack'] }, 'me');
    expect(first).toMatchObject({
      state: 'scheduled',
      notify_channels: ['ops-slack'],
      deployment_id: d.id,
    });
    expect(d.scheduled_release?.state).toBe('scheduled');
    const moved = schedule(d.id, { release_at: new Date(Date.now() + 3 * H).toISOString() }, 'me');
    expect(schedules.find((s) => s.id === first.id)).toMatchObject({
      state: 'cancelled',
      outcome_code: 'replaced',
    });
    expect(list()[0].id).toBe(moved.id);
    expect(cancel(d.id, 'me')).toMatchObject({
      state: 'cancelled',
      outcome_code: 'cancelled_by_user',
    });
    expect(refused(() => cancel(d.id, 'me'))).toMatchObject({
      status: 404,
      code: 'scheduled_release_not_found',
    });
  });

  it('refuses what apid refuses: serving releases, far-off times and PagerDuty channels', () => {
    const serving = db.deployments.find(
      (d) =>
        d.status === 'live' &&
        (d.traffic_percent ?? 0) > 0 &&
        !d.canary_total_steps &&
        // A production release: another environment is refused earlier, as 400.
        (!d.scope || d.scope === 'default') &&
        !db.apps.find((a) => a.id === d.app_id)?.preview_of_slug
    )!;
    const soon = new Date(Date.now() + H).toISOString();
    expect(refused(() => schedule(serving.id, { release_at: soon }, 'me'))).toMatchObject({
      status: 409,
      code: 'release_not_parked',
    });
    expect(
      refused(() =>
        schedule(parked().id, { release_at: new Date(Date.now() + 8 * 24 * H).toISOString() }, 'me')
      )
    ).toMatchObject({ code: 'validation_failed' });
    expect(
      refused(() => schedule(parked().id, { release_at: soon, notify_channels: ['oncall'] }, 'me'))
    ).toMatchObject({
      code: 'validation_failed',
    });
  });

  it('starts a due schedule: the release takes the traffic and the one serving is superseded', () => {
    const d = parked();
    const serving = db.deployments.find(
      (x) => x.app_id === d.app_id && x.status === 'live' && (x.traffic_percent ?? 0) > 0
    )!;
    const s = schedule(d.id, { release_at: new Date(Date.now() + 30_000).toISOString() }, 'me');
    advance(Date.now() + 60_000);
    expect(s.state).toBe('started');
    expect(d.traffic_percent).toBe(100);
    expect(serving).toMatchObject({ status: 'superseded', traffic_percent: 0 });
  });
});
