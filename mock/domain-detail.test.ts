import { describe, expect, it } from 'vitest';
import {
  mockDomainCreateRefusal,
  mockDomainDetail,
  mockHostNames,
  mockSetDefaultDomain,
} from './domain-detail';
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

  it('reads a wildcard through its probe host, as the handler dials it', () => {
    const d = mockDomainDetail(verified('*.example.com'));
    expect(d.cert_sans).toEqual(['gregale-wildcard-check.example.com']);
    expect(d.dns_records?.[0]?.name).toBe('_faas-verify.example.com');
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

describe('mockDomainCreateRefusal', () => {
  const create = (over: Partial<Parameters<typeof mockDomainCreateRefusal>[0]> = {}) =>
    mockDomainCreateRefusal({
      domain: 'shop.example.com',
      environment: '',
      plan: 'pro',
      wildcardHidden: false,
      environments: ['production', 'staging'],
      ...over,
    });

  it('lets a plain domain, a Pro wildcard and a known environment through', () => {
    expect(create()).toBeNull();
    expect(create({ domain: '*.example.com' })).toBeNull();
    expect(create({ environment: 'staging' })).toBeNull();
  });

  it('refuses a wildcard below Pro with 402, and an unreleased one with 403', () => {
    expect(create({ domain: '*.example.com', plan: 'hobby' })).toMatchObject({
      status: 402,
      code: 'wildcard_domains_not_allowed',
    });
    expect(create({ domain: '*.example.com', wildcardHidden: true })).toMatchObject({
      status: 403,
      code: 'capability_not_released',
    });
  });

  it('refuses an environment outside a project with 400 and an unknown one with 404', () => {
    expect(create({ environment: 'staging', environments: undefined })).toMatchObject({
      status: 400,
      code: 'validation_failed',
    });
    expect(create({ environment: 'pr-preview' })).toMatchObject({ status: 400 });
    expect(create({ environment: 'qa' })).toMatchObject({ status: 404, code: 'not_found' });
  });
});

describe('mockHostNames', () => {
  it('normalises names as the handler does: suffix trimmed, sorted, unique', () => {
    expect(mockHostNames('*.example.com', ['API', 'eu.shop.example.com', 'api'])).toEqual([
      'api',
      'eu.shop',
    ]);
  });

  it('refuses a non-wildcard, an empty list, a bad name and more than 100', () => {
    expect(mockHostNames('shop.example.com', ['a'])).toMatchObject({ status: 422 });
    expect(mockHostNames('*.example.com', [])).toMatchObject({ status: 400 });
    expect(mockHostNames('*.example.com', ['-bad'])).toMatchObject({
      status: 422,
      code: 'validation_failed',
    });
    const many = Array.from({ length: 101 }, (_, i) => `n${i}`);
    expect(mockHostNames('*.example.com', many)).toMatchObject({
      status: 422,
      extra: { limit: 100, observed: 101 },
    });
  });
});
