import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
export type Freeze = S['ReleaseFreeze'];
type CreateFreeze = S['CreateReleaseFreezeRequest'];
type Weekly = S['ReleaseFreezeWeekly'];

/**
 * Deploy freezes as apid keeps them (faas apidserver/release_freezes.go,
 * release_freezes_org.go, pkg/apid/freeze/freeze.go). The mock's apps are
 * personal, so an app's freezes are the account's; an organization holds its
 * own list on /v1/orgs/{slug}/freezes.
 */

/** A refusal with the code and status apid answers; plugin.ts turns it into problem+json. */
export class GuardProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
    readonly extra?: Record<string, unknown>
  ) {
    super(detail);
  }
}

interface Row {
  id: string;
  /** Organization slug for an organization's freeze; absent for the account's. */
  org?: string;
  /** App slug for a freeze on one app; absent for one on all of the owner's apps. */
  app?: string;
  kind: Freeze['kind'];
  starts_at?: string;
  ends_at?: string;
  weekly?: Weekly;
  after_rollback_minutes?: number;
  reason: string;
  source: Freeze['source'];
  source_deployment_id?: string;
  created_by: string;
  created_at: string;
  lifted_at?: string;
}

const MAX = 50;
const WEEK = 7 * 24 * 3_600_000;
const DAYS: Weekly['days'] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Local-minus-UTC offset of `tz` at `ms`. */
function offset(ms: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value])
  );
  const local = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second
  );
  return local - Math.floor(ms / 1000) * 1000;
}

/** The instant a wall-clock time in `tz` names. */
function zoned(y: number, m: number, d: number, minutes: number, tz: string): number {
  const guess = Date.UTC(y, m, d, 0, minutes);
  const first = guess - offset(guess, tz);
  return guess - offset(first, tz);
}

/** Weekly occurrences around `now` (a week either side), as [start, end] instants. */
function occurrences(w: Weekly, now: number): [number, number][] {
  const today = new Date(now + offset(now, w.time_zone));
  const [hh, mm] = w.start.split(':').map(Number);
  const out: [number, number][] = [];
  for (let k = -7; k <= 7; k++) {
    const day = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + k)
    );
    if (!w.days.includes(DAYS[day.getUTCDay()])) continue;
    const start = zoned(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hh * 60 + mm,
      w.time_zone
    );
    out.push([start, start + w.duration_minutes * 60_000]);
  }
  return out;
}

export function isActive(row: Row, now = Date.now()): boolean {
  if (row.lifted_at) return false;
  if (row.kind === 'window')
    return (
      Boolean(row.starts_at) &&
      Date.parse(row.starts_at!) <= now &&
      (!row.ends_at || now < Date.parse(row.ends_at))
    );
  if (row.kind === 'weekly' && row.weekly)
    return occurrences(row.weekly, now).some(([s, e]) => s <= now && now < e);
  return false;
}

function nextStart(row: Row, now: number): number | undefined {
  if (row.lifted_at || isActive(row, now)) return undefined;
  if (row.kind === 'window' && row.starts_at) {
    const at = Date.parse(row.starts_at);
    return at > now && at - now <= WEEK ? at : undefined;
  }
  if (row.kind === 'weekly' && row.weekly)
    return occurrences(row.weekly, now)
      .map(([s]) => s)
      .filter((s) => s > now)
      .sort((a, b) => a - b)[0];
  return undefined;
}

const ended = (row: Row, now: number) =>
  Boolean(row.lifted_at) ||
  (row.kind === 'window' && Boolean(row.ends_at) && Date.parse(row.ends_at!) <= now);

export function view(row: Row, now = Date.now()): Freeze {
  const next = nextStart(row, now);
  return {
    id: row.id,
    ...(row.app ? { app: row.app } : {}),
    ...(row.org ? { org: row.org } : {}),
    kind: row.kind,
    ...(row.starts_at ? { starts_at: row.starts_at } : {}),
    ...(row.ends_at ? { ends_at: row.ends_at } : {}),
    ...(row.weekly ? { weekly: row.weekly } : {}),
    ...(row.after_rollback_minutes ? { after_rollback_minutes: row.after_rollback_minutes } : {}),
    reason: row.reason,
    source: row.source,
    ...(row.source_deployment_id ? { source_deployment_id: row.source_deployment_id } : {}),
    created_by: row.created_by,
    created_at: row.created_at,
    active: isActive(row, now),
    ...(next ? { next_starts_at: new Date(next).toISOString() } : {}),
  };
}

