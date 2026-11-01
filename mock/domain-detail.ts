import type { components } from '../src/lib/api/schema';

type Domain = components['schemas']['CustomDomainResponse'];

const DAY = 86_400_000;
/** Where the mock tells customers to point their CNAME. */
const EDGE = 'edge.gregale.dev';

/**
 * `GET /v1/domains/{domain}` over a list row. A verified domain reads as a
 * fresh 90-day certificate covering just itself; an unverified one is pending
 * (faas handlers_ext.go domainResponseWithCert). The records mirror
 * customDomainDNSRecords: the TXT proof while a token exists, then the CNAME.
 */
export function mockDomainDetail(d: Domain): Domain {
  const records: NonNullable<Domain['dns_records']> = [];
  if (d.challenge_token)
    records.push({
      type: 'TXT',
      name: `_faas-verify.${d.domain.replace(/^\*\./, '')}`,
      value: d.challenge_token,
      purpose: 'verification',
    });
  records.push({ type: 'CNAME', name: d.domain, value: EDGE, purpose: 'routing' });
  if (!d.verified) return { ...d, cert_status: 'pending', dns_records: records };
  const issued = Date.parse(d.verified_at ?? '') || Date.now();
  const notAfter = new Date(issued + 90 * DAY).toISOString();
  return {
    ...d,
    cert_status: 'issued',
    cert_not_after: notAfter,
    cert_expires_at: notAfter,
    cert_sans: [d.domain],
    dns_last_checked_at: new Date().toISOString(),
    dns_records: records,
  };
}

/**
 * `POST /v1/domains/{domain}/default`: moves the app's single default pointer,
 * refusing in the handler's order (unverified 409, environment-bound or
 * wildcard 422). Mutates the rows so the list shows the move.
 */
export function mockSetDefaultDomain(
  rows: Domain[],
  domain: string
): Domain | { status: number; code: string } {
  const d = rows.find((r) => r.domain === domain);
  if (!d) return { status: 404, code: 'not_found' };
  if (!d.verified) return { status: 409, code: 'domain_not_verified' };
  if (d.environment || d.domain.startsWith('*.')) return { status: 422, code: 'validation_failed' };
  for (const r of rows) if (r.app_id === d.app_id) r.default = r === d;
  return d;
}
