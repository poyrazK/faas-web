import { describe, expect, it } from 'vitest';
import { auditQuery, DEFAULT_AUDIT_FILTERS } from './audit-filters';

describe('auditQuery', () => {
  it('sends only the limit by default', () => {
    expect(auditQuery(DEFAULT_AUDIT_FILTERS)).toEqual({ limit: 100 });
  });

  it('normalises since to RFC 3339 UTC and passes the rest through', () => {
    const q = auditQuery({
      since: '2026-08-30T10:00',
      kind_prefix: 'auth.',
      limit: 50,
      include_anonymous: true,
      app_id: 'a1',
    });
    expect(q.since).toBe(new Date('2026-08-30T10:00').toISOString());
    expect(q).toMatchObject({
      kind_prefix: 'auth.',
      limit: 50,
      include_anonymous: true,
      app_id: 'a1',
    });
  });
});
