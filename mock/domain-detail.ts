import type { components } from '../src/lib/api/schema';

type Domain = components['schemas']['CustomDomainResponse'];

const DAY = 86_400_000;
/** Where the mock tells customers to point their CNAME. */
const EDGE = 'edge.gregale.dev';

/** The label the handler dials below a wildcard (faas state.WildcardProbeLabel). */
const PROBE_LABEL = 'gregale-wildcard-check';

/**
 * `GET /v1/domains/{domain}` over a list row. A verified domain reads as a
 * fresh 90-day certificate covering just itself, or for a wildcard the probe
 * host the handler dials; an unverified one is pending (faas handlers_ext.go
 * domainResponseWithCert). The records mirror customDomainDNSRecords: the TXT
 * proof while a token exists, then the CNAME.
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
    cert_sans: [d.domain.replace(/^\*/, PROBE_LABEL)],
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

type Refusal = { status: number; code: string; detail: string; extra?: Record<string, unknown> };

/**
 * Why `POST /v1/domains` refuses a wildcard or an environment, in createDomain's
 * order (faas handlers_ext.go): the `wildcard-domains` capability, then the
 * environment (400 outside a project or for a scope, 404 when the project has
 * no such environment), then the plan (402 below Pro). `environments` is the
 * app's project environments, or undefined when the app is in no project.
 */
export function mockDomainCreateRefusal(input: {
  domain: string;
  environment: string;
  plan: string;
  wildcardHidden: boolean;
  environments: string[] | undefined;
}): Refusal | null {
  const wildcard = input.domain.startsWith('*.');
  if (wildcard && input.wildcardHidden)
    return {
      status: 403,
      code: 'capability_not_released',
      detail:
        'domain.wildcard needs the Wildcard domains capability, which is not available to this account.',
    };
  const env = input.environment;
  if (env) {
    const scope = env === 'default' || env === 'pr-preview';
    if (scope || !/^[a-z0-9]([a-z0-9-]{0,31}[a-z0-9])?$/.test(env) || !input.environments)
      return {
        status: 400,
        code: 'validation_failed',
        detail: "environment must name an environment in the app's project",
      };
    if (!input.environments.includes(env))
      return {
        status: 404,
        code: 'not_found',
        detail: 'the app does not belong to the requested project environment',
      };
  }
  if (wildcard && input.plan !== 'pro' && input.plan !== 'scale')
    return {
      status: 402,
      code: 'wildcard_domains_not_allowed',
      detail: `the ${input.plan} plan does not include wildcard custom domains; upgrade to Pro or Scale.`,
    };
  return null;
}

/** faas api.CustomDomainTLSAllowedHostsMax. */
const HOSTS_MAX = 100;
const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** The 422 every hosts route answers for a domain that is not a wildcard (domainhosts.allowlistStore). */
export function mockHostsNotWildcard(domain: string): Refusal | null {
  return domain.startsWith('*.')
    ? null
    : {
        status: 422,
        code: 'validation_failed',
        detail: 'only a wildcard custom domain (*.example.com) has a host allowlist',
      };
}

/**
 * `PUT /v1/domains/{domain}/hosts`: the saved list, normalised as faas
 * state.NormalizeWildcardHostNames does (lower-cased, the suffix trimmed,
 * sorted, unique), or the refusal domainhosts.Replace answers.
 */
export function mockHostNames(domain: string, names: unknown): string[] | Refusal {
  const notWildcard = mockHostsNotWildcard(domain);
  if (notWildcard) return notWildcard;
  if (!Array.isArray(names) || names.length === 0)
    return {
      status: 400,
      code: 'validation_failed',
      detail: 'names must list at least one host; DELETE the allowlist to allow every name',
    };
  if (names.length > HOSTS_MAX)
    return {
      status: 422,
      code: 'validation_failed',
      detail: `a wildcard domain's host allowlist holds at most ${HOSTS_MAX} names; got ${names.length}.`,
      extra: { limit: HOSTS_MAX, observed: names.length },
    };
  const suffix = domain.slice(2);
  const out = new Set<string>();
  for (const raw of names) {
    const lower = String(raw).trim().toLowerCase();
    const name = lower.endsWith(`.${suffix}`) ? lower.slice(0, -(suffix.length + 1)) : lower;
    const host = `${name}.${suffix}`;
    if (
      !HOST_NAME.test(name) ||
      host.length > 253 ||
      host.split('.').some((label) => label.length > 63)
    )
      return {
        status: 422,
        code: 'validation_failed',
        detail: `"${name}" is not a name below ${domain}`,
      };
    out.add(name);
  }
  return [...out].sort();
}
