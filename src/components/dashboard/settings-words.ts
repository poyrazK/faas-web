import type { Summary, Tone } from './app-settings-words';

/**
 * Account Settings in plain words (docs/console-plain-english.md): one
 * sentence per section that says what is true now and whether anything needs
 * doing, plus the plain names that auth events, key scopes, roles and
 * invitation states wear. Every sentence is built from fields the API
 * returns; a field it leaves out makes the sentence say less, never a guess.
 * The exact term each word stands for stays available for a `title` or a tip.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/* ------------------------------------------------------------------ *
 * Security: auth events
 * ------------------------------------------------------------------ */

/**
 * Fixed phrases by audit `kind`. The first block mirrors faas's own
 * security-activity phrases (apidserver/account_security_activity.go) so the
 * console and the API say the same thing; the rest are kinds the audit
 * timeline also carries.
 */
const EVENT_PHRASES: Record<string, string> = {
  'auth.session.created': 'Signed in to the dashboard',
  'auth.login': 'Signed in from the CLI or API',
  'auth.logout': 'Signed out',
  'auth.session.revoke': 'A browser session was signed out',
  'auth.sessions.revoke_all': 'All browser sessions were signed out',
  'auth.sessions_revoked_on_password_change': 'Sessions signed out after a password change',
  'auth.sign_in_refused_unverified': 'Sign-in refused: email address not verified',
  'auth.oauth_unlinked_refused': 'Sign-in refused: that provider was removed',
  'auth.mfa.recovery_codes_regenerated': 'Recovery codes replaced',
  'account.password_set': 'Password set or changed',
  'account.email_change_requested': 'Email change requested',
  'account.email_changed': 'Sign-in email changed',
  'account.mfa_enrolled': 'Two-factor sign-in set up',
  'account.mfa_confirmed': 'Two-factor sign-in confirmed',
  'account.mfa_disabled': 'Two-factor sign-in turned off',
  'account.mfa_recovered': 'Signed in with a recovery code',
  'account.mfa_browser_remembered': 'Browser remembered for two-factor sign-in',
  'auth.mfa_trusted_browser_used': 'Signed in from a remembered browser',
  'account.mfa_browser_forgotten': 'A remembered browser was forgotten',
  'account.mfa_browsers_forgotten': 'Remembered browsers were forgotten',
  'account.sign_in_method_linked': 'Sign-in method linked',
  'account.sign_in_method_unlinked': 'Sign-in method removed',
  'account.sign_in_method_link_refused': 'Linking a sign-in method was refused',
  'account.deletion_scheduled': 'Account deletion scheduled',
  'account.deletion_restored': 'Account deletion cancelled',
  'api_key.created': 'API key created',
  'api_key.rotated': 'API key rotated',
  'api_key.revoked': 'API key revoked',
  // Also on the audit timeline.
  'session.signed_in': 'Signed in to the dashboard',
  'auth.session.stolen': 'A session was used from somewhere it should not have been',
  'auth.login.failed': 'Someone tried a wrong password',
  'login.failed_password': 'Someone tried a wrong password',
  'auth.rate_limited': 'Too many sign-in attempts were slowed down',
  'auth.step_up_required': 'An action asked for a fresh two-factor code',
  'auth.step_up_verified': 'A fresh two-factor code was entered',
  'account.mfa_verify_failed': 'A wrong two-factor code was entered',
  'account.mfa_confirm_failed': 'A wrong code was entered while setting up two-factor sign-in',
  'account.mfa_recover_failed': 'A wrong recovery code was entered',
  'account.mfa_disable_failed': 'Turning off two-factor sign-in failed',
  'account.password_set_denied': 'Setting a password was refused',
  'account.plan_changed': 'Plan changed',
  'account.export_requested': 'Data export downloaded',
  'api_key.minted': 'API key created',
  'key.created': 'API key created',
  'key.rotated': 'API key rotated',
  'key.revoked': 'API key revoked',
  'key.deleted': 'API key revoked',
  'secret.set': 'A secret was saved',
  'secret.rotated': 'A secret was rotated',
  'secret.deleted': 'A secret was deleted',
  'env.set': 'An environment variable was saved',
  'env.deleted': 'An environment variable was deleted',
  'overage.cap_changed': 'Spend cap changed',
  'stateless.advisory': 'An app wrote files to local disk, which are lost when it sleeps',
};

/** Kinds that mean someone may be trying to get in. */
const SIGN_IN_TROUBLE = new Set([
  'auth.login.failed',
  'login.failed_password',
  'auth.session.stolen',
  'auth.rate_limited',
  'account.mfa_verify_failed',
  'account.mfa_recover_failed',
]);

