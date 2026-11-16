import { describe, expect, it } from 'vitest';
import {
  accountSummary,
  actorWords,
  authEventWords,
  deviceWords,
  egressSummary,
  githubSummary,
  invitationWords,
  keysSummary,
  membersSummary,
  organizationSummary,
  previewsSummary,
  privacySummary,
  roleWords,
  scopeWords,
  securitySummary,
  severityWords,
} from './settings-words';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600e3).toISOString();

describe('auth events in words', () => {
  it.each([
    ['session.signed_in', 'Signed in to the dashboard'],
    ['auth.session.created', 'Signed in to the dashboard'],
    ['login.failed_password', 'Someone tried a wrong password'],
    ['api_key.minted', 'API key created'],
    ['account.mfa_enrolled', 'Two-factor sign-in set up'],
    ['stateless.advisory', 'An app wrote files to local disk, which are lost when it sleeps'],
  ])('%s reads as "%s" and keeps its code', (kind, text) => {
    const words = authEventWords({ kind, at: hoursAgo(1) });
    expect(words.text).toBe(text);
    expect(words.code).toBe(kind);
  });

  it('names an unknown kind from its own words instead of guessing', () => {
    expect(authEventWords({ kind: 'billing.thing_happened', at: hoursAgo(1) }).text).toBe(
      'Billing thing happened'
    );
  });

  it('says nothing for an ordinary severity and flags the rest in words', () => {
    expect(severityWords(undefined)).toEqual({ tone: 'neutral' });
    expect(severityWords('info')).toEqual({ tone: 'neutral' });
    expect(severityWords('warn')).toEqual({ flag: 'Worth a look', tone: 'warning' });
    expect(severityWords('high')).toEqual({ flag: 'Needs attention', tone: 'critical' });
  });

  it('shows platform services as Gregale and people as themselves', () => {
    expect(actorWords('apid')).toBe('Gregale');
    expect(actorWords('demo@acme-corp.dev')).toBe('demo@acme-corp.dev');
  });
});

describe('devices', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Chrome on macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      'Edge on Windows',
    ],
    ['gregale-cli/0.9.2', 'Gregale CLI 0.9.2'],
    ['Chrome 128 · macOS', 'Chrome 128 on macOS'],
    ['', 'Unknown device'],
  ])('%s → %s', (agent, words) => {
    expect(deviceWords(agent)).toBe(words);
  });
});

describe('security sentence', () => {
  const sessions = [{ current_session: true }, { current_session: false }, {}];

  it('counts devices and says when nothing failed this week', () => {
    const summary = securitySummary({ sessions, events: [], now: NOW });
    expect(summary.sentence).toBe(
      '3 devices are signed in, including this one. No failed sign-ins this week.'
    );
    expect(summary.tone).toBe('good');
  });

  it('warns about a failed sign-in in the last week, not an older one', () => {
    const recent = securitySummary({
      sessions: [{ current_session: true }],
      events: [{ kind: 'login.failed_password', severity: 'warn', at: hoursAgo(48) }],
      now: NOW,
    });
    expect(recent.sentence).toBe(
      'Only this browser is signed in. Someone failed to sign in this week — check it was you.'
    );
    expect(recent.tone).toBe('warning');

    const old = securitySummary({
      sessions: [{ current_session: true }],
      events: [{ kind: 'login.failed_password', severity: 'warn', at: hoursAgo(24 * 9) }],
      now: NOW,
    });
    expect(old.tone).toBe('good');
  });

  it('never claims MFA is on or off', () => {
    const { sentence } = securitySummary({ sessions, events: [], now: NOW });
    expect(sentence).not.toMatch(/MFA|two-factor/i);
  });

  it('does not count runtime advisories as security events worth a look', () => {
    const summary = securitySummary({
      events: [{ kind: 'stateless.advisory', severity: 'high', at: hoursAgo(1) }],
      now: NOW,
    });
    expect(summary.facts).toEqual([]);
  });

  it('says it is still reading rather than inventing zero', () => {
    expect(securitySummary({ now: NOW }).sentence).toMatch(/Reading/);
  });
});

