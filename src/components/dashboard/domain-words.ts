import type { components } from '@/lib/api/schema';

type Domain = components['schemas']['CustomDomainResponse'];
type DnsRecord = components['schemas']['DNSRecordInstruction'];
type Check = components['schemas']['DomainDoctorCheck'];
type Report = components['schemas']['DomainDoctorReport'];

/**
 * Custom domains in plain words (docs/console-plain-english.md): one status
 * word, one sentence saying what it means for the app, and the one step that
 * fixes it when something is needed. Every sentence is built from fields the
 * API returns; the exact state stays in `term`, for a `title`.
 *
 * Semantics, read from faas pkg/apid/apidserver:
 * - `verified` is the TXT ownership proof (dns_verify.go). Until it holds,
 *   the gateway does not route the hostname.
 * - An expired challenge has its token cleared (handlers_ext.go
 *   domainResponse), so an unverified domain with no TXT record to publish is
 *   an expired one. The retry endpoint's 409 says the same for a list read
 *   before the window closed.
 * - `dns_drifted` clears the verification at the same moment (state
 *   CustomDomainCertDNSDrifted): routing stops until the domain points back
 *   and the TXT record is published again.
 * - `cert_status` is the durable TLS state the DNS poller mirrors (pending,
 *   issued, renewing, failed, dns_drifted); only the detail read may answer a
 *   live `dial_failed:<reason>`.
 */

export type DomainTone = 'good' | 'warning' | 'critical' | 'muted';

export const DOMAIN_TONE: Record<DomainTone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  muted: 'var(--chart-muted)',
};

export type DomainState =
  | 'live'
  | 'renewing'
  | 'verified'
  | 'issuing'
  | 'waiting'
  | 'expired'
  | 'drifted'
  | 'cert_failed'
  | 'unreachable';

/** The one thing to do: publish the TXT record, get a new one, point it back, or find out why. */
export type DomainStep = 'publish' | 'renew' | 'repoint' | 'diagnose';

export interface DomainWords {
  state: DomainState;
  /** One word for the state, with a dot. */
  word: string;
  tone: DomainTone;
  /** One plain sentence: the state and what it means for the app. */
  sentence: string;
  /** The exact API state, kept for whoever searches for it. */
  term: string;
  step?: DomainStep;
}

type Described = Pick<
  Domain,
  'verified' | 'cert_status' | 'txt_record' | 'dns_records' | 'environment'
>;

/** True when the API still hands out a TXT value to publish. */
export function hasChallenge(d: Pick<Domain, 'txt_record' | 'dns_records'>): boolean {
  return (
    Boolean(d.txt_record) ||
    (d.dns_records ?? []).some((r) => r.type === 'TXT' && r.purpose === 'verification')
  );
}

