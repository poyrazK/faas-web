import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { channels } from './notification-channels';
import { GuardProblem, checkRelease } from './release-freezes';

type S = components['schemas'];
export type Schedule = S['ScheduledRelease'];
type Request = Partial<S['ScheduleReleaseRequest']>;

/**
 * Scheduled releases (faas apidserver/scheduled_releases.go): a release that
 * waits live without traffic, started at `release_at`. Seeded from the
 * deployments that carry a `scheduled_release`, so the drawer and the list
 * agree; a due schedule starts on the next read, as apid's worker would.
 */
export const schedules: Schedule[] = db.deployments.flatMap((d) =>
  d.scheduled_release ? [{ ...d.scheduled_release, deployment_id: d.id, revision: d.revision }] : []
);

const MAX_AHEAD = 7 * 24 * 3_600_000;
const PRESETS = ['none', 'slow', 'balanced', 'aggressive', '1-10-50-100', 'adaptive'];
const validation = (detail: string) => new GuardProblem(400, 'validation_failed', detail);
const deploymentOf = (id: string) => db.deployments.find((d) => d.id === id);
const appOf = (d: db.Deployment) => db.apps.find((a) => a.id === d.app_id);

/** Starts schedules whose time has come: the release takes all traffic, the one serving is superseded. */
export function advance(now = Date.now()) {
  for (const s of schedules) {
    if (s.state !== 'scheduled' || Date.parse(s.release_at) > now) continue;
    const d = deploymentOf(s.deployment_id);
    // Still building: apid waits up to an hour past the time, then gives up.
    if (d && d.status !== 'live') {
      if (now - Date.parse(s.release_at) > 3_600_000)
        Object.assign(s, {
          state: 'expired',
          outcome_code: 'not_ready',
          outcome_detail: 'The release was not ready within an hour of its time.',
          updated_at: new Date(now).toISOString(),
        });
      continue;
    }
    s.state = 'started';
    s.started_at = s.release_at;
    s.updated_at = new Date(now).toISOString();
    if (!d) continue;
    for (const other of db.deployments)
      if (
        other.app_id === d.app_id &&
        other.id !== d.id &&
        other.status === 'live' &&
        (other.traffic_percent ?? 0) > 0 &&
        !other.scope
      )
        Object.assign(other, { status: 'superseded', traffic_percent: 0 });
    d.traffic_percent = 100;
    d.scheduled_release = { ...s };
  }
}

/** notSchedulable (scheduled_releases.go:326-338), for a release the mock knows is live or building. */
function notSchedulable(d: db.Deployment): string {
  const status = d.status.toLowerCase();
  if (['failed', 'cancelled', 'superseded', 'stopped'].includes(status)) return `is ${status}`;
  if (d.canary_total_steps) return 'already rolls out through a canary';
  if ((d.traffic_percent ?? 0) > 0) return `takes ${d.traffic_percent}% of traffic`;
  return '';
}

function channelNames(names: unknown): string[] {
  if (names === undefined) return [];
  if (!Array.isArray(names) || names.length > 5)
    throw validation('notify_channels names at most 5 channels');
  const seen = new Set<string>();
  for (const n of names) {
    if (typeof n !== 'string' || !n.trim() || seen.has(n))
      throw validation('notify_channels needs distinct channel names');
    const c = channels.find((x) => x.name === n);
    if (!c)
      throw validation(
        `no notification channel is named "${n}"; create it with \`gregale channels add\``
      );
    if (c.kind === 'pagerduty')
      throw validation(
        `"${n}" is a PagerDuty channel; release notifications go to Slack or email channels`
      );
    seen.add(n);
  }
  return [...seen];
}

/** Parses release_at the way api.ParseReleaseAt does. */
export function parseReleaseAt(value: unknown, now = Date.now()): number {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(at))
    throw validation('release_at must be an RFC 3339 time, such as 2026-10-22T02:00:00Z');
  if (at < now - 60_000) throw validation('release_at has passed; schedule a time in the future');
  if (at > now + MAX_AHEAD) throw validation('release_at is more than 7 days ahead');
  return at;
}