describe('keys', () => {
  it('names unused and all-powerful keys', () => {
    expect(
      keysSummary(
        [
          { scopes: ['admin'], last_used_at: hoursAgo(1) },
          { scopes: ['apps:read'], last_used_at: null },
          { scopes: ['usage:read'], last_used_at: hoursAgo(2) },
        ],
        'personal'
      ).sentence
    ).toBe(
      'You have 3 personal keys. 1 has never been used. 1 can do everything this account can.'
    );
  });

  it('explains what shared keys are for when there are none', () => {
    expect(keysSummary([], { org: 'acme' }).sentence).toBe(
      'acme has no shared keys yet. Shared keys keep CI deploying when someone leaves.'
    );
  });

  it('keeps the scope code behind its plain name', () => {
    expect(scopeWords('deploy:write')).toBe('Deploy');
    expect(scopeWords('admin')).toBe('Everything');
    expect(scopeWords('future:scope')).toBe('future:scope');
  });
});

describe('members and organizations', () => {
  it('counts members and waiting invitations', () => {
    const summary = membersSummary({
      org: 'acme',
      members: [{ role: 'owner' }, { role: 'developer' }],
      invitations: [{ status: 'pending' }, { status: 'consumed' }],
      role: 'owner',
    });
    expect(summary.sentence).toBe('acme has 2 members. 1 invitation is waiting to be accepted.');
    expect(summary.facts).toEqual(['Your role: Owner']);
  });

  it('explains a personal organization has only you', () => {
    expect(membersSummary({ org: 'me', personal: true }).sentence).toMatch(/only you/);
  });

  it('says how many seats are used, and when they run out', () => {
    expect(
      organizationSummary({ name: 'Acme', seats: { used: 2, limit: 5, plan: 'pro' } }).sentence
    ).toBe('Acme uses 2 of 5 member seats on the Pro plan.');
    const full = organizationSummary({ name: 'Acme', seats: { used: 5, limit: 5, plan: 'pro' } });
    expect(full.tone).toBe('warning');
    expect(full.sentence).toMatch(/Every seat is taken/);
    expect(
      organizationSummary({ name: 'Acme', seats: { used: 1, limit: 0, plan: 'free' } }).sentence
    ).toMatch(/personal organizations only/);
  });

  it('puts roles and invitation states in words', () => {
    expect(roleWords('billing')).toBe('Billing');
    expect(invitationWords('consumed')).toBe('Accepted');
    expect(invitationWords('pending')).toBe('Waiting');
  });
});

describe('general, integrations, previews, limits, privacy', () => {
  it('leads the account with plan and apps, and asks for verification when needed', () => {
    const base = { email: 'a@b.c', plan: 'pro', app_count: 1 };
    expect(accountSummary(base).sentence).toBe("You're on the Pro plan with 1 app deployed.");
    const unverified = accountSummary({ ...base, email_verified: false });
    expect(unverified.tone).toBe('warning');
    expect(unverified.sentence).toMatch(/Verify your email/);
  });

  it('says whether GitHub is connected', () => {
    expect(githubSummary(true).sentence).toMatch(/^GitHub is connected/);
    expect(githubSummary(false).sentence).toMatch(/^GitHub isn't connected/);
  });

  it('counts only previews open on this plan', () => {
    expect(
      previewsSummary(
        [
          { joined: false, eligible: true },
          { joined: false, eligible: false },
        ],
        'Acme'
      ).sentence
    ).toBe('1 early feature is open to try on your plan. Nothing is turned on for Acme yet.');
    expect(previewsSummary([{ joined: true, eligible: true }], 'Acme').sentence).toBe(
      '1 of 1 early feature is turned on for Acme.'
    );
  });

  it('explains the egress limit before the number', () => {
    const summary = egressSummary({ extra: 4, plan_cap: 16, max_extra: 1024 });
    expect(summary.sentence).toBe(
      'When you limit where an app may connect out to, its list can hold up to 20 address ranges.'
    );
    expect(summary.facts).toEqual(['16 from your plan + 4 extra']);
  });

  it('says when deletion is pending', () => {
    expect(privacySummary(true).tone).toBe('warning');
    expect(privacySummary(false).sentence).toMatch(/download everything/);
  });
});