export function describeDomain(
  d: Described,
  ctx: {
    /** The app's slug, as people know it. */
    app: string;
    /** The retry endpoint answered 409 for a domain that is still unverified. */
    expired?: boolean;
  }
): DomainWords {
  const cert = d.cert_status ?? undefined;
  const target = d.environment ? `${ctx.app}’s ${d.environment} environment` : ctx.app;
  const term = `${d.verified ? 'verified' : 'unverified'}${cert ? ` · ${cert}` : ''}`;

  if (cert === 'dns_drifted')
    return {
      state: 'drifted',
      word: 'DNS changed',
      tone: 'critical',
      sentence: `It no longer points at Gregale, so its traffic has stopped reaching ${target}.`,
      term,
      step: 'repoint',
    };

  if (!d.verified) {
    if (ctx.expired || !hasChallenge(d))
      return {
        state: 'expired',
        word: 'Verification expired',
        tone: 'warning',
        sentence:
          'Not live. This verification expired: its TXT record wasn’t found in time, so the old value no longer counts.',
        term: `${term} · challenge expired`,
        step: 'renew',
      };
    return {
      state: 'waiting',
      word: 'Waiting for DNS',
      tone: 'warning',
      sentence: `Not live yet. Gregale is waiting to find its TXT record before it routes to ${target}.`,
      term,
      step: 'publish',
    };
  }

  if (cert?.startsWith('dial_failed:'))
    return {
      state: 'unreachable',
      word: 'Unreachable',
      tone: 'critical',
      sentence: 'Gregale couldn’t reach it over HTTPS just now.',
      term,
      step: 'diagnose',
    };
  switch (cert) {
    case 'failed':
      return {
        state: 'cert_failed',
        word: 'Certificate problem',
        tone: 'critical',
        sentence: `Routing to ${target}, but its HTTPS certificate couldn’t be issued or renewed.`,
        term,
        step: 'diagnose',
      };
    case 'issued':
      return {
        state: 'live',
        word: 'Live',
        tone: 'good',
        sentence: `Serving ${target} over HTTPS.`,
        term,
      };
    case 'renewing':
      return {
        state: 'renewing',
        word: 'Live',
        tone: 'good',
        sentence: `Serving ${target} over HTTPS. Its certificate is being renewed.`,
        term,
      };
    case 'pending':
      return {
        state: 'issuing',
        word: 'Setting up HTTPS',
        tone: 'muted',
        sentence: `Verified and routing to ${target}. Its HTTPS certificate isn’t issued yet; Gregale gets one on its own.`,
        term,
      };
    default:
      // The list answered no certificate state: say only what is known.
      return {
        state: 'verified',
        word: 'Verified',
        tone: 'good',
        sentence: `Verified and routing to ${target}.`,
        term,
      };
  }
}

/** Singular and plural predicates, in the order the summary reads them. */
const GROUPS: { states: DomainState[]; one: string; many: string; attention: boolean }[] = [
  {
    states: ['live', 'renewing'],
    one: 'is live with HTTPS',
    many: 'are live with HTTPS',
    attention: false,
  },
  {
    states: ['verified'],
    one: 'is verified and routing traffic',
    many: 'are verified and routing traffic',
    attention: false,
  },
  {
    states: ['issuing'],
    one: 'is getting its HTTPS certificate',
    many: 'are getting their HTTPS certificates',
    attention: false,
  },
  {
    states: ['drifted'],
    one: 'no longer points at Gregale',
    many: 'no longer point at Gregale',
    attention: true,
  },
  {
    states: ['cert_failed', 'unreachable'],
    one: 'has a certificate problem',
    many: 'have a certificate problem',
    attention: true,
  },
  {
    states: ['expired'],
    one: 'needs a new TXT record',
    many: 'need a new TXT record',
    attention: true,
  },
  {
    states: ['waiting'],
    one: 'is waiting for a DNS record',
    many: 'are waiting for a DNS record',
    attention: true,
  },
];

/**
 * The page's answer: "2 domains are live with HTTPS." then "1 is waiting for
 * a DNS record.", or "Nothing needs your attention." when nothing does.
 */
export function summarizeDomains(states: DomainState[]): { lead: string; rest: string } {
  const total = states.length;
  if (total === 0)
    return { lead: 'No custom domains yet.', rest: 'Add one to serve an app at your own address.' };
  const sentences: string[] = [];
  let attention = false;
  for (const group of GROUPS) {
    const n = states.filter((s) => group.states.includes(s)).length;
    if (n === 0) continue;
    attention ||= group.attention;
    const predicate = n === 1 ? group.one : group.many;
    if (sentences.length > 0) {
      sentences.push(`${n} ${predicate}.`);
      continue;
    }
    const subject =
      n === total
        ? total === 1
          ? 'Your domain'
          : total === 2
            ? 'Both domains'
            : `All ${total} domains`
        : `${n} ${n === 1 ? 'domain' : 'domains'}`;
    sentences.push(`${subject} ${predicate}.`);
  }
  const [lead, ...rest] = sentences;
  if (!attention) rest.push('Nothing needs your attention.');
  return { lead, rest: rest.join(' ') };
}

/* ------------------------------------------------------------------ *
 * DNS records
 * ------------------------------------------------------------------ */

