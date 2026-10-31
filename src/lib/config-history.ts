import type { components } from './api/schema';

/**
 * Config history, rollback and the config guard (faas ADR-1451).
 *
 * Every customer write to an app scope's variables or secrets records a
 * revision, and a write to a scope with a live deployment opens a guard that
 * judges the first traffic served with the new values. Revisions never hold
 * secret values, so a rollback restores variables only and reports the
 * secrets that differ. Everything here works on keys: values never reach a
 * label, a summary or a plan.
 */
export type ConfigRevision = components['schemas']['ConfigRevision'];
export type ConfigRevisionDetail = components['schemas']['ConfigRevisionDetail'];
export type ConfigGuard = components['schemas']['ConfigGuard'];
export type ConfigChangeReceipt = components['schemas']['ConfigChangeReceipt'];
export type ConfigSecretDifference = components['schemas']['ConfigSecretDifference'];

/** The guard window when a receipt does not state it (`api.ConfigGuardWindowMinutes`). */
const GUARD_WINDOW_MINUTES = 10;

/** One line naming what a revision changed, keyed like `gregale env history`. */
export function revisionChange(r: ConfigRevision): string {
  const key = r.key ?? '';
  switch (r.source) {
    case 'baseline':
      return 'Config before the next change';
    case 'env.set':
      return `Set ${key}`;
    case 'env.delete':
      return `Deleted ${key}`;
    case 'secret.set':
      return `Set secret ${key}`;
    case 'secret.delete':
      return `Deleted secret ${key}`;
    case 'secret.rotate':
      return `Rotated secret ${key}`;
    case 'config.rollback':
      return `Rolled back to revision ${r.restored_revision ?? '?'}`;
    case 'config.guard_restore':
      return `Config guard restored revision ${r.restored_revision ?? '?'}`;
  }
  return key ? `${r.source} ${key}` : r.source;
}

/** A guard status as a short label for a revision row. */
export const GUARD_STATUS_LABEL: Record<string, string> = {
  watching: 'Watching',
  clean: 'Passed',
  restored: 'Restored',
  regressed: 'Failed, kept',
  no_traffic: 'No traffic',
  superseded: 'Superseded',
};

/** What a scope's newest guard is doing or decided, in one sentence. */
export function guardHeadline(g: ConfigGuard): string {
  const why = g.decision?.summary ? `: ${g.decision.summary.replace(/\.$/, '')}.` : '.';
  switch (g.status) {
    case 'watching':
      return g.window_ends_at
        ? `Judging traffic served with revision ${g.head_revision} against the hour before the change.`
        : `Watching revision ${g.head_revision}, waiting for the first request served with the new values.`;
    case 'clean':
      return `Revision ${g.head_revision} passed: the new values served traffic without a 5xx regression.`;
    case 'restored':
      return `The new values failed, so the guard restored revision ${g.base_revision}${why}`;
    case 'regressed':
      return `The app failed after revision ${g.head_revision} and the guard left the config as it is${why}`;
    case 'no_traffic':
      return `Revision ${g.head_revision} served no traffic within 24 hours, so the guard closed without a verdict.`;
    case 'superseded':
      return `Revision ${g.head_revision} was not judged to the end: a later change took over${why}`;
  }
  return `Config guard: ${g.status}.`;
}

/** The toast line after an env or secret write that recorded a revision. */
export function configChangeNote(receipt: ConfigChangeReceipt | undefined): string | undefined {
  if (!receipt) return undefined;
  if (!receipt.guard) return `Recorded as config revision ${receipt.revision}.`;
  const minutes = receipt.guard.window_minutes ?? GUARD_WINDOW_MINUTES;
  return `Config revision ${receipt.revision}. The config guard watches the first ${minutes} minutes of traffic with the new values and restores revision ${receipt.guard.base_revision} if the app starts failing.`;
}

export interface RollbackPlan {
  /** Variables the rollback writes: missing now, or holding another value. */
  set: string[];
  /** Variables the rollback deletes: present now, absent from the target. */
  deleted: string[];
  /** Secrets whose version differs; a rollback never restores these. */
  secrets: ConfigSecretDifference[];
}

/**
 * What rolling back to `target` would change, as keys.
 *
 * The server diffs the target against the scope's live config
 * (`configguard.VariablesToward`). The console cannot read live values, so it
 * compares them with the newest revision and takes the live key list from the
 * env read: a key set outside the history still shows as deleted.
 */
export function planRollback(
  target: ConfigRevisionDetail,
  newest: ConfigRevisionDetail,
  liveKeys: string[] = Object.keys(newest.variables)
): RollbackPlan {
  const live = new Set(liveKeys);
  const set = Object.keys(target.variables).filter(
    (key) =>
      !live.has(key) ||
      !(key in newest.variables) ||
      newest.variables[key] !== target.variables[key]
  );
  const deleted = [...live].filter((key) => !(key in target.variables));
  const secretKeys = new Set([
    ...Object.keys(target.secret_versions),
    ...Object.keys(newest.secret_versions),
  ]);
  const secrets = [...secretKeys]
    .filter((key) => target.secret_versions[key] !== newest.secret_versions[key])
    .sort()
    .map((key) => ({
      key,
      target_version: target.secret_versions[key],
      current_version: newest.secret_versions[key],
    }));
  return { set: set.sort(), deleted: deleted.sort(), secrets };
}

const list = (keys: string[]) =>
  keys.length <= 1 ? keys.join('') : `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}`;

/** The confirm text for a rollback: what changes, what does not, and the restart. */
export function rollbackSummary(revision: number, plan: RollbackPlan): string {
  if (plan.set.length === 0 && plan.deleted.length === 0) {
    return `Variables already match revision ${revision}; nothing changes.`;
  }
  const parts = [
    plan.set.length ? `sets ${list(plan.set)}` : '',
    plan.deleted.length ? `deletes ${list(plan.deleted)}` : '',
  ].filter(Boolean);
  const action = parts.join(' and ');
  const sentences = [`${action[0].toUpperCase()}${action.slice(1)} to match revision ${revision}.`];
  if (plan.secrets.length) {
    sentences.push(
      `Secrets are not restored: ${list(plan.secrets.map((s) => s.key))} ${plan.secrets.length === 1 ? 'keeps its' : 'keep their'} current version.`
    );
  }
  sentences.push(
    'Running instances keep their current values until they restart; new wakes boot with the restored ones. The config guard watches the change.'
  );
  return sentences.join(' ');
}
