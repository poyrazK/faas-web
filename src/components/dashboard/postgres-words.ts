import type { PostgresDatabase } from '@/lib/api/queries';
import type { Tone } from './postgres-shared';

/**
 * A database in plain words: one status word, one sentence saying the state
 * and what it means for the apps, and the fixes that already exist for it
 * (docs/console-plain-english.md). Every sentence is built from fields the
 * API returns; the exact term stays in `term`, for a `title`.
 *
 * Semantics, read from faas pkg/managedpostgres:
 * - `plan_excess` and the workspace's compute cap suspend a *ready* database
 *   with its data kept, so it reads as Paused, never Ready.
 * - `last_error_code` on provisioning, updating or deleting is a failure apid
 *   is retrying (service.go releaseKnownError sets a retry time), not the end.
 * - `deletion_hold_pending` is apid's own marker on a scheduled delete
 *   (delete_grace.go), not a problem; `restore_copies_remain` is a deleted
 *   database kept for the copies restored from it (restore_copies.go).
 * - A ready database whose fresh health says compute `suspended` scaled to
 *   zero and wakes on the next connection; that is not the cap.
 */

export type DatabaseFix = 'upgrade' | 'resize' | 'restore' | 'open';

export interface DatabaseWords {
  /** One word for the state, with a dot. */
  word: string;
  tone: Tone;
  /** A hollow ring rather than a filled dot: not running. */
  ring: boolean;
  /** One plain sentence: the state and its consequence. */
  sentence: string;
  /** A part of `sentence` worth setting apart, such as the time left. */
  emphasis?: string;
  /** The exact technical state, kept for whoever searches for it. */
  term: string;
  /** Fixes the console already has, most useful first. */
  fixes: DatabaseFix[];
  /** Deleted or being deleted: drawn as an outline. */
  gone: boolean;
}

