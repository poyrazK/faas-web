import type { DeployToken } from '@/lib/api/deploy-tokens';
import type { Tone } from './app-settings-words';

/**
 * The Source and access tab's panels in plain words
 * (docs/console-plain-english.md): one sentence per panel that says what is
 * set now and whether anything needs doing, built only from fields the API
 * returns. A field still loading makes the sentence say less, never a guess.
 */

export interface StateLine {
  sentence: string;
  tone: Tone;
}

const DAY = 86_400_000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const parse = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** A past moment by calendar day: "today", "yesterday", "3 days ago", "on Oct 2". */
export function dayWords(iso: string | null | undefined, now: number): string | null {
  const ms = parse(iso);
  if (ms === null) return null;
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `on ${new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** A future moment, rounded down so it never promises more time than there is. */
export function timeLeftWords(iso: string | null | undefined, now: number): string | null {
  const ms = parse(iso);
  if (ms === null || ms <= now) return null;
  const days = Math.floor((ms - now) / DAY);
  return days < 1 ? 'within a day' : `in ${plural(days, 'day', 'days')}`;
}

// ---- Supply chain -------------------------------------------------------

/**
 * Signed-deploy enforcement and the trusted publishers, in one sentence.
 * With signatures required and no publisher, imaged refuses every image
 * ("require_signed=true but no trusted publishers configured",
 * faas pkg/imaged/handler.go checkImageSignature).
 */
export function supplyChainLine(
  requireSigned: boolean | undefined,
  publishers: number | undefined
): StateLine | null {
  if (requireSigned === undefined) return null;
  if (requireSigned) {
    if (publishers === 0)
      return {
        sentence:
          'Only signed images can be deployed, and no trusted publisher is set up, so every image deploy is refused.',
        tone: 'critical',
      };
    return { sentence: 'Only images signed by a trusted publisher can be deployed.', tone: 'good' };
  }
  const lead = 'Any image can be deployed.';
  if (publishers === undefined) return { sentence: lead, tone: 'neutral' };
  return {
    sentence:
      publishers === 0
        ? `${lead} No trusted publisher is set up yet.`
        : `${lead} ${plural(publishers, 'trusted publisher is', 'trusted publishers are')} set up.`,
    tone: 'neutral',
  };
}

/** The toggle's caution: the warning before a publisher exists, the rule after. */
export function requireSignedNote(publishers: number | undefined, on: boolean): StateLine {
  if (publishers === 0 && !on)
    return {
      sentence:
        'Add a trusted publisher first: with none set up, turning this on refuses every deploy.',
      tone: 'warning',
    };
  return {
    sentence: on
      ? 'Unsigned images are refused at deploy time while this is on.'
      : 'Unsigned images are refused at deploy time once this is on. Turn it on only after a publisher below can sign.',
    tone: 'neutral',
  };
}

// ---- Private registries ------------------------------------------------

export const REGISTRY_EMPTY = 'Add a login so Gregale can pull images from a private registry.';

/** The saved registry logins, in one sentence. */
export function registryLine(registries: string[]): string {
  if (registries.length === 0) return REGISTRY_EMPTY;
  if (registries.length === 1)
    return `Gregale signs in to ${registries[0]} when it pulls private images.`;
  return `Gregale signs in to ${registries.length} private registries when it pulls images.`;
}

/** The registry cap, for the tip. */
export function registryQuotaWords(quota: number | undefined): string | null {
  return quota ? `Up to ${quota} registries; replacing one does not use another.` : null;
}

// ---- Deploy tokens -----------------------------------------------------

/** Days left at which a working token's expiry is called out. */
export const EXPIRES_SOON_DAYS = 14;

export type TokenState = 'active' | 'grace' | 'expired' | 'revoked';

/** The server keeps `status` at `active` after expiry; the clock decides. */
export function tokenState(token: DeployToken, now: number): TokenState {
  if (token.status === 'revoked') return 'revoked';
  const expires = parse(token.expires_at);
  if (expires !== null && expires <= now) return 'expired';
  return token.status === 'grace' ? 'grace' : 'active';
}

/**
 * Each state as a word. `grace` is the old key after a rotation that still
 * authenticates until its expiry (faas state.APIKeyStatusGrace).
 */
export const TOKEN_STATE: Record<
  TokenState,
  { label: string; term: string; color: string | undefined }
> = {
  active: { label: 'Active', term: 'active', color: 'var(--status-good)' },
  grace: { label: 'Being replaced', term: 'grace', color: 'var(--status-warning)' },
  expired: { label: 'Expired', term: 'expired', color: 'var(--status-critical)' },
  revoked: { label: 'Revoked', term: 'revoked', color: undefined },
};

export function tokenName(token: DeployToken): string {
  return token.label || `token ${token.id.slice(0, 8)}`;
}

const capital = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

function expiresSoon(token: DeployToken, now: number): string | null {
  const ms = parse(token.expires_at);
  if (ms === null || ms <= now || ms - now > EXPIRES_SOON_DAYS * DAY) return null;
  return timeLeftWords(token.expires_at, now);
}

/** A token row's one quiet line, and whether it calls out an expiry. */
export function tokenLine(token: DeployToken, now: number): { text: string; soon: boolean } {
  const state = tokenState(token, now);
  if (state === 'revoked') {
    const when = dayWords(token.revoked_at, now);
    return { text: when ? `Revoked ${when}` : 'Revoked', soon: false };
  }
  if (state === 'expired') {
    const when = dayWords(token.expires_at, now);
    return { text: when ? `Expired ${when}` : 'Expired', soon: false };
  }
  const used = dayWords(token.last_used_at, now);
  const parts = [used ? `Last used ${used}` : 'Never used'];
  if (state === 'grace') parts.push('still works until it expires');
  const soon = expiresSoon(token, now);
  if (soon) parts.push(`expires ${soon}`);
  return { text: parts.join(' · '), soon: Boolean(soon) };
}

/** Exact dates and the prefix, for a row's `title`. */
export function tokenDetail(token: DeployToken): string {
  const date = (iso?: string | null) => {
    const ms = parse(iso);
    return ms === null ? null : new Date(ms).toLocaleDateString();
  };
  return [
    date(token.created_at) && `Created ${date(token.created_at)}`,
    date(token.last_used_at) && `Last used ${date(token.last_used_at)}`,
    token.status === 'revoked'
      ? date(token.revoked_at) && `Revoked ${date(token.revoked_at)}`
      : date(token.expires_at) && `Expires ${date(token.expires_at)}`,
    token.prefix && `Starts ${token.prefix}…`,
    `Status: ${token.status}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** All of an app's deploy tokens, in one sentence. */
export function tokensLine(tokens: DeployToken[], slug: string, now: number): StateLine {
  if (tokens.length === 0)
    return {
      sentence: `No deploy tokens yet. Create one so CI can deploy ${slug}.`,
      tone: 'neutral',
    };
  const working = tokens.filter((t) => {
    const state = tokenState(t, now);
    return state === 'active' || state === 'grace';
  });
  const active = working.filter((t) => tokenState(t, now) === 'active').length;
  if (working.length === 0) {
    const expired = tokens.filter((t) => tokenState(t, now) === 'expired').length;
    return {
      sentence: `No token can deploy ${slug} right now.${
        expired ? ` ${capital(plural(expired, 'token has', 'tokens have'))} expired.` : ''
      }`,
      tone: expired ? 'warning' : 'neutral',
    };
  }

  const parts: string[] = [
    active > 0
      ? `${plural(active, 'active token', 'active tokens')}.`
      : `${plural(working.length, 'token is', 'tokens are')} being replaced.`,
  ];
  const used = working
    .filter((t) => parse(t.last_used_at) !== null)
    .sort((a, b) => parse(b.last_used_at)! - parse(a.last_used_at)!)[0];
  if (used) parts.push(`${tokenName(used)} was last used ${dayWords(used.last_used_at, now)}.`);
  else parts.push(working.length === 1 ? 'It hasn’t been used yet.' : 'None has been used yet.');

  const soonest = working
    .filter((t) => expiresSoon(t, now))
    .sort((a, b) => parse(a.expires_at)! - parse(b.expires_at)!)[0];
  if (soonest) parts.push(`${tokenName(soonest)} expires ${expiresSoon(soonest, now)}.`);

  return { sentence: parts.join(' '), tone: soonest ? 'warning' : 'neutral' };
}
