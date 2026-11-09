import type { components } from '@/lib/api/schema';
import { relativeTime } from '@/lib/time';
import type { ConfigGuard, ConfigRevision, ConfigRevisionDetail } from '@/lib/config-history';

/**
 * The Environment tab in plain words (docs/console-plain-english.md): what the
 * app has, whether it has started with the newest secret values, and what each
 * recorded change did. Every sentence is built from API fields; the exact term
 * stays in `term` for a `title`.
 *
 * Semantics, read from faas:
 * - A secret's `delivery_status` is about its *current* value
 *   (migration 20260922174018492): `delivered` means a runtime started
 *   successfully with exactly this version, `pending` that none has yet,
 *   `failed` that a start with it failed. Variables carry no such field, so
 *   nothing here claims a variable is live.
 * - Revisions never hold secret values; a revision's variables do hold values,
 *   so diffs compare them and print only keys.
 */

export type Tone = 'good' | 'active' | 'idle' | 'warning' | 'critical';

export type SecretRow = components['schemas']['AppSecretResponse'];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export interface SecretDelivery {
  word: string;
  tone: Tone;
  term: string;
}

/** One secret's current value against the runtime, or `null` when the API does not say. */
export function secretDelivery(
  s: Pick<SecretRow, 'delivery_status' | 'last_delivery_error_code'>
): SecretDelivery | null {
  switch (s.delivery_status) {
    case 'delivered':
      return {
        word: 'In use',
        tone: 'good',
        term: 'delivery_status: delivered. The app has started with this value.',
      };
    case 'pending':
      return {
        word: 'Applies on next start',
        tone: 'warning',
        term: 'delivery_status: pending. No running instance has started with this value yet.',
      };
    case 'failed':
      return {
        word: 'Start failed',
        tone: 'critical',
        term: `delivery_status: failed${s.last_delivery_error_code ? ` (${s.last_delivery_error_code})` : ''}. The last start with this value did not succeed.`,
      };
  }
  return null;
}

export interface SecretsState {
  total: number;
  pending: string[];
  failed: string[];
  /** Secrets whose delivery the API did not report. */
  unknown: number;
}

export function secretsState(secrets: SecretRow[]): SecretsState {
  const pending: string[] = [];
  const failed: string[] = [];
  let unknown = 0;
  for (const s of secrets) {
    if (s.delivery_status === 'pending') pending.push(s.key);
    else if (s.delivery_status === 'failed') failed.push(s.key);
    else if (s.delivery_status !== 'delivered') unknown++;
  }
  return { total: secrets.length, pending: pending.sort(), failed: failed.sort(), unknown };
}

/** Added and never changed, or changed since: from the row's own two timestamps. */
export function secretChangeVerb(createdAt: string | undefined, updatedAt: string | undefined) {
  if (!createdAt || !updatedAt) return 'Changed';
  const created = Date.parse(createdAt);
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(created) || Number.isNaN(updated)) return 'Changed';
  return updated - created < 1_000 ? 'Added' : 'Changed';
}

export interface EnvironmentHeadline {
  /** One status word with a dot, or none when the API says nothing about delivery. */
  word?: string;
  tone?: Tone;
  sentence: string;
  detail?: string;
}

/**
 * The tab's opening answer. `variables` / `secrets` are `undefined` when their
 * read failed or has not landed: the sentence then says less, never zero.
 */
export function environmentHeadline({
  app,
  variables,
  secrets,
}: {
  app: string;
  variables?: number;
  secrets?: SecretRow[];
}): EnvironmentHeadline | null {
  const counts = [
    variables != null ? plural(variables, 'variable') : '',
    secrets ? plural(secrets.length, 'secret') : '',
  ].filter(Boolean);
  if (counts.length === 0) return null;
  const sentence =
    variables === 0 && secrets?.length === 0
      ? `${app} has no variables or secrets yet.`
      : `${app} has ${counts.join(' and ')}.`;
  if (!secrets || secrets.length === 0) return { sentence };

  const state = secretsState(secrets);
  if (state.failed.length > 0) {
    return {
      word: 'Start failed',
      tone: 'critical',
      sentence,
      detail:
        state.failed.length === 1
          ? `The app failed to start with the new value of ${state.failed[0]}.`
          : `The app failed to start with the new values of ${list(state.failed)}.`,
    };
  }
  if (state.pending.length > 0) {
    return {
      word: 'Applies on next start',
      tone: 'warning',
      sentence,
      detail:
        state.pending.length === 1
          ? `The app hasn’t started with the new value of ${state.pending[0]} yet. It applies on the next start.`
          : `The app hasn’t started with the new values of ${list(state.pending)} yet. They apply on the next start.`,
    };
  }
  if (state.unknown > 0) return { sentence };
  return {
    word: 'Up to date',
    tone: 'good',
    sentence,
    detail:
      secrets.length === 1
        ? 'The app has started with the current value of its secret.'
        : 'The app has started with the current value of every secret.',
  };
}