export interface AuthEventLike {
  kind: string;
  actor?: string;
  severity?: string;
  at: string;
}

export interface AuthEventWords {
  /** What happened, in a sentence fragment a person reads. */
  text: string;
  /** "Worth a look" / "Needs attention" — absent for an ordinary event. */
  flag?: string;
  tone: Tone;
  /** The exact `kind`, for a `title` and the detail view. */
  code: string;
}

/** Severity in words. `info` (or none) is ordinary and says nothing. */
export function severityWords(severity: string | undefined): { flag?: string; tone: Tone } {
  if (!severity || severity === 'info') return { tone: 'neutral' };
  if (severity === 'warn' || severity === 'warning')
    return { flag: 'Worth a look', tone: 'warning' };
  if (severity === 'high' || severity === 'critical' || severity === 'error')
    return { flag: 'Needs attention', tone: 'critical' };
  return { flag: capitalise(severity), tone: 'warning' };
}

/** A kind the table does not know is named from its own words, never guessed at. */
function phraseFromKind(kind: string): string {
  const words = kind.replace(/[._]+/g, ' ').trim();
  return words ? capitalise(words) : 'Security event';
}

export function authEventWords(event: AuthEventLike): AuthEventWords {
  const { flag, tone } = severityWords(event.severity);
  return {
    text: EVENT_PHRASES[event.kind] ?? phraseFromKind(event.kind),
    flag,
    tone,
    code: event.kind,
  };
}

/** Platform services record events as themselves; a person reads "Gregale". */
const SYSTEM_ACTORS = new Set(['apid', 'system', 'scheduler', 'sched', 'operator']);

export function actorWords(actor: string | undefined): string {
  if (!actor) return '';
  return SYSTEM_ACTORS.has(actor) ? 'Gregale' : actor;
}

/* ------------------------------------------------------------------ *
 * Security: sessions
 * ------------------------------------------------------------------ */

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

/**
 * A login's User-Agent as a person names the device: "Chrome on macOS",
 * "Gregale CLI 0.9.2". An agent this cannot read is shown as sent; an empty
 * one says so instead of inventing a device.
 */
export function deviceWords(agent: string | undefined | null): string {
  const ua = (agent ?? '').trim();
  if (!ua) return 'Unknown device';
  const cli = /^gregale(?:-cli)?\/(\S+)/i.exec(ua);
  if (cli) return `Gregale CLI ${cli[1]}`;
  // Already short ("Chrome 128 · macOS"): keep it, it is already readable.
  if (!ua.includes('/') && ua.length <= 48) return ua.replace(/\s*·\s*/, ' on ');
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  if (browser ?? system) return (browser ?? system)!;
  return ua.length > 48 ? `${ua.slice(0, 47)}…` : ua;
}

const WEEK_MS = 7 * 24 * 3600e3;

/**
 * The Security section's sentence: who is signed in, and whether anything in
 * the last week looks like someone trying to get in. MFA enrolment is not on
 * any account read this console has (`GET /v1/account` carries no MFA field),
 * so the sentence never claims MFA is on or off.
 */
export function securitySummary({
  sessions,
  events,
  now,
}: {
  sessions?: { current_session?: boolean }[];
  events?: AuthEventLike[];
  now: number;
}): Summary {
  const parts: string[] = [];
  const facts: string[] = [];
  let tone: Tone = 'good';
  if (sessions) {
    const n = sessions.length;
    const others = sessions.filter((s) => !s.current_session).length;
    parts.push(
      n === 0
        ? 'No dashboard sessions are signed in.'
        : others === 0 && n === 1
          ? 'Only this browser is signed in.'
          : `${plural(n, 'device is', 'devices are')} signed in, including this one.`
    );
  }
  const trouble = (events ?? []).filter(
    (e) => SIGN_IN_TROUBLE.has(e.kind) && now - Date.parse(e.at) <= WEEK_MS
  );
  if (trouble.length > 0) {
    tone = 'warning';
    parts.push(
      trouble.length === 1
        ? 'Someone failed to sign in this week — check it was you.'
        : `${trouble.length} failed sign-ins this week — check they were you.`
    );
  } else if (events) {
    parts.push('No failed sign-ins this week.');
  }
  if (!sessions && !events) {
    tone = 'neutral';
    parts.push('Reading sessions and sign-in activity…');
  }
  // Runtime advisories ride the same timeline but are not about who signs in.
  const flagged = (events ?? []).filter(
    (e) => e.kind !== 'stateless.advisory' && severityWords(e.severity).flag
  ).length;
  if (flagged > 0) facts.push(`${plural(flagged, 'recent event', 'recent events')} worth a look`);
  return { sentence: parts.join(' '), facts, tone };
}