/** PUT /v1/deployments/{id}/schedule. */
export function schedule(id: string, req: Request, actor: string, now = Date.now()): Schedule {
  const d = deploymentOf(id);
  const a = d && appOf(d);
  if (!d || !a) throw new GuardProblem(404, 'not_found', 'No such deployment.');
  const at = parseReleaseAt(req.release_at, now);
  if (a.preview_of_slug)
    throw validation(
      'preview and developer environments release immediately; release_at is for production releases'
    );
  if (d.scope && d.scope !== 'default')
    throw validation('release_at schedules production releases; drop the scope or environment');
  const why = notSchedulable(d);
  if (why)
    throw new GuardProblem(
      409,
      'release_not_parked',
      `${d.revision ? `v${d.revision}` : d.id} ${why}; only a release that is live without traffic can be scheduled.`
    );
  const notify = channelNames(req.notify_channels);
  if (req.canary && !PRESETS.includes(req.canary.preset))
    throw validation('canary.preset must be a catalog preset');
  const overridden = checkRelease(a.slug, at, req.override_freeze, true);
  const pending = schedules.find((s) => s.app === a.slug && s.state === 'scheduled');
  const canary =
    req.canary ??
    (pending?.deployment_id === id ? pending.canary : { preset: 'balanced' as const });
  const stamp = new Date(now).toISOString();
  if (pending)
    Object.assign(pending, {
      state: 'cancelled',
      outcome_code: 'replaced',
      outcome_detail: 'a newer schedule replaced it',
      updated_at: stamp,
    });
  const created: Schedule = {
    id: randomUUID(),
    app: a.slug,
    deployment_id: d.id,
    ...(d.revision ? { revision: d.revision } : {}),
    release_at: new Date(at).toISOString(),
    state: 'scheduled',
    ...(canary && canary.preset !== 'none' ? { canary } : {}),
    notify_channels: notify,
    ...(overridden.length
      ? { override_freeze: String(req.override_freeze).trim(), overridden_freezes: overridden }
      : {}),
    scheduled_by: actor,
    created_at: stamp,
    updated_at: stamp,
  };
  schedules.unshift(created);
  d.scheduled_release = { ...created };
  const replaced = pending && deploymentOf(pending.deployment_id);
  if (replaced && replaced.id !== d.id) replaced.scheduled_release = { ...pending };
  return created;
}

/** A deploy with release_at: the schedule recorded once the (parked) deployment exists. */
export function record(
  d: db.Deployment,
  app: string,
  at: number,
  notify: unknown,
  actor: string,
  now = Date.now()
): Schedule {
  const names = channelNames(notify);
  const stamp = new Date(now).toISOString();
  for (const s of schedules)
    if (s.app === app && s.state === 'scheduled')
      Object.assign(s, {
        state: 'cancelled',
        outcome_code: 'replaced',
        outcome_detail: 'a newer schedule replaced it',
        updated_at: stamp,
      });
  const created: Schedule = {
    id: randomUUID(),
    app,
    deployment_id: d.id,
    ...(d.revision ? { revision: d.revision } : {}),
    release_at: new Date(at).toISOString(),
    state: 'scheduled',
    canary: { preset: 'balanced' },
    notify_channels: names,
    scheduled_by: actor,
    created_at: stamp,
    updated_at: stamp,
  };
  schedules.unshift(created);
  d.scheduled_release = { ...created };
  return created;
}

/** DELETE /v1/deployments/{id}/schedule. */
export function cancel(id: string, actor: string, now = Date.now()): Schedule {
  const s = schedules.find((x) => x.deployment_id === id && x.state === 'scheduled');
  if (!s)
    throw new GuardProblem(404, 'scheduled_release_not_found', `${id} has no pending schedule.`);
  Object.assign(s, {
    state: 'cancelled',
    outcome_code: 'cancelled_by_user',
    outcome_detail: `cancelled by ${actor}`,
    updated_at: new Date(now).toISOString(),
  });
  const d = deploymentOf(id);
  if (d) d.scheduled_release = { ...s };
  return s;
}

/** GET /v1/deployments/{id}/schedule: the newest schedule. */
export function latest(id: string): Schedule {
  const s = schedules.find((x) => x.deployment_id === id);
  if (!s) throw new GuardProblem(404, 'scheduled_release_not_found', `${id} has no schedule.`);
  return s;
}

/** GET /v1/scheduled-releases: pending first, soonest first, then the most recently ended. */
export function list(app?: string): Schedule[] {
  const rows = schedules.filter((s) => !app || s.app === app);
  const pending = rows
    .filter((s) => s.state === 'scheduled')
    .sort((a, b) => Date.parse(a.release_at) - Date.parse(b.release_at));
  const ended = rows
    .filter((s) => s.state !== 'scheduled')
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return [...pending, ...ended].slice(0, 50);
}