/** The Variables section's lead. */
export function variablesLead(count: number | undefined, quota: number | undefined): string {
  if (count === 0)
    return 'No variables yet. Add the settings your code reads when it starts, like LOG_LEVEL.';
  const used = count != null && quota ? ` ${count} of ${quota} slots used.` : '';
  return `Read when the app starts, so a change applies on the next start.${used}`;
}

/** The Secrets section's lead. */
export function secretsLead(count: number | undefined, quota: number | undefined): string {
  if (count === 0)
    return 'No secrets yet. Add passwords, tokens and keys here; a value is never shown again once saved.';
  const used = count != null && quota ? ` ${count} of ${quota} slots used.` : '';
  return `Sealed when saved and never shown again.${used}`;
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export interface RevisionWords {
  /** Words before the key, or the whole line when there is no key. */
  lead: string;
  key?: string;
  /** The exact source, for a `title`. */
  term: string;
}

/** What one revision did, in plain words. The key goes in mono beside `lead`. */
export function revisionWords(r: ConfigRevision): RevisionWords {
  const term = `${r.source} · revision ${r.revision}`;
  const key = r.key || undefined;
  switch (r.source) {
    case 'baseline':
      return { lead: 'Starting point recorded', term };
    case 'env.set':
      return { lead: 'Set', key, term };
    case 'env.delete':
      return { lead: 'Removed', key, term };
    case 'secret.set':
      return { lead: 'Set secret', key, term };
    case 'secret.delete':
      return { lead: 'Removed secret', key, term };
    case 'secret.rotate':
      return { lead: 'Rotated secret', key, term };
    case 'config.rollback':
      return {
        lead: `Rolled variables back to revision ${r.restored_revision ?? '?'}`,
        term,
      };
    case 'config.guard_restore':
      return {
        lead: `Undone automatically, back to revision ${r.restored_revision ?? '?'}`,
        term,
      };
  }
  return { lead: r.source, key, term };
}

/** A guard verdict on one revision, as one word. */
export const GUARD_WORDS: Record<string, { word: string; tone: Tone }> = {
  watching: { word: 'Watching', tone: 'active' },
  clean: { word: 'Passed', tone: 'good' },
  restored: { word: 'Undone', tone: 'critical' },
  regressed: { word: 'Failed, kept', tone: 'critical' },
  no_traffic: { word: 'Not judged', tone: 'idle' },
  superseded: { word: 'Replaced', tone: 'idle' },
  // Not an API status: `watching` whose window has already ended (see guardState).
  unconfirmed: { word: 'Not confirmed', tone: 'idle' },
};

/**
 * The guard status to put into words. The API keeps `watching` until it
 * records a verdict; once `window_ends_at` has passed without one, saying
 * "watching" would contradict the window, so it reads as `unconfirmed`.
 */
export function guardState(g: Pick<ConfigGuard, 'status' | 'window_ends_at'>, now: number): string {
  if (g.status !== 'watching' || !g.window_ends_at) return g.status;
  const ends = Date.parse(g.window_ends_at);
  return !Number.isNaN(ends) && ends <= now ? 'unconfirmed' : 'watching';
}

export function guardWord(status: string): { word: string; tone: Tone } {
  return GUARD_WORDS[status] ?? { word: status, tone: 'idle' };
}

/**
 * A revision row's guard verdict, matching the guard summary: a row still
 * `watching` under the newest guard takes that guard's window into account.
 */
export function revisionGuardState(
  r: Pick<ConfigRevision, 'guard_id' | 'guard_status' | 'revision'>,
  guard: ConfigGuard | null | undefined,
  now: number
): string | undefined {
  if (r.guard_status !== 'watching' || !guard) return r.guard_status;
  const same = r.guard_id ? r.guard_id === guard.id : r.revision === guard.head_revision;
  return same ? guardState(guard, now) : r.guard_status;
}

export interface GuardWords {
  word: string;
  tone: Tone;
  sentence: string;
  /** What the person can do or expect next, when there is something to say. */
  next?: string;
}

/**
 * The newest guard in one sentence. `latest` says whether the guarded change is
 * still the newest revision: if not, the sentence names its revision rather
 * than calling it "the latest change".
 */
export function guardWords(g: ConfigGuard, latest: boolean, now: number): GuardWords {
  const state = guardState(g, now);
  const { word, tone } = guardWord(state);
  const change = latest ? 'the latest change' : `the change in revision ${g.head_revision}`;
  const Change = change[0].toUpperCase() + change.slice(1);
  if (state === 'unconfirmed')
    return {
      word,
      tone,
      sentence: `${Change} wasn’t confirmed: its watch window ended ${relativeTime(Date.parse(g.window_ends_at ?? ''), now)} without a result. It stays in place.`,
    };
  switch (g.status) {
    case 'watching':
      if (!g.window_ends_at)
        return {
          word,
          tone,
          sentence: `${Change} hasn’t served a request yet. Gregale judges it once it does.`,
          next: g.restorable
            ? undefined
            : 'It deleted or rotated a secret, so it can’t be undone automatically.',
        };
      return {
        word,
        tone,
        sentence: g.restorable
          ? `Gregale is watching ${change}. If the app starts failing, the previous values come back automatically.`
          : `Gregale is watching ${change}, but it deleted or rotated a secret, so it can’t be undone automatically.`,
      };
    case 'clean':
      return {
        word,
        tone,
        sentence: `${Change} passed: the app served traffic without more errors than before.`,
      };
    case 'restored':
      return {
        word,
        tone,
        sentence: `${Change} made the app fail, so Gregale put the previous values back.`,
      };
    case 'regressed':
      return {
        word,
        tone,
        sentence: `The app started failing after ${change}, and it couldn’t be undone automatically.`,
        next: 'Set the secret again, or roll the variables back below.',
      };
    case 'no_traffic':
      return {
        word,
        tone,
        sentence: `${Change} served no traffic within 24 hours, so it was never judged.`,
      };
    case 'superseded':
      return {
        word,
        tone,
        sentence: `A newer change arrived before ${change} was judged.`,
      };
  }
  return { word, tone, sentence: `Config guard: ${g.status}.` };
}

export interface DayGroup<T> {
  label: string;
  items: T[];
}

const DAY_MS = 86_400_000;

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A day heading: "Today", "Yesterday", else the weekday and date. */
export function dayLabel(ms: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== new Date(now).getFullYear() && { year: 'numeric' }),
  });
}