export interface DescribeContext {
  /** The workspace's compute cap holds every database (usage `compute_cap_state`). */
  capSuspended: boolean;
  /** "your", or "Acme's" in a company workspace. */
  whose: string;
  /** Resize is available here (capability `postgres-compute-policy`). */
  canResize: boolean;
  now: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Time left, rounded down so it never promises more than there is. */
export function timeLeft(until: number, now: number): string {
  const left = until - now;
  if (left >= DAY) {
    const days = Math.floor(left / DAY);
    return `${days} more ${days === 1 ? 'day' : 'days'}`;
  }
  if (left >= HOUR) {
    const hours = Math.floor(left / HOUR);
    return `${hours} more ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return 'less than an hour';
}

/** Why a database could not be set up, per apid's codes (service.go, types.go providerErrorCode). */
const FAILED: Record<string, string> = {
  provider_failed: 'It couldn’t be set up because the database provider reported a failure.',
  spec_mismatch:
    'It couldn’t be set up because the provider built it differently from what was asked.',
  unsupported: 'It couldn’t be set up because the provider doesn’t support what was asked.',
  invalid: 'It couldn’t be set up because the provider rejected its settings.',
  quota_exceeded: 'It couldn’t be set up because the provider’s limit was reached.',
  backend_unavailable: 'It couldn’t be set up because the database service was unavailable.',
  unavailable: 'It couldn’t be set up because the database provider was unavailable.',
  provider_unavailable: 'It couldn’t be set up because the database provider was unavailable.',
  conflict: 'It couldn’t be set up because another change held it.',
  not_found: 'It couldn’t be set up because the provider lost track of it.',
  restore_lineage_mismatch:
    'It couldn’t be restored because the copy didn’t match the database it came from.',
  restore_lineage_unavailable: 'It couldn’t be restored because its source couldn’t be confirmed.',
};

/** Why work on a database is still going, while apid retries it. */
const RETRYING: Record<string, string> = {
  backend_unavailable: 'the database service is unavailable',
  unavailable: 'the database provider is unavailable',
  provider_unavailable: 'the database provider is unavailable',
  data_identity_unavailable: 'its data couldn’t be confirmed yet',
  restore_lineage_unavailable: 'the database it’s restored from couldn’t be confirmed yet',
  resize_not_ready: 'the provider isn’t ready for the change',
  resize_observation_mismatch: 'the provider doesn’t yet show the change',
  resize_intent_mismatch: 'the change asked for and the one in progress differ',
  deletion_hold_failed: 'the provider didn’t confirm it stopped',
  conflict: 'another change holds it',
  quota_exceeded: 'the provider’s limit was reached',
  unsupported: 'the provider doesn’t support the change',
  invalid: 'the provider rejected the change',
  not_found: 'the provider can’t find it',
};

/** What the provider's health check found (ManagedPostgresHealth.last_error_code). */
const HEALTH: Record<string, string> = {
  resource_missing: 'The database provider can’t find it.',
  provider_failed: 'The database provider reports it has failed.',
  spec_mismatch: 'The database provider reports it differs from its settings.',
  provider_unavailable: 'The database provider couldn’t be reached to check it.',
  backend_unavailable: 'The database service couldn’t be reached to check it.',
  observation_invalid: 'The database provider’s answer about it couldn’t be read.',
  observer_unsupported: 'Its health can’t be checked here.',
};

const SAFE = 'Your data is safe; apps can’t connect until you fix this.';

export function describeDatabase(database: PostgresDatabase, ctx: DescribeContext): DatabaseWords {
  const code = database.last_error_code ?? undefined;
  const term = code ? `${database.state} · ${code}` : database.state;
  const base = { ring: false, emphasis: undefined, fixes: [] as DatabaseFix[], gone: false };

  switch (database.state) {
    case 'deleting': {
      const gone = {
        ...base,
        word: 'Being deleted',
        tone: 'muted' as const,
        ring: true,
        gone: true,
      };
      if (code === 'restore_copies_remain')
        return {
          ...gone,
          sentence:
            'It’s deleted, but kept while databases restored from it still exist. Apps can’t connect to it.',
          term,
        };
      const until = Date.parse(database.restorable_until ?? '');
      if (!Number.isNaN(until)) {
        if (until > ctx.now) {
          const left = timeLeft(until, ctx.now);
          return {
            ...gone,
            sentence: `You can still get it back for ${left}. After that it’s gone for good.`,
            emphasis: left,
            term: `deleting · restorable until ${database.restorable_until}`,
            fixes: ['restore'],
          };
        }
        return {
          ...gone,
          sentence: 'The time to get it back has ended. It’s being deleted for good.',
          term: `deleting · restorable until ${database.restorable_until}`,
        };
      }
      if (code && code !== 'deletion_hold_pending')
        return {
          ...gone,
          sentence: `Deleting it is taking longer because ${RETRYING[code] ?? 'of a problem'}. It’s retried automatically.`,
          term,
        };
      return { ...gone, sentence: 'It’s being deleted. This can’t be undone.', term };
    }
    case 'deleted':
      return {
        ...base,
        word: 'Deleted',
        tone: 'muted',
        ring: true,
        gone: true,
        sentence: 'It’s deleted for good.',
        term,
      };
    case 'failed':
      return {
        ...base,
        word: 'Failed',
        tone: 'critical',
        sentence: `${(code && FAILED[code]) || 'Something went wrong setting it up.'} Delete it and create it again.`,
        term,
        fixes: ['open'],
      };
    case 'provisioning':
      return {
        ...base,
        word: 'Starting',
        tone: 'warning',
        sentence: code
          ? `Setting it up is taking longer because ${RETRYING[code] ?? 'of a problem'}. It’s retried automatically.`
          : 'It’s being set up. Apps can connect once it’s ready.',
        term,
      };
    case 'updating':
      return {
        ...base,
        word: 'Changing',
        tone: 'warning',
        sentence: code
          ? `A change is taking longer because ${RETRYING[code] ?? 'of a problem'}. It’s retried automatically.`
          : 'A change is being made. Apps may be disconnected briefly until it finishes.',
        term,
      };
    case 'ready':
      return describeReady(database, ctx, base);
    default:
      // A state this console does not know yet: say so, never guess.
      return {
        ...base,
        word: 'Unknown',
        tone: 'muted',
        ring: true,
        sentence: `Its state is reported as “${String(database.state)}”.`,
        term,
        fixes: ['open'],
      };
  }
}

function describeReady(
  database: PostgresDatabase,
  ctx: DescribeContext,
  base: Pick<DatabaseWords, 'ring' | 'emphasis' | 'fixes' | 'gone'>
): DatabaseWords {
  const paused = { ...base, word: 'Paused', tone: 'critical' as const };
  if (database.plan_excess === 'service_class')
    return {
      ...paused,
      sentence: `It’s paused because its size isn’t included in ${ctx.whose} plan. ${SAFE}`,
      term: 'suspended · plan_excess: service_class',
      fixes: ctx.canResize ? ['upgrade', 'resize'] : ['upgrade'],
    };
  if (database.plan_excess === 'database_limit')
    return {
      ...paused,
      sentence: `It’s paused because ${ctx.whose} plan allows fewer databases than you have. ${SAFE}`,
      term: 'suspended · plan_excess: database_limit',
      fixes: ['upgrade'],
    };
  if (database.plan_excess)
    return {
      ...paused,
      sentence: `It’s paused because ${ctx.whose} plan no longer includes it. ${SAFE}`,
      term: `suspended · plan_excess: ${String(database.plan_excess)}`,
      fixes: ['upgrade'],
    };
  if (ctx.capSuspended)
    return {
      ...paused,
      sentence: `It’s paused because this month’s compute allowance is used up. Your data is safe; apps can’t connect until next month or an upgrade.`,
      term: 'suspended · compute cap',
      fixes: ['upgrade'],
    };

  const slot = Date.parse(database.restore_slot_until ?? '');
  if (!Number.isNaN(slot)) {
    const left = slot > ctx.now ? timeLeft(slot, ctx.now) : undefined;
    return {
      ...base,
      word: 'Ready',
      tone: 'warning',
      sentence: left
        ? `It’s a restored copy past ${ctx.whose} plan’s database limit. Make room within ${left}, or it will be scheduled for deletion.`
        : `It’s a restored copy past ${ctx.whose} plan’s database limit, so it is being scheduled for deletion.`,
      emphasis: left,
      term: `ready · restore slot until ${database.restore_slot_until}`,
      fixes: ['upgrade'],
    };
  }

  const ready = { ...base, word: 'Ready', tone: 'good' as const, term: 'ready' };
  const health = database.health;
  // A stale observation says nothing about now.
  if (health?.enabled && health.fresh) {
    if (health.status === 'degraded') {
      const found = health.last_error_code;
      return {
        ...base,
        word: 'Having trouble',
        tone: 'warning',
        sentence: (found && HEALTH[found]) || 'The database provider reports a problem with it.',
        term: `ready · health degraded${found ? ` · ${found}` : ''}`,
        fixes: ['open'],
      };
    }
    if (database.scale_to_zero && health.compute_state === 'suspended')
      return {
        ...ready,
        sentence: 'It’s asleep while idle and wakes when an app connects.',
        term: 'ready · compute suspended (scaled to zero)',
      };
    if (health.compute_state === 'waking')
      return {
        ...ready,
        sentence: 'It’s waking up for a connection.',
        term: 'ready · compute waking',
      };
  }
  return { ...ready, sentence: 'It’s ready. Apps bound to it can connect.' };
}

const REGIONS: Record<string, string> = { fra: 'Frankfurt', ams: 'Amsterdam' };

/** A region's city when it is known; otherwise its code as given. */
export function regionName(code: string): string {
  return REGIONS[code] ?? code;
}

export const SERVICE_CLASS_NAMES: Record<PostgresDatabase['service_class'], string> = {
  development: 'Development',
  burstable: 'Burstable',
  production: 'Production',
};

/** "35 days ago", spelled out; the exact time goes in a `title`. */
export function spelledAgo(ms: number, now: number): string {
  const diff = now - ms;
  if (Number.isNaN(diff)) return 'at an unknown time';
  if (diff < 60_000) return 'just now';
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`;
  if (diff < HOUR) return unit(Math.floor(diff / 60_000), 'minute');
  if (diff < DAY) return unit(Math.floor(diff / HOUR), 'hour');
  return unit(Math.floor(diff / DAY), 'day');
}