/* ------------------------------------------------------------------ *
 * API keys
 * ------------------------------------------------------------------ */

/** Key scopes as a person says them; the scope string stays in a `title`. */
export const SCOPE_WORDS: Record<string, string> = {
  admin: 'Everything',
  'deploy:write': 'Deploy',
  'apps:read': 'Read apps',
  'secrets:read': 'Read secrets',
  'secrets:write': 'Change secrets',
  'env:read': 'Read environment',
  'env:write': 'Change environment',
  'usage:read': 'Read usage',
  read: 'Read',
  agent: 'Agent tools',
};

export function scopeWords(scope: string): string {
  return SCOPE_WORDS[scope] ?? scope;
}

export function keysSummary(
  keys: { scopes?: string[]; last_used_at?: string | null }[] | undefined,
  owner: 'personal' | { org: string }
): Summary {
  if (!keys) return { sentence: 'Reading keys…', facts: [], tone: 'neutral' };
  const whose = owner === 'personal' ? 'personal' : 'shared';
  if (keys.length === 0)
    return {
      sentence:
        owner === 'personal'
          ? 'No personal API keys yet. Create one for CI or a script that deploys for you.'
          : `${owner.org} has no shared keys yet. Shared keys keep CI deploying when someone leaves.`,
      facts: [],
      tone: 'neutral',
    };
  const unused = keys.filter((k) => !k.last_used_at).length;
  const admin = keys.filter((k) => k.scopes?.includes('admin')).length;
  const lead =
    owner === 'personal'
      ? `You have ${plural(keys.length, `${whose} key`, `${whose} keys`)}.`
      : `${owner.org} has ${plural(keys.length, `${whose} key`, `${whose} keys`)}.`;
  const notes: string[] = [];
  if (unused > 0)
    notes.push(
      unused === keys.length
        ? keys.length === 1
          ? 'It has never been used.'
          : 'None has been used yet.'
        : `${unused} ${unused === 1 ? 'has' : 'have'} never been used.`
    );
  if (admin > 0)
    notes.push(
      admin === 1
        ? keys.length === 1
          ? 'It can do everything this account can.'
          : '1 can do everything this account can.'
        : `${admin} can do everything this account can.`
    );
  return { sentence: [lead, ...notes].join(' '), facts: [], tone: 'neutral' };
}

/* ------------------------------------------------------------------ *
 * Members and organizations
 * ------------------------------------------------------------------ */

export const ROLE_WORDS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  developer: 'Developer',
  viewer: 'Viewer',
  billing: 'Billing',
};

export const roleWords = (role: string) => ROLE_WORDS[role] ?? capitalise(role);

/** Invitation `status` in words. */
export const INVITATION_WORDS: Record<string, string> = {
  pending: 'Waiting',
  consumed: 'Accepted',
  revoked: 'Revoked',
  expired: 'Expired',
};

export const invitationWords = (status: string) => INVITATION_WORDS[status] ?? capitalise(status);

export function membersSummary({
  org,
  personal,
  members,
  invitations,
  role,
}: {
  org: string;
  personal?: boolean;
  members?: { role: string }[];
  invitations?: { status: string }[];
  role?: string;
}): Summary {
  if (personal)
    return {
      sentence: `${org} is your personal organization, so it has only you. Create a shared organization to work with other people.`,
      facts: [],
      tone: 'neutral',
    };
  if (!members) return { sentence: 'Reading members…', facts: [], tone: 'neutral' };
  const waiting = (invitations ?? []).filter((i) => i.status === 'pending').length;
  const parts = [`${org} has ${plural(members.length, 'member', 'members')}.`];
  if (invitations)
    parts.push(
      waiting === 0
        ? 'No invitations are waiting.'
        : `${plural(waiting, 'invitation is', 'invitations are')} waiting to be accepted.`
    );
  const facts = role ? [`Your role: ${roleWords(role)}`] : [];
  return { sentence: parts.join(' '), facts, tone: 'neutral' };
}