/** Groups newest-first revisions by local day, keeping their order. */
export function groupByDay<T extends { created_at: string }>(
  items: T[],
  now: number
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const ms = Date.parse(item.created_at);
    const label = Number.isNaN(ms) ? 'Unknown day' : dayLabel(ms, now);
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export interface SecretVersionChange {
  key: string;
  from?: number;
  to?: number;
}

export interface RevisionDiff {
  added: string[];
  changed: string[];
  removed: string[];
  secrets: SecretVersionChange[];
}

/**
 * What changed between two revisions, as keys. Variable values are compared,
 * never returned; secrets compare by version number.
 */
export function revisionDiff(
  before: Pick<ConfigRevisionDetail, 'variables' | 'secret_versions'>,
  after: Pick<ConfigRevisionDetail, 'variables' | 'secret_versions'>
): RevisionDiff {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [key, value] of Object.entries(after.variables)) {
    if (!(key in before.variables)) added.push(key);
    else if (before.variables[key] !== value) changed.push(key);
  }
  const removed = Object.keys(before.variables).filter((key) => !(key in after.variables));
  const keys = new Set([
    ...Object.keys(before.secret_versions),
    ...Object.keys(after.secret_versions),
  ]);
  const secrets = [...keys]
    .filter((key) => before.secret_versions[key] !== after.secret_versions[key])
    .sort()
    .map((key) => ({ key, from: before.secret_versions[key], to: after.secret_versions[key] }));
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort(), secrets };
}

/** One secret's version change in words. */
export function secretChangeWords(s: SecretVersionChange): string {
  if (s.from == null) return 'added';
  if (s.to == null) return 'removed';
  return `new value (version ${s.from} → ${s.to})`;
}

export const isEmptyDiff = (d: RevisionDiff) =>
  d.added.length + d.changed.length + d.removed.length + d.secrets.length === 0;