// RFC 3339 at second precision, as apid formats it.
const at = (msFromNow: number) =>
  new Date(db.NOW + msFromNow).toISOString().replace(/\.\d{3}Z$/, 'Z');
const H = 3_600_000;

/** Seeded: a weekend policy on every personal app, an incident window, an after-rollback policy, and a company holiday freeze. */
export const rows: Row[] = db.EMPTY
  ? []
  : [
      {
        id: randomUUID(),
        kind: 'weekly',
        weekly: {
          days: ['fri'],
          start: '16:00',
          duration_minutes: 64 * 60,
          time_zone: 'Europe/Istanbul',
        },
        reason: 'no weekend releases',
        source: 'manual',
        created_by: db.account.email,
        created_at: at(-30 * 24 * H),
      },
      {
        id: randomUUID(),
        app: db.apps[2].slug,
        kind: 'window',
        starts_at: at(-0.5 * H),
        ends_at: at(1.5 * H),
        reason: 'incident 4711',
        source: 'manual',
        created_by: db.account.email,
        created_at: at(-0.5 * H),
      },
      {
        id: randomUUID(),
        app: db.apps[0].slug,
        kind: 'after_rollback',
        after_rollback_minutes: 60,
        reason: 'settle after automatic rollbacks',
        source: 'manual',
        created_by: db.account.email,
        created_at: at(-10 * 24 * H),
      },
      {
        id: randomUUID(),
        org: db.orgs[0].slug,
        kind: 'window',
        starts_at: at(2 * 24 * H),
        ends_at: at(5 * 24 * H),
        reason: 'holiday freeze',
        source: 'manual',
        created_by: 'poyraz@acme.dev',
        created_at: at(-24 * H),
      },
    ];

export type Owner = { org: string } | { account: true };
const owns = (owner: Owner, row: Row) => ('org' in owner ? row.org === owner.org : !row.org);
const covers = (row: Row, slug: string) => !row.org && (!row.app || row.app === slug);

/** An owner's unlifted freezes that have not ended, oldest first. */
export function list(owner: Owner, now = Date.now()): Freeze[] {
  return rows.filter((r) => owns(owner, r) && !ended(r, now)).map((r) => view(r, now));
}

/** The freezes covering one (personal) app: the account's on all apps and on it. */
export function forApp(slug: string, now = Date.now()): Freeze[] {
  return rows.filter((r) => covers(r, slug) && !ended(r, now)).map((r) => view(r, now));
}

/** GET /v1/apps/{slug}/freeze-status. */
export function status(slug: string, now = Date.now()): S['ReleaseFreezeStatus'] {
  const covering = rows.filter((r) => covers(r, slug) && !ended(r, now));
  const active = covering.filter((r) => isActive(r, now)).map((r) => view(r, now));
  const next = covering
    .map((r) => ({ r, at: nextStart(r, now) }))
    .filter((x): x is { r: Row; at: number } => x.at !== undefined)
    .sort((a, b) => a.at - b.at)[0];
  return {
    app: slug,
    frozen: active.length > 0,
    active,
    ...(next ? { next: view(next.r, now) } : {}),
  };
}

const validation = (detail: string) => new GuardProblem(400, 'validation_failed', detail);

