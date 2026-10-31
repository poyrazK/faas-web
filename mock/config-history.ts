import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';

/**
 * Config revisions and config guards (faas ADR-1451), per app and scope.
 *
 * Revisions hold the scope's variables and secret versions after a change,
 * never secret values. A write joins the scope's watching guard or opens one;
 * `?guard=false` closes a watching guard as superseded and opens none. The
 * mock never closes a guard on its own; seeded guards show the other states.
 */
type S = components['schemas'];
type Source = S['ConfigRevision']['source'];

interface Revision {
  revision: number;
  source: Source;
  key?: string;
  actor: string;
  created_at: string;
  variables: Record<string, string>;
  secret_versions: Record<string, number>;
  guard_id?: string;
  restored_revision?: number;
}

interface Scope {
  revisions: Revision[];
  guards: S['ConfigGuard'][];
}

const scopes = new Map<string, Scope>();
const at = (slug: string, scope: string) => `${slug}/${scope}`;

/** Newest 100 per scope, as `api.ConfigRevisionsRetained`. */
const RETAINED = 100;
const WINDOW_MINUTES = 10;

function scopeOf(slug: string, scope: string): Scope {
  let found = scopes.get(at(slug, scope));
  if (!found) {
    found = { revisions: [], guards: [] };
    scopes.set(at(slug, scope), found);
  }
  return found;
}

const guardById = (s: Scope, id: string | undefined) => s.guards.find((g) => g.id === id);

export function revisionView(slug: string, scope: string, r: Revision): S['ConfigRevision'] {
  const guard = guardById(scopeOf(slug, scope), r.guard_id);
  return {
    revision: r.revision,
    scope,
    source: r.source,
    ...(r.key ? { key: r.key } : {}),
    actor: r.actor,
    created_at: r.created_at,
    variable_count: Object.keys(r.variables).length,
    secret_count: Object.keys(r.secret_versions).length,
    ...(guard ? { guard_id: guard.id, guard_status: guard.status } : {}),
    ...(r.restored_revision ? { restored_revision: r.restored_revision } : {}),
  };
}

export function listRevisions(slug: string, scope: string, limit: number) {
  const s = scopeOf(slug, scope);
  const revisions = [...s.revisions]
    .reverse()
    .slice(0, limit)
    .map((r) => revisionView(slug, scope, r));
  return { revisions, ...(s.guards.length ? { guard: s.guards.at(-1) } : {}) };
}

export function getRevision(slug: string, scope: string, n: number) {
  const r = scopeOf(slug, scope).revisions.find((x) => x.revision === n);
  if (!r) return undefined;
  return {
    ...revisionView(slug, scope, r),
    variables: { ...r.variables },
    secret_versions: { ...r.secret_versions },
  };
}

export const latestGuard = (slug: string, scope: string) => scopeOf(slug, scope).guards.at(-1);

export interface ConfigState {
  variables: Record<string, string>;
  secret_versions: Record<string, number>;
}

/**
 * Record a customer write after it landed. `before` is the scope before the
 * write: the first change to a scope records it as a baseline, so the first
 * change can be undone too.
 */
export function recordChange(opts: {
  slug: string;
  scope: string;
  source: Source;
  key?: string;
  actor: string;
  before: ConfigState;
  after: ConfigState;
  guard: boolean;
  restored?: number;
}): S['ConfigChangeReceipt'] {
  const s = scopeOf(opts.slug, opts.scope);
  const now = new Date().toISOString();
  if (s.revisions.length === 0)
    s.revisions.push({
      revision: 1,
      source: 'baseline',
      actor: opts.actor,
      created_at: now,
      ...structuredClone(opts.before),
    });
  const head = s.revisions.at(-1)!;
  const open = s.guards.find((g) => g.status === 'watching');
  let guard: S['ConfigGuard'] | undefined;
  if (!opts.guard) {
    if (open) {
      open.status = 'superseded';
      open.closed_at = now;
      open.decision = {
        rule: 'superseded',
        summary: 'A later change opted out of the guard',
        new_requests: 0,
        new_server_errors: 0,
        old_requests: 0,
        old_server_errors: 0,
      };
    }
  } else if (open) {
    guard = open;
  } else {
    guard = {
      id: randomUUID(),
      scope: opts.scope,
      status: 'watching',
      base_revision: head.revision,
      head_revision: head.revision,
      restorable: true,
      opened_at: now,
      last_change_at: now,
    };
    s.guards.push(guard);
  }
  const revision: Revision = {
    revision: head.revision + 1,
    source: opts.source,
    ...(opts.key ? { key: opts.key } : {}),
    actor: opts.actor,
    created_at: now,
    ...structuredClone(opts.after),
    ...(guard ? { guard_id: guard.id } : {}),
    ...(opts.restored ? { restored_revision: opts.restored } : {}),
  };
  s.revisions.push(revision);
  if (s.revisions.length > RETAINED) s.revisions.splice(0, s.revisions.length - RETAINED);
  if (guard) {
    guard.head_revision = revision.revision;
    guard.last_change_at = now;
    // Deleting or rotating a secret is never undone automatically.
    if (opts.source === 'secret.delete' || opts.source === 'secret.rotate')
      guard.restorable = false;
  }
  return {
    revision: revision.revision,
    ...(guard
      ? {
          guard: {
            id: guard.id,
            status: 'watching',
            base_revision: guard.base_revision,
            window_minutes: WINDOW_MINUTES,
          },
        }
      : {}),
  };
}

/**
 * Seed one app's default scope: a baseline, two changes, a change the guard
 * restored, a new secret, and the newest change — watching on the first
 * app so the open guard can be seen, passed on the others.
 */
