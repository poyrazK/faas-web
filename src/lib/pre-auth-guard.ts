import type { components } from '@/lib/api/schema';

/**
 * The pre-auth guard: an app's per-source limit that runs after hostname
 * routing and before consumer-key lookup, JWT verification, body admission
 * or a wake (faas docs/security.md §Optional pre-auth source limit,
 * ADR-829). It is one manifest field, `pre_auth_rate_limit`, read from
 * `GET /v1/apps/{slug}` (`manifest`) and replaced whole by
 * `PATCH /v1/apps/{slug}` (faas pkg/apid/apidserver/lifecycle.go:325).
 *
 * The rules below are apid's own (faas pkg/api/appmanifest.go:459-546), so a
 * draft the form accepts is one apid accepts — except the plan ceiling: the
 * rate and burst must not exceed the plan's request rate, which only apid
 * knows, and its 400 `validation_failed` says so.
 */

export type PreAuthConfig = components['schemas']['PreAuthRateLimitConfig'];
export type PreAuthMode = PreAuthConfig['mode'];
type Route = components['schemas']['PreAuthRouteLimit'];
export type PreAuthMethod = Route['method'];
export type Coordination = 'local' | 'central';

export const PRE_AUTH_METHODS: readonly PreAuthMethod[] = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];
export const PRE_AUTH_MAX_ROUTES = 16;
// The schema's bounds; the plan's ceiling is lower everywhere but Scale.
const MAX_RPS = 500;
const MAX_BURST = 2000;
const MAX_STATUSES = 4;

/** One route override as the form edits it: numbers may be blank mid-edit. */
export interface RouteDraft {
  method: PreAuthMethod;
  path: string;
  requests_per_second?: number;
  burst?: number;
  coordination: Coordination;
  /** Whether a failed-response budget is set. */
  failed: boolean;
  failures_per_minute?: number;
  failed_burst?: number;
  /** Counted statuses as typed; empty means apid's default, 401 and 403. */
  statuses: string[];
  failed_coordination: Coordination;
  observe_targets: boolean;
}

export interface PreAuthDraft {
  mode: PreAuthMode;
  requests_per_second?: number;
  burst?: number;
  routes: RouteDraft[];
}

export function emptyRoute(rate: { rps?: number; burst?: number }): RouteDraft {
  return {
    method: 'POST',
    path: '/login',
    requests_per_second: rate.rps,
    burst: rate.burst,
    coordination: 'local',
    failed: false,
    statuses: [],
    failed_coordination: 'local',
    observe_targets: false,
  };
}

/**
 * The form's starting point. An app created before ADR-829 has no stored
 * guard and is off until one is set; it starts from the default rate, so
 * picking observe is one click.
 */
export function preAuthDraft(
  config: PreAuthConfig | null | undefined,
  fallback: { rps: number; burst: number }
): PreAuthDraft {
  if (!config) return { mode: 'off', ...rate(fallback), routes: [] };
  return {
    mode: config.mode,
    requests_per_second: config.requests_per_second ?? fallback.rps,
    burst: config.burst ?? fallback.burst,
    routes: (config.routes ?? []).map((r) => ({
      method: r.method,
      path: r.path,
      requests_per_second: r.requests_per_second,
      burst: r.burst,
      coordination: r.coordination ?? 'local',
      failed: Boolean(r.failed_responses),
      failures_per_minute: r.failed_responses?.failures_per_minute,
      failed_burst: r.failed_responses?.burst,
      statuses: (r.failed_responses?.statuses ?? []).map(String),
      failed_coordination: r.failed_responses?.coordination ?? 'local',
      observe_targets: r.observe_targets ?? false,
    })),
  };
}

const rate = (r: { rps: number; burst: number }) => ({
  requests_per_second: r.rps,
  burst: r.burst,
});

/**
 * The value PATCH sends. apid replaces the whole config, so the routes are
 * always sent; switching off keeps the rate and routes, as
 * `gregale app --pre-auth off` does (faas cmd/gregale/app_pre_auth.go:17),
 * so switching back on restores them. Local coordination is the default and
 * is left out.
 */
export function preAuthConfig(draft: PreAuthDraft): PreAuthConfig {
  const out: PreAuthConfig = { mode: draft.mode };
  if (draft.requests_per_second !== undefined) out.requests_per_second = draft.requests_per_second;
  if (draft.burst !== undefined) out.burst = draft.burst;
  if (draft.routes.length)
    out.routes = draft.routes.map((r) => ({
      method: r.method,
      path: r.path.trim(),
      requests_per_second: r.requests_per_second ?? 0,
      burst: r.burst ?? 0,
      ...(r.coordination === 'central' ? { coordination: 'central' as const } : {}),
      ...(r.failed
        ? {
            failed_responses: {
              failures_per_minute: r.failures_per_minute ?? 0,
              burst: r.failed_burst ?? 0,
              ...(r.statuses.length ? { statuses: r.statuses.map(Number) } : {}),
              ...(r.failed_coordination === 'central' ? { coordination: 'central' as const } : {}),
            },
          }
        : {}),
      ...(r.observe_targets ? { observe_targets: true } : {}),
    }));
  return out;
}

const canonical = (c: PreAuthConfig | null | undefined) =>
  JSON.stringify(c ? preAuthConfig(preAuthDraft(c, { rps: 0, burst: 0 })) : null);

/**
 * Whether the draft would store what is stored now. No stored guard and an
 * off draft are the same guard: the gateway runs neither.
 */