export interface RecordRow {
  type: string;
  /** Null when the API's TXT line could not be split into a name and a value. */
  name: string | null;
  value: string;
  purpose?: DnsRecord['purpose'];
  alternative?: boolean;
}

/**
 * Split the list's one-line TXT record (`<name>  TXT  "<value>"`, faas
 * domainResponse) into the two fields a DNS provider asks for. A line that does
 * not have that shape is kept whole as the value, never guessed at.
 */
export function parseTxtRecord(line: string): RecordRow {
  const match = /^(\S+)\s+TXT\s+"?([^"]*)"?\s*$/i.exec(line.trim());
  if (!match) return { type: 'TXT', name: null, value: line, purpose: 'verification' };
  return { type: 'TXT', name: match[1], value: match[2], purpose: 'verification' };
}

/** The ownership proof to publish, from the structured records when the API sent them. */
export function verificationRecord(
  d: Pick<Domain, 'txt_record' | 'dns_records'>
): RecordRow | null {
  const structured = (d.dns_records ?? []).find(
    (r) => r.type === 'TXT' && r.purpose === 'verification'
  );
  if (structured) return { ...structured };
  return d.txt_record ? parseTxtRecord(d.txt_record) : null;
}

/** Records that send traffic here: the CNAME first, the apex A/AAAA alternatives apart. */
export function routingRecords(d: Pick<Domain, 'dns_records'>): {
  main: RecordRow[];
  alternatives: RecordRow[];
} {
  const routing = (d.dns_records ?? []).filter((r) => r.purpose === 'routing');
  return {
    main: routing.filter((r) => !r.alternative),
    alternatives: routing.filter((r) => r.alternative),
  };
}

/** What a record is for, in the words a DNS provider's form would make sense of. */
export function recordPurpose(record: Pick<RecordRow, 'purpose' | 'alternative'>): string {
  if (record.purpose === 'verification') return 'Proves you own the domain';
  if (record.alternative) return 'Sends traffic here, instead of the CNAME at a zone apex';
  return 'Sends traffic to Gregale';
}

/* ------------------------------------------------------------------ *
 * Certificate (the detail's live read)
 * ------------------------------------------------------------------ */

/** The certificate on its own, for the detail: a word, a tone and a sentence. */
export function describeCertificate(status: string | null | undefined): {
  word: string;
  tone: DomainTone;
  sentence: string;
  /** The reason token after `dial_failed:`. */
  reason?: string;
} {
  if (status?.startsWith('dial_failed:'))
    return {
      word: 'Unreachable',
      tone: 'critical',
      sentence: 'Gregale couldn’t reach the domain over HTTPS to read its certificate.',
      reason: status.slice('dial_failed:'.length),
    };
  switch (status) {
    case 'issued':
      return { word: 'Issued', tone: 'good', sentence: 'HTTPS works with a valid certificate.' };
    case 'renewing':
      return {
        word: 'Renewing',
        tone: 'good',
        sentence: 'HTTPS works; the certificate is being renewed.',
      };
    case 'failed':
      return {
        word: 'Failed',
        tone: 'critical',
        sentence: 'The last attempt to issue or renew the certificate failed.',
      };
    case 'dns_drifted':
      return {
        word: 'DNS changed',
        tone: 'critical',
        sentence: 'The domain stopped pointing at Gregale, so no certificate is served.',
      };
    case 'pending':
      return {
        word: 'Not issued yet',
        tone: 'muted',
        sentence: 'No certificate yet. Gregale requests one once the domain verifies.',
      };
    default:
      return { word: 'Not reported', tone: 'muted', sentence: 'No certificate state was given.' };
  }
}

/* ------------------------------------------------------------------ *
 * Domain doctor
 * ------------------------------------------------------------------ */

/** Each doctor check, named for people (the API token stays in the tip). */
export const CHECK_LABEL: Record<string, string> = {
  dns_record: 'DNS record',
  points_to_gregale: 'Points to Gregale',
  tls_certificate: 'HTTPS certificate',
  caa_permits: 'Certificate authority allowed',
  ipv6_conflict: 'IPv6 record',
};

