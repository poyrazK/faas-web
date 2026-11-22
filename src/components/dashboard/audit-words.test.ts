import { describe, expect, it } from 'vitest';
import { describeAuditEntry, matchesAuditSearch, type AuditEntry } from './audit-words';

const entry = {
  id: 'event-1',
  kind: 'secret.set',
  received_at: '2026-11-22T11:14:23Z',
  account_email: 'owner@example.com',
} satisfies AuditEntry;

describe('describeAuditEntry', () => {
  it('names the secret and scope while leaving the affected account separate from the actor', () => {
    const row = describeAuditEntry({
      ...entry,
      actor: 'apid',
      data: { name: 'DATABASE_URL', scope: 'staging', app_id: 'app-1', value: 'secret-value' },
    });

    expect(row.sentence).toBe('The secret DATABASE_URL was set.');
    expect(row.actor).toBeUndefined();
    expect(row.detail).toEqual(
      expect.arrayContaining([
        { label: 'Environment scope', value: 'staging' },
        { label: 'Affected account', value: 'owner@example.com' },
        { label: 'Recorded actor', value: 'apid' },
      ])
    );
    expect(matchesAuditSearch(row, 'database_url')).toBe(true);
    expect(matchesAuditSearch(row, 'secret.set')).toBe(true);
    expect(matchesAuditSearch(row, 'app-1')).toBe(true);
    expect(matchesAuditSearch(row, 'secret-value')).toBe(false);
  });

  it('preserves an explicitly recorded identity and names a background re-encryption accurately', () => {
    const person = describeAuditEntry({
      ...entry,
      kind: 'api_key.created',
      actor: 'maya@example.com',
    });
    expect(person.actor).toBe('maya@example.com');
    const rekey = describeAuditEntry({
      ...entry,
      kind: 'secret.rotated',
      actor: 'rekey',
      data: { name: 'DATABASE_URL' },
    });
    expect(rekey.sentence).toBe('The secret DATABASE_URL was re-encrypted.');
  });

  it.each([
    ['key.created', 'An API key was created.'],
    ['account.email_change_requested', 'A change to the sign-in email was requested.'],
    ['account.email_changed', 'The sign-in email was changed.'],
    ['auth.login.failed', 'A sign-in attempt failed.'],
    ['account.deletion_scheduled', 'Account deletion was scheduled.'],
    ['account.deleted', 'The account was deleted.'],
  ])('narrates %s with the recorded outcome', (kind, sentence) => {
    expect(describeAuditEntry({ ...entry, kind }).sentence).toBe(sentence);
  });

  it('keeps sign-in evidence while distinguishing session creation from authentication', () => {
    const row = describeAuditEntry({
      ...entry,
      kind: 'auth.session.created',
      data: {
        method: 'github',
        issued_ip: '203.0.113.8',
        mfa_pending: true,
        sid: 'session-secret',
      },
    });
    expect(row.sentence).toBe('A dashboard session was created.');
    expect(row.detail).toContainEqual({ label: 'IP address', value: '203.0.113.8' });
    expect(row.detail).toContainEqual({
      label: 'Two-factor authentication',
      value: 'Pending when recorded',
    });
    expect(matchesAuditSearch(row, 'session-secret')).toBe(false);
  });

  it('keeps an unfamiliar event addressable without reading arbitrary payload fields', () => {
    const row = describeAuditEntry({
      ...entry,
      kind: 'new.event',
      received_at: 'unavailable',
      data: { name: 'unverified-subject', reason: 'unverified-explanation' },
    });
    expect(row.sentence).toBe('An audit event was recorded.');
    expect(row.detail).toContainEqual({ label: 'Event type', value: 'new.event' });
    expect(row.detail).toContainEqual({ label: 'Event ID', value: 'event-1' });
    expect(row.detail.some(({ label }) => label === 'Recorded at')).toBe(false);
    expect(matchesAuditSearch(row, 'unverified-explanation')).toBe(false);
  });
});