export function samePreAuth(stored: PreAuthConfig | null | undefined, draft: PreAuthDraft) {
  if (!stored) return draft.mode === 'off';
  return canonical(stored) === JSON.stringify(preAuthConfig(draft));
}

const whole = (n: number | undefined, min: number, max: number) =>
  n !== undefined && Number.isInteger(n) && n >= min && n <= max;

/** apid's `path.Clean(p) == p` for an absolute path: no empty, `.` or `..` segment, no trailing slash. */
function canonicalPath(p: string) {
  if (!p.startsWith('/') || p.length > 256 || /[?#%\\\r\n\t]/.test(p)) return false;
  if (p === '/') return true;
  return p
    .slice(1)
    .split('/')
    .every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/**
 * Field errors keyed by what the form shows them on. Off is not checked:
 * apid stores an off guard without validating it (appmanifest.go:464).
 */
export function validatePreAuth(d: PreAuthDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (d.mode === 'off') return errors;
  if (!whole(d.requests_per_second, 1, MAX_RPS))
    errors.requests_per_second = `A whole number from 1 to ${MAX_RPS}, and no more than your plan's request rate.`;
  if (!whole(d.burst, 1, MAX_BURST))
    errors.burst = `A whole number from 1 to ${MAX_BURST}, and no more than your plan's burst.`;
  if (d.routes.length > PRE_AUTH_MAX_ROUTES)
    errors.routes = `At most ${PRE_AUTH_MAX_ROUTES} route overrides.`;
  const appRps = d.requests_per_second ?? 0;
  const appBurst = d.burst ?? 0;
  d.routes.forEach((r, i) => {
    const at = (field: string) => `routes.${i}.${field}`;
    const path = r.path.trim();
    if (!canonicalPath(path))
      errors[at('path')] =
        'An exact path such as /login: starts with /, no trailing slash, query, %-encoding, // or . segments.';
    else if (d.routes.slice(0, i).some((p) => p.method === r.method && p.path.trim() === path))
      errors[at('path')] = `${r.method} ${path} already has an override.`;
    if (!whole(r.requests_per_second, 1, MAX_RPS) || (r.requests_per_second ?? 0) > appRps)
      errors[at('requests_per_second')] = `From 1 to the app-wide ${appRps || '—'}.`;
    if (!whole(r.burst, 1, MAX_BURST) || (r.burst ?? 0) > appBurst)
      errors[at('burst')] = `From 1 to the app-wide ${appBurst || '—'}.`;
    if (r.failed) {
      const perMinute = (r.requests_per_second ?? 0) * 60;
      if (!whole(r.failures_per_minute, 1, 30000) || (r.failures_per_minute ?? 0) > perMinute)
        errors[at('failures_per_minute')] =
          `From 1 to ${perMinute || '—'}, the route's rate a minute.`;
      if (!whole(r.failed_burst, 1, MAX_BURST) || (r.failed_burst ?? 0) > (r.burst ?? 0))
        errors[at('failed_burst')] = `From 1 to the route's burst, ${r.burst ?? '—'}.`;
      const codes = r.statuses.map((s) => Number(s.trim()));
      if (codes.length > MAX_STATUSES) errors[at('statuses')] = `At most ${MAX_STATUSES} statuses.`;
      else if (codes.some((c) => !Number.isInteger(c) || c < 400 || c > 499 || c === 429))
        errors[at('statuses')] = '4xx statuses only, and not 429.';
      else if (new Set(codes).size !== codes.length) errors[at('statuses')] = 'Each status once.';
    }
    if (r.observe_targets && (r.method !== 'POST' || !r.failed || r.coordination !== 'central'))
      errors[at('observe_targets')] =
        'Needs a POST route with a failed-response budget and central coordination.';
  });
  return errors;
}

const MODE_LABEL: Record<PreAuthMode, string> = {
  off: 'Off',
  observe: 'Observe',
  enforce: 'Enforce',
};

/** One line, as `gregale app <slug>` prints it (faas cmd/gregale/app_pre_auth.go:66). */
export function preAuthSummary(config: PreAuthConfig | null | undefined): string {
  if (!config || config.mode === 'off') return 'Off';
  const n = config.routes?.length ?? 0;
  return `${MODE_LABEL[config.mode]} · ${config.requests_per_second} rps, burst ${config.burst} per source${
    n ? ` · ${n} route override${n === 1 ? '' : 's'}` : ''
  }`;
}

/**
 * What enforce does, said before it is switched on: the responses are
 * docs/security.md's (429 with Retry-After: 1 and the scope header), and the
 * NAT caveat is why the docs say to observe first.
 */
export function enforceEffect(config: PreAuthConfig): string {
  const n = config.routes?.length ?? 0;
  const failures = config.routes?.some((r) => r.failed_responses) ?? false;
  return [
    `Each client address over ${config.requests_per_second} requests a second (burst ${config.burst}) gets 429 with Retry-After: 1, before credentials are checked or the app wakes.`,
    n
      ? `${n} route override${n === 1 ? '' : 's'} also refuse${n === 1 ? 's' : ''} at ${n === 1 ? 'its' : 'their'} own stricter limit${failures ? ', and a client that spends a failed-response budget is refused until it refills' : ''}.`
      : '',
    'Clients behind one shared NAT address share a bucket.',
  ]
    .filter(Boolean)
    .join(' ');
}