export function organizationSummary({
  name,
  personal,
  seats,
}: {
  name?: string;
  personal?: boolean;
  seats?: { used: number; limit: number; plan: string };
}): Summary {
  const who = name ?? 'This organization';
  if (personal)
    return {
      sentence: `${who} is your personal organization. It is always yours and can't be renamed or deleted.`,
      facts: [],
      tone: 'neutral',
    };
  if (!seats) return { sentence: `${who} is a shared organization.`, facts: [], tone: 'neutral' };
  if (seats.limit === 0)
    return {
      sentence: `${who} is on the ${capitalise(seats.plan)} plan, which includes personal organizations only — no shared member seats.`,
      facts: [],
      tone: 'warning',
    };
  const full = seats.used >= seats.limit;
  return {
    sentence: `${who} uses ${seats.used} of ${seats.limit} member seats on the ${capitalise(seats.plan)} plan.${
      full ? ' Every seat is taken, so new members need a bigger plan.' : ''
    }`,
    facts: [],
    tone: full ? 'warning' : 'neutral',
  };
}

/* ------------------------------------------------------------------ *
 * General, integrations, previews, limits, privacy
 * ------------------------------------------------------------------ */

export function accountSummary(
  account:
    | {
        email: string;
        plan: string;
        app_count: number;
        email_verified?: boolean;
        email_verification_grace_ends_at?: string;
      }
    | undefined
): Summary {
  if (!account) return { sentence: 'Reading your account…', facts: [], tone: 'neutral' };
  const sentence = `You're on the ${capitalise(account.plan)} plan with ${plural(account.app_count, 'app', 'apps')} deployed.`;
  if (account.email_verified === false)
    return {
      sentence: `${sentence} Verify your email address to keep signing in.`,
      facts: account.email_verification_grace_ends_at
        ? [`Verify by ${new Date(account.email_verification_grace_ends_at).toLocaleDateString()}`]
        : [],
      tone: 'warning',
    };
  return { sentence, facts: [], tone: 'good' };
}

export function githubSummary(connected: boolean): Summary {
  return connected
    ? {
        sentence: 'GitHub is connected. New apps can deploy straight from your repositories.',
        facts: [],
        tone: 'good',
      }
    : {
        sentence: "GitHub isn't connected. Connect it to deploy from your repositories.",
        facts: [],
        tone: 'neutral',
      };
}

export function previewsSummary(
  items: { joined: boolean; eligible: boolean }[] | undefined,
  workspace: string
): Summary {
  if (!items) return { sentence: 'Reading previews…', facts: [], tone: 'neutral' };
  if (items.length === 0)
    return {
      sentence: 'No early features are open to try right now.',
      facts: [],
      tone: 'neutral',
    };
  const joined = items.filter((p) => p.joined).length;
  const open = items.filter((p) => p.joined || p.eligible).length;
  return {
    sentence:
      joined > 0
        ? `${joined} of ${plural(open, 'early feature', 'early features')} ${joined === 1 ? 'is' : 'are'} turned on for ${workspace}.`
        : open === 0
          ? items.length === 1
            ? "The early feature on offer isn't available on your plan."
            : `None of the ${items.length} early features on offer are available on your plan.`
          : `${plural(open, 'early feature is', 'early features are')} open to try on your plan. Nothing is turned on for ${workspace} yet.`,
    facts: ['They may change before everyone gets them'],
    tone: 'neutral',
  };
}

/**
 * Egress allowlist budget (`/v1/account/egress_allowlist_extra`). The cap
 * counts CIDR entries in an app's outbound allowlist: the outside addresses
 * an app may connect to.
 */
export function egressSummary(
  value: { extra: number; plan_cap: number; max_extra: number } | undefined
): Summary {
  if (!value) return { sentence: 'Reading your limits…', facts: [], tone: 'neutral' };
  const total = value.plan_cap + value.extra;
  if (total === 0)
    return {
      sentence: "On this plan, apps can't keep a list of the outside addresses they may call.",
      facts: [],
      tone: 'neutral',
    };
  return {
    sentence: `When you limit where an app may connect out to, its list can hold up to ${plural(total, 'address range', 'address ranges')}.`,
    facts: [
      value.extra > 0
        ? `${value.plan_cap} from your plan + ${value.extra} extra`
        : `${value.plan_cap} from your plan, no extra added`,
    ],
    tone: 'neutral',
  };
}

export function privacySummary(deletionPending: boolean): Summary {
  return deletionPending
    ? {
        sentence:
          'Your account is scheduled for deletion. You can still restore it during the 30-day window.',
        facts: [],
        tone: 'warning',
      }
    : {
        sentence:
          'You can download everything this account holds at any time. Deleting the account waits 30 days before anything is removed.',
        facts: [],
        tone: 'neutral',
      };
}
