import type { components } from '@/lib/api/schema';
import { absoluteTime, parseTime } from '@/lib/time';

export type AuditEntry = components['schemas']['AuditLogEntry'];

const eventSentences = new Map([
  ['key.created', 'An API key was created.'],
  ['key.deleted', 'An API key was removed.'],
  ['api_key.created', 'An API key was created.'],
  ['api_key.rotated', 'An API key was rotated.'],
  ['api_key.revoked', 'An API key was revoked.'],
  ['auth.session.created', 'A dashboard session was created.'],
  ['auth.login', 'A sign-in was recorded.'],
  ['auth.login.failed', 'A sign-in attempt failed.'],
  ['auth.logout', 'A sign-out was recorded.'],
  ['auth.session.revoke', 'A browser session was signed out.'],
  ['auth.sessions.revoke_all', 'All browser sessions were signed out.'],
  [
    'auth.sign_in_refused_unverified',
    'Sign-in was blocked because the email address was unverified.',
  ],
  [
    'auth.oauth_unlinked_refused',
    'Sign-in was blocked because the sign-in provider had been removed.',
  ],
  ['auth.recent_sign_in_required', 'A change was blocked until the user signs in again.'],
  ['account.updated', 'Account settings were updated.'],
  ['account.password_set', 'The account password was set.'],
  ['account.password_set_denied', 'A password change was blocked.'],
  ['account.email_change_requested', 'A change to the sign-in email was requested.'],
  ['account.email_changed', 'The sign-in email was changed.'],
  ['account.email_reverted', 'Gregale support restored the sign-in email.'],
  ['account.mfa_enrolled', 'Two-factor authentication was set up.'],
  ['account.mfa_confirmed', 'Two-factor authentication was confirmed.'],
  ['account.mfa_disabled', 'Two-factor authentication was turned off.'],
  ['account.deletion_scheduled', 'Account deletion was scheduled.'],
  ['account.deletion_restored', 'Account deletion was cancelled.'],
  ['account.deleted', 'The account was deleted.'],
  ['app.created', 'An app was created.'],
  ['app.deleted', 'An app was deleted.'],
  ['domain.added', 'A domain was added.'],
  ['domain.removed', 'A domain was removed.'],
]);

const settingEvents = new Map([
  ['secret.set', { resource: 'secret', action: 'was set' }],
  ['secret.rotated', { resource: 'secret', action: 'was rotated' }],
  ['secret.deleted', { resource: 'secret', action: 'was removed' }],
  ['env.set', { resource: 'environment variable', action: 'was set' }],
  ['env.deleted', { resource: 'environment variable', action: 'was removed' }],
]);

const signInMethods = new Map([
  ['magic_link', 'Email link'],
  ['password', 'Password'],
  ['github', 'GitHub'],
  ['google', 'Google'],
]);

type Fact = { label: string; value: string };

function recordedText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function timeWords(value: string | undefined): string | undefined {
  const ms = parseTime(value);
  return ms === undefined ? undefined : absoluteTime(ms);
}

/**
 * The actor in this feed often identifies a daemon. Only explicit identities
 * are useful in the narrative; the exact actor stays available in the record.
 */
function namedActor(actor: string | undefined): string | undefined {
  if (actor && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor)) return actor;
  const github = actor?.match(/^github:([a-z\d-]+)$/i)?.[1];
  return github && github !== 'unknown' ? github + ' on GitHub' : undefined;
}

export function describeAuditEntry(entry: AuditEntry) {
  const { data, kind } = entry;
  const field = (key: string) => recordedText(data?.[key]);
  const actor = recordedText(entry.actor);
  const detail: Fact[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value) detail.push({ label, value });
  };

  let sentence = eventSentences.get(kind) ?? 'An audit event was recorded.';
  const setting = settingEvents.get(kind);
  if (setting) {
    const { resource, action } = setting;
    const name = field('name');
    const subject = name
      ? 'The ' + resource + ' ' + name
      : resource === 'secret'
        ? 'A secret'
        : 'An environment variable';
    const change = kind === 'secret.rotated' && actor === 'rekey' ? 'was re-encrypted' : action;
    sentence = subject + ' ' + change + '.';
    add(resource === 'secret' ? 'Secret' : 'Variable', name);
    add('App ID', field('app_id'));
    add('Environment scope', field('scope'));
  }

  if (kind === 'app.created' || kind === 'app.deleted') {
    const slug = field('slug');
    if (slug)
      sentence = 'The app ' + slug + (kind === 'app.created' ? ' was created.' : ' was deleted.');
    add('App', slug);
    add('App ID', field('app_id'));
  }
  if (kind === 'domain.added' || kind === 'domain.removed') {
    const domain = field('domain');
    if (domain)
      sentence =
        domain +
        (kind === 'domain.added' ? ' was added as a domain.' : ' was removed as a domain.');
    add('Domain', domain);
    add('App ID', field('app_id'));
    add('Environment scope', field('environment'));
  }

  if (eventSentences.has(kind) && (kind.startsWith('api_key.') || kind.startsWith('key.'))) {
    add('API key ID', field('key_id'));
    add('IP address', field('created_ip'));
    const scopes = data?.scopes;
    const permissions = Array.isArray(scopes)
      ? scopes.flatMap((scope: unknown) => recordedText(scope) ?? [])
      : [];
    add('Permissions', permissions.join(', '));
    add('Expires at', timeWords(field('expires_at')));
  }

  if (kind === 'auth.session.created' || kind === 'auth.login') {
    const method = field('method');
    if (method) add('Sign-in method', signInMethods.get(method));
    if (data?.mfa_pending === true) add('Two-factor authentication', 'Pending when recorded');
  }
  if (kind === 'auth.session.created' || kind === 'auth.login' || kind === 'auth.login.failed') {
    add('IP address', field('issued_ip') ?? field('ip'));
  }
  if (kind === 'account.deletion_scheduled' && data?.includes_managed_postgres === true) {
    add('Includes', 'Managed Postgres databases');
  }

  add('Recorded at', timeWords(entry.received_at));
  add('Recorded actor', actor);
  add('Affected account', recordedText(entry.account_email));
  add('Account ID', recordedText(entry.account_id));
  add('Event ID', entry.id);
  add('Event type', kind);
  return {
    id: entry.id,
    received_at: entry.received_at,
    sentence,
    actor: namedActor(actor),
    detail,
  };
}

export type AuditNarrative = ReturnType<typeof describeAuditEntry>;

export function matchesAuditSearch(row: AuditNarrative, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    [row.sentence, row.actor, ...row.detail.map(({ value }) => value)].some((value) =>
      value?.toLowerCase().includes(needle)
    )
  );
}
