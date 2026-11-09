import { describe, expect, it } from 'vitest';
import {
  describeCertificate,
  describeCheck,
  describeDomain,
  parseTxtRecord,
  recordPurpose,
  routingRecords,
  summarizeDoctor,
  summarizeDomains,
  verificationRecord,
} from './domain-words';

const TXT = '_gregale-challenge.shop.example.com  TXT  "tok-123"';

describe('describeDomain', () => {
  it('reads an unverified domain with a challenge as waiting for its TXT record', () => {
    const w = describeDomain({ verified: false, txt_record: TXT }, { app: 'api' });
    expect(w).toMatchObject({ state: 'waiting', word: 'Waiting for DNS', step: 'publish' });
    expect(w.sentence).toBe(
      'Not live yet. Gregale is waiting to find its TXT record before it routes to api.'
    );
  });

  it('reads a 409 on retry, or a cleared challenge, as an expired verification', () => {
    expect(
      describeDomain({ verified: false, txt_record: TXT }, { app: 'api', expired: true })
    ).toMatchObject({ state: 'expired', word: 'Verification expired', step: 'renew' });
    // faas clears the token once the window closes, so nothing to publish means expired.
    expect(describeDomain({ verified: false, txt_record: null }, { app: 'api' }).state).toBe(
      'expired'
    );
  });

  it('keeps a structured TXT record as a live challenge', () => {
    const w = describeDomain(
      {
        verified: false,
        dns_records: [{ type: 'TXT', name: 'n', value: 'v', purpose: 'verification' }],
      },
      { app: 'api' }
    );
    expect(w.state).toBe('waiting');
  });

  it('reads drift ahead of verification, since drift clears it', () => {
    const w = describeDomain({ verified: false, cert_status: 'dns_drifted' }, { app: 'api' });
    expect(w).toMatchObject({ state: 'drifted', word: 'DNS changed', tone: 'critical' });
    expect(w.step).toBe('repoint');
  });

  it.each([
    ['issued', 'live', 'Live', 'Serving api over HTTPS.'],
    ['renewing', 'renewing', 'Live', 'Serving api over HTTPS. Its certificate is being renewed.'],
    ['failed', 'cert_failed', 'Certificate problem', expect.stringContaining('couldn’t be issued')],
    ['pending', 'issuing', 'Setting up HTTPS', expect.stringContaining('isn’t issued yet')],
    ['dial_failed:timeout', 'unreachable', 'Unreachable', expect.stringContaining('HTTPS')],
  ])('maps a verified domain with cert %s to %s', (cert, state, word, sentence) => {
    const w = describeDomain({ verified: true, cert_status: cert }, { app: 'api' });
    expect(w).toMatchObject({ state, word, sentence });
  });

  it('claims no HTTPS when the certificate state is not given', () => {
    const w = describeDomain({ verified: true }, { app: 'api' });
    expect(w).toMatchObject({ state: 'verified', word: 'Verified' });
    expect(w.sentence).toBe('Verified and routing to api.');
    expect(w.step).toBeUndefined();
  });

  it('names the environment an environment-bound domain routes to', () => {
    const w = describeDomain(
      { verified: true, cert_status: 'issued', environment: 'staging' },
      { app: 'api' }
    );
    expect(w.sentence).toBe('Serving api’s staging environment over HTTPS.');
  });

  it('keeps the exact state for a title', () => {
    expect(describeDomain({ verified: true, cert_status: 'issued' }, { app: 'a' }).term).toBe(
      'verified · issued'
    );
  });
});

describe('summarizeDomains', () => {
  it('leads with the live ones and names what is waiting', () => {
    expect(summarizeDomains(['live', 'live', 'waiting'])).toEqual({
      lead: '2 domains are live with HTTPS.',
      rest: '1 is waiting for a DNS record.',
    });
  });

  it('says nothing needs attention when nothing does', () => {
    expect(summarizeDomains(['live', 'renewing', 'live'])).toEqual({
      lead: 'All 3 domains are live with HTTPS.',
      rest: 'Nothing needs your attention.',
    });
    expect(summarizeDomains(['verified', 'verified']).lead).toBe(
      'Both domains are verified and routing traffic.'
    );
    expect(summarizeDomains(['issuing']).lead).toBe(
      'Your domain is getting its HTTPS certificate.'
    );
  });

  it('opens with the problem when nothing is live', () => {
    expect(summarizeDomains(['waiting', 'expired'])).toEqual({
      lead: '1 domain needs a new TXT record.',
      rest: '1 is waiting for a DNS record.',
    });
  });

  it('counts certificate problems and drift in plural', () => {
    expect(
      summarizeDomains(['live', 'cert_failed', 'unreachable', 'drifted', 'drifted']).rest
    ).toBe('2 no longer point at Gregale. 2 have a certificate problem.');
  });

  it('has a sentence for no domains', () => {
    expect(summarizeDomains([]).lead).toBe('No custom domains yet.');
  });
});

