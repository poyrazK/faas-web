import { describe, expect, it } from 'vitest';
import { mockDomainDetail, mockSetDefaultDomain } from './domain-detail';
import type { components } from '../src/lib/api/schema';

type Domain = components['schemas']['CustomDomainResponse'];

const verified = (domain: string, app_id = 'app-1'): Domain => ({
  domain,
  app_id,
  verified: true,
  verified_at: '2026-10-01T00:00:00Z',
  challenge_token: 'tok',
});

describe('mockDomainDetail', () => {
  it('gives a verified domain an issued certificate covering it', () => {
    const d = mockDomainDetail(verified('a.example.com'));
    expect(d.cert_status).toBe('issued');
    expect(d.cert_sans).toEqual(['a.example.com']);
    expect(Date.parse(d.cert_not_after!)).toBeGreaterThan(Date.parse('2026-10-01T00:00:00Z'));
    expect(d.dns_records?.map((r) => r.purpose)).toEqual(['verification', 'routing']);
  });

  it('keeps an unverified domain pending, with no certificate', () => {
    const d = mockDomainDetail({ domain: 'b.example.com', app_id: 'app-1', verified: false });
    expect(d.cert_status).toBe('pending');
    expect(d.cert_not_after).toBeUndefined();
  });
});

describe('mockSetDefaultDomain', () => {
  it('moves the default within the app and leaves other apps alone', () => {
    const rows: Domain[] = [
      { ...verified('a.example.com'), default: true },
      verified('b.example.com'),
      { ...verified('c.example.com', 'app-2'), default: true },
    ];
    expect(mockSetDefaultDomain(rows, 'b.example.com')).toMatchObject({
      domain: 'b.example.com',
      default: true,
    });
    expect(rows.map((r) => Boolean(r.default))).toEqual([false, true, true]);
  });

  it('refuses with the codes the handler uses', () => {
    const rows: Domain[] = [
      { domain: 'p.example.com', app_id: 'app-1', verified: false },
      { ...verified('e.example.com'), environment: 'staging' },
    ];
    expect(mockSetDefaultDomain(rows, 'nope.example.com')).toEqual({
      status: 404,
      code: 'not_found',
    });
    expect(mockSetDefaultDomain(rows, 'p.example.com')).toEqual({
      status: 409,
      code: 'domain_not_verified',
    });
    expect(mockSetDefaultDomain(rows, 'e.example.com')).toEqual({
      status: 422,
      code: 'validation_failed',
    });
  });
});