/** What each check looks at, for its "?" tip. */
export const CHECK_ABOUT: Record<string, string> = {
  dns_record: 'Whether any DNS record answers for the hostname at all.',
  points_to_gregale: 'Whether its CNAME, or its A and AAAA records, lead to Gregale.',
  tls_certificate: 'Whether a valid HTTPS certificate is served for it.',
  caa_permits:
    'CAA records list which certificate authorities may issue certificates for a domain. With none, any may.',
  ipv6_conflict:
    'An IPv6 (AAAA) record that does not lead to Gregale can send some visitors somewhere else.',
};

const CHECK_WORD: Record<string, { word: string; tone: DomainTone }> = {
  ok: { word: 'OK', tone: 'good' },
  fail: { word: 'Needs a fix', tone: 'critical' },
  pending: { word: 'Not confirmed', tone: 'warning' },
  na: { word: 'Doesn’t apply', tone: 'muted' },
};

/** What each check found, per status (faas handlers_ext.go doctorReportFromObs, dns_probes.go). */
const CHECK_SENTENCE: Record<string, Partial<Record<Check['status'], string>>> = {
  dns_record: {
    ok: 'The domain resolves in DNS.',
    fail: 'No DNS record answers for this domain yet.',
    pending: 'DNS couldn’t be checked just now.',
  },
  points_to_gregale: {
    ok: 'It points at Gregale.',
    fail: 'It points somewhere else, so its traffic doesn’t reach Gregale.',
    pending: 'Where it points couldn’t be confirmed yet.',
  },
  tls_certificate: {
    ok: 'Its HTTPS certificate is issued.',
    fail: 'Its HTTPS certificate has a problem.',
    pending: 'Its HTTPS certificate isn’t issued yet.',
  },
  caa_permits: {
    ok: 'Nothing in its DNS stops a certificate being issued.',
    fail: 'A CAA record in its DNS doesn’t allow the certificate authority Gregale uses.',
    pending: 'Whether its CAA records allow a certificate couldn’t be confirmed.',
  },
  ipv6_conflict: {
    ok: 'No IPv6 record gets in the way.',
    fail: 'An IPv6 (AAAA) record conflicts with the record that points here.',
    pending: 'Its IPv6 records couldn’t be checked.',
  },
};

export function describeCheck(check: Pick<Check, 'name' | 'status' | 'detail'>): {
  label: string;
  word: string;
  tone: DomainTone;
  sentence: string;
} {
  const mark = CHECK_WORD[check.status] ?? { word: check.status, tone: 'muted' as const };
  const sentence =
    check.status === 'na'
      ? 'Doesn’t apply to this domain.'
      : (CHECK_SENTENCE[check.name]?.[check.status] ?? check.detail);
  return { label: CHECK_LABEL[check.name] ?? check.name, ...mark, sentence };
}

/** The doctor's answer: the first thing to fix, or that nothing is wrong. */
export function summarizeDoctor(report: Pick<Report, 'checks'>): {
  lead: string;
  rest: string;
  tone: DomainTone;
} {
  const fails = report.checks.filter((c) => c.status === 'fail');
  const pending = report.checks.filter((c) => c.status === 'pending');
  if (fails.length > 0) {
    const more = fails.length - 1;
    return {
      lead: describeCheck(fails[0]).sentence,
      rest:
        more > 0
          ? `${more} more ${more === 1 ? 'check needs' : 'checks need'} a fix.`
          : 'The fix is shown below.',
      tone: 'critical',
    };
  }
  if (pending.length > 0)
    return {
      lead: 'Nothing is wrong so far.',
      rest: `${pending.length} ${pending.length === 1 ? 'check' : 'checks'} couldn’t be confirmed yet.`,
      tone: 'warning',
    };
  return { lead: 'Everything checks out.', rest: '', tone: 'good' };
}