describe('DNS records', () => {
  it('splits the one-line TXT record into a name and a value', () => {
    expect(parseTxtRecord(TXT)).toMatchObject({
      type: 'TXT',
      name: '_gregale-challenge.shop.example.com',
      value: 'tok-123',
    });
  });

  it('keeps a line it cannot split whole, as the value', () => {
    expect(parseTxtRecord('gregale-verify=abc')).toMatchObject({
      name: null,
      value: 'gregale-verify=abc',
    });
  });

  it('prefers the structured verification record over the one-line form', () => {
    expect(
      verificationRecord({
        txt_record: TXT,
        dns_records: [{ type: 'TXT', name: '_faas-verify.x', value: 'v', purpose: 'verification' }],
      })
    ).toMatchObject({ name: '_faas-verify.x', value: 'v' });
    expect(verificationRecord({ txt_record: null })).toBeNull();
  });

  it('keeps apex alternatives apart from the CNAME, and says what each is for', () => {
    const { main, alternatives } = routingRecords({
      dns_records: [
        { type: 'CNAME', name: 'x', value: 'edge', purpose: 'routing' },
        { type: 'A', name: 'x', value: '203.0.113.7', purpose: 'routing', alternative: true },
        { type: 'TXT', name: 't', value: 'v', purpose: 'verification' },
      ],
    });
    expect(main.map((r) => r.type)).toEqual(['CNAME']);
    expect(alternatives.map((r) => r.type)).toEqual(['A']);
    expect(recordPurpose(alternatives[0])).toMatch(/instead of the CNAME at a zone apex/);
    expect(recordPurpose({ purpose: 'verification' })).toBe('Proves you own the domain');
  });
});

describe('describeCertificate', () => {
  it('separates a live dial failure and its reason', () => {
    expect(describeCertificate('dial_failed:routing_mismatch')).toMatchObject({
      word: 'Unreachable',
      reason: 'routing_mismatch',
    });
  });

  it('never calls an unreported state issued', () => {
    expect(describeCertificate(undefined).word).toBe('Not reported');
    expect(describeCertificate('issued').word).toBe('Issued');
  });
});

describe('doctor', () => {
  it('turns each check code into a sentence', () => {
    expect(describeCheck({ name: 'caa_permits', status: 'fail', detail: 'x' })).toMatchObject({
      label: 'Certificate authority allowed',
      word: 'Needs a fix',
      sentence: 'A CAA record in its DNS doesn’t allow the certificate authority Gregale uses.',
    });
    expect(describeCheck({ name: 'ipv6_conflict', status: 'ok', detail: 'x' }).sentence).toBe(
      'No IPv6 record gets in the way.'
    );
    expect(describeCheck({ name: 'dns_record', status: 'na', detail: 'x' }).sentence).toBe(
      'Doesn’t apply to this domain.'
    );
  });

  it('falls back to the API detail for a check it does not know', () => {
    expect(
      describeCheck({ name: 'new_check' as never, status: 'fail', detail: 'API words' })
    ).toMatchObject({ label: 'new_check', sentence: 'API words' });
  });

  it('leads with the first failure, then counts the rest', () => {
    expect(
      summarizeDoctor({
        checks: [
          { name: 'dns_record', status: 'ok', detail: '', checked_at: '' },
          { name: 'points_to_gregale', status: 'fail', detail: '', checked_at: '' },
          { name: 'ipv6_conflict', status: 'fail', detail: '', checked_at: '' },
        ],
      } as never)
    ).toMatchObject({
      lead: 'It points somewhere else, so its traffic doesn’t reach Gregale.',
      rest: '1 more check needs a fix.',
      tone: 'critical',
    });
  });

  it('separates unconfirmed from passing', () => {
    expect(
      summarizeDoctor({
        checks: [{ name: 'tls_certificate', status: 'pending', detail: '' }],
      } as never)
    ).toMatchObject({
      lead: 'Nothing is wrong so far.',
      rest: '1 check couldn’t be confirmed yet.',
    });
    expect(
      summarizeDoctor({ checks: [{ name: 'dns_record', status: 'ok', detail: '' }] } as never).lead
    ).toBe('Everything checks out.');
  });
});