/** freeze.FromRequest, then the per-owner limit (release_freezes.go:155-181). */
export function create(
  owner: Owner,
  app: string | undefined,
  req: Partial<CreateFreeze>,
  actor: string,
  now = Date.now()
): Freeze {
  const reason = typeof req.reason === 'string' ? req.reason.trim() : '';
  if (!reason) throw validation('reason is required');
  if (reason.length > 200) throw validation('reason must be at most 200 characters');
  const row: Row = {
    id: randomUUID(),
    ...('org' in owner ? { org: owner.org } : {}),
    ...(app ? { app } : {}),
    kind: req.kind as Row['kind'],
    reason,
    source: 'manual',
    created_by: actor,
    created_at: new Date(now).toISOString(),
  };
  switch (req.kind) {
    case 'window': {
      if (req.weekly || req.after_rollback_minutes)
        throw validation('a window freeze takes only starts_at and ends_at');
      const start = req.starts_at ? Date.parse(req.starts_at) : now;
      if (Number.isNaN(start)) throw validation('starts_at must be an RFC 3339 time');
      row.starts_at = new Date(start).toISOString();
      if (req.ends_at) {
        const end = Date.parse(req.ends_at);
        if (Number.isNaN(end)) throw validation('ends_at must be an RFC 3339 time');
        if (end <= start || end <= now)
          throw validation('ends_at must be after starts_at and in the future');
        row.ends_at = new Date(end).toISOString();
      }
      break;
    }
    case 'weekly': {
      const w = req.weekly;
      if (!w || req.starts_at || req.ends_at || req.after_rollback_minutes)
        throw validation('a weekly freeze takes only weekly');
      if (!w.days?.length) throw validation('weekly.days must name at least one day (sun..sat)');
      if (w.days.some((d) => !DAYS.includes(d)))
        throw validation('weekly.days: each must be one of sun, mon, tue, wed, thu, fri, sat');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(w.start ?? ''))
        throw validation('weekly.start must be HH:MM (00:00-23:59)');
      if (
        !Number.isInteger(w.duration_minutes) ||
        w.duration_minutes < 1 ||
        w.duration_minutes > 10080
      )
        throw validation('weekly.duration_minutes must be 1-10080');
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: w.time_zone });
      } catch {
        throw validation(`weekly.time_zone: unknown time zone "${w.time_zone}"`);
      }
      row.weekly = {
        days: DAYS.filter((d) => w.days.includes(d)),
        start: w.start,
        duration_minutes: w.duration_minutes,
        time_zone: w.time_zone,
      };
      break;
    }
    case 'after_rollback': {
      if (req.weekly || req.starts_at || req.ends_at)
        throw validation('an after_rollback freeze takes only after_rollback_minutes');
      const m = req.after_rollback_minutes ?? 0;
      if (!Number.isInteger(m) || m < 1 || m > 1440)
        throw validation('after_rollback_minutes must be 1-1440');
      row.after_rollback_minutes = m;
      break;
    }
    default:
      throw validation('kind must be window, weekly, or after_rollback');
  }
  const held = rows.filter((r) => owns(owner, r) && !ended(r, now)).length;
  if (held >= MAX)
    throw new GuardProblem(
      409,
      'release_freeze_limit',
      `An account or organization can hold ${MAX} freezes that have not ended; this one holds ${held}.`
    );
  rows.push(row);
  return view(row, now);
}

/** Lifts one of owner's freezes (on `app` when given); 404 release_freeze_not_found otherwise. */
export function lift(owner: Owner, id: string, app?: string, now = Date.now()): Freeze {
  const row = rows.find(
    (r) => r.id === id && owns(owner, r) && !ended(r, now) && (!app || r.app === app)
  );
  if (!row)
    throw new GuardProblem(
      404,
      'release_freeze_not_found',
      `No unlifted freeze "${id}" exists here.`
    );
  row.lifted_at = new Date(now).toISOString();
  return { ...view(row, now), active: false };
}

/** The freezes covering `slug` active at `when`; empty once overridden. */
export function activeAt(slug: string, when: number): Freeze[] {
  return rows.filter((r) => covers(r, slug) && isActive(r, when)).map((r) => view(r, when));
}

/**
 * api.ErrReleaseFrozen (pkg/api/release_freezes.go:90-107): 409 with the
 * freezes in the problem, unless the release carries an override reason.
 */
export function checkRelease(
  slug: string,
  when: number,
  override?: unknown,
  scheduled = false
): string[] {
  const active = activeAt(slug, when);
  if (!active.length) return [];
  const reason = typeof override === 'string' ? override.trim() : '';
  if (!reason) {
    const reasons = active
      .map(
        (f) =>
          `"${f.reason}" by ${f.created_by}, ${f.ends_at ? `until ${f.ends_at}` : f.kind === 'weekly' ? 'during its weekly window' : 'until lifted'}`
      )
      .join('; ');
    throw new GuardProblem(
      409,
      'release_frozen',
      `${scheduled ? `At ${new Date(when).toISOString()}: ` : ''}Production releases of ${slug} are frozen: ${reasons}.`,
      { freezes: active }
    );
  }
  if (reason.length > 200) throw validation('override_freeze must be at most 200 characters');
  return active.map((f) => f.id);
}