export function seedHistory(
  slug: string,
  current: ConfigState,
  opts: { watching: boolean; iso: (msAgo: number) => string }
) {
  const s = scopeOf(slug, 'default');
  if (s.revisions.length) return;
  const H = 3_600_000;
  const D = 24 * H;
  const v = current.variables;
  const sec = current.secret_versions;
  const without = (obj: Record<string, string>, key: string) =>
    Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
  const base = { ...without(v, 'FEATURE_FLAGS'), REGION: 'eu-central' };
  const flags = { ...base, FEATURE_FLAGS: v.FEATURE_FLAGS ?? 'mock-value' };
  const firstSecret = Object.keys(sec)[0];
  // The first secret is added at revision 5, so older revisions lack it.
  const older = Object.fromEntries(Object.entries(sec).filter(([k]) => k !== firstSecret));
  const g = (
    over: Partial<S['ConfigGuard']> & Pick<S['ConfigGuard'], 'status'>
  ): S['ConfigGuard'] => ({
    id: randomUUID(),
    scope: 'default',
    base_revision: 0,
    head_revision: 0,
    restorable: true,
    opened_at: '',
    last_change_at: '',
    ...over,
  });
  const clean2 = g({
    status: 'clean',
    base_revision: 1,
    head_revision: 2,
    opened_at: opts.iso(9 * D),
    last_change_at: opts.iso(9 * D),
    window_ends_at: opts.iso(9 * D - 15 * 60_000),
    closed_at: opts.iso(9 * D - 16 * 60_000),
    decision: {
      rule: 'clean',
      summary: 'No 5xx regression in 10 minutes of traffic',
      new_requests: 214,
      new_server_errors: 0,
      old_requests: 380,
      old_server_errors: 1,
    },
  });
  const restored3 = g({
    status: 'restored',
    base_revision: 2,
    head_revision: 3,
    opened_at: opts.iso(4 * D),
    last_change_at: opts.iso(4 * D),
    window_ends_at: opts.iso(4 * D - 12 * 60_000),
    closed_at: opts.iso(4 * D - 3 * 60_000),
    decision: {
      rule: 'fail_first_wake_5xx',
      summary: '7 of 9 requests with the new config answered 5xx',
      new_requests: 9,
      new_server_errors: 7,
      old_requests: 412,
      old_server_errors: 1,
      restored_revision: 2,
    },
  });
  const newest6 = g(
    opts.watching
      ? {
          status: 'watching',
          base_revision: 5,
          head_revision: 6,
          opened_at: opts.iso(3 * 60_000),
          last_change_at: opts.iso(3 * 60_000),
          window_ends_at: opts.iso(-7 * 60_000),
        }
      : {
          status: 'clean',
          base_revision: 5,
          head_revision: 6,
          opened_at: opts.iso(D),
          last_change_at: opts.iso(D),
          window_ends_at: opts.iso(D - 11 * 60_000),
          closed_at: opts.iso(D - 12 * 60_000),
          decision: {
            rule: 'clean',
            summary: 'No 5xx regression in 10 minutes of traffic',
            new_requests: 96,
            new_server_errors: 0,
            old_requests: 140,
            old_server_errors: 0,
          },
        }
  );
  s.guards.push(clean2, restored3, newest6);
  const actor = 'design@gregale.dev';
  s.revisions.push(
    {
      revision: 1,
      source: 'baseline',
      actor,
      created_at: opts.iso(9 * D),
      variables: base,
      secret_versions: older,
    },
    {
      revision: 2,
      source: 'env.set',
      key: 'FEATURE_FLAGS',
      actor,
      created_at: opts.iso(9 * D),
      variables: flags,
      secret_versions: older,
      guard_id: clean2.id,
    },
    {
      revision: 3,
      source: 'env.set',
      key: 'LOG_LEVEL',
      actor,
      created_at: opts.iso(4 * D),
      variables: { ...flags, LOG_LEVEL: 'trace' },
      secret_versions: older,
      guard_id: restored3.id,
    },
    {
      revision: 4,
      source: 'config.guard_restore',
      actor: 'gregale',
      created_at: opts.iso(4 * D - 3 * 60_000),
      variables: flags,
      secret_versions: older,
      guard_id: restored3.id,
      restored_revision: 2,
    },
    {
      revision: 5,
      source: 'secret.set',
      key: firstSecret,
      actor,
      created_at: opts.iso(2 * D),
      variables: flags,
      secret_versions: { ...sec },
    },
    {
      revision: 6,
      source: 'env.set',
      key: 'REGION',
      actor,
      created_at: opts.watching ? opts.iso(3 * 60_000) : opts.iso(D),
      variables: { ...v },
      secret_versions: { ...sec },
      guard_id: newest6.id,
    }
  );
}

/** Variables the rollback must write to make `current` match `target`. */
export function variablesToward(target: Record<string, string>, current: Record<string, string>) {
  const set = Object.keys(target)
    .filter((k) => current[k] !== target[k])
    .sort();
  const deleted = Object.keys(current)
    .filter((k) => !(k in target))
    .sort();
  return { set, deleted };
}

/** Secrets whose version differs; a rollback reports them and changes none. */
export function secretsDiffering(
  target: Record<string, number>,
  current: Record<string, number>
): S['ConfigSecretDifference'][] {
  const keys = new Set([...Object.keys(target), ...Object.keys(current)]);
  return [...keys]
    .filter((k) => target[k] !== current[k])
    .sort()
    .map((key) => ({
      key,
      ...(target[key] ? { target_version: target[key] } : {}),
      ...(current[key] ? { current_version: current[key] } : {}),
    }));
}
