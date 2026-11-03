import type { components } from '../src/lib/api/schema';

type S = components['schemas'];
type Config = S['PreAuthRateLimitConfig'];
type Policy = S['PreAuthPolicyObservation'];

/**
 * The pre-auth guard for the dev mock: apid's validation of
 * `pre_auth_rate_limit` (faas pkg/api/appmanifest.go:459-546) with the plan
 * ceilings from pkg/api/limits.go (RateLimitRPS / RateLimitBurst), and the
 * observation policies a stored guard yields (handlers_pre_auth_observations.go:44).
 */

const PLAN_RATE: Record<string, { rps: number; burst: number }> = {
  free: { rps: 5, burst: 20 },
  hobby: { rps: 20, burst: 100 },
  pro: { rps: 100, burst: 500 },
  scale: { rps: 500, burst: 2000 },
};
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

const cleanPath = (p: string) =>
  p === '/' ||
  (p.startsWith('/') &&
    p
      .slice(1)
      .split('/')
      .every((s) => s && s !== '.' && s !== '..'));

/** apid's refusal sentence for a config, or undefined when it would be stored. */
export function refusal(raw: unknown, plan: string): string | undefined {
  if (!raw || typeof raw !== 'object') return 'pre_auth_rate_limit must be an object';
  const c = raw as Config;
  if (c.mode === 'off') return undefined;
  if (c.mode !== 'observe' && c.mode !== 'enforce')
    return 'pre_auth_rate_limit.mode must be off, observe, or enforce';
  const limits = PLAN_RATE[plan] ?? PLAN_RATE.pro;
  const rps = c.requests_per_second ?? 0;
  const burst = c.burst ?? 0;
  if (rps < 1 || rps > limits.rps || burst < 1 || burst > limits.burst)
    return `pre_auth_rate_limit requests_per_second must be 1..${limits.rps} and burst must be 1..${limits.burst}`;
  const routes = c.routes ?? [];
  if (routes.length > 16) return 'pre_auth_rate_limit.routes allows at most 16 entries';
  for (const [i, r] of routes.entries()) {
    const where = `${r.method} ${r.path}`;
    if (!METHODS.includes(r.method))
      return `pre_auth_rate_limit.routes method "${r.method}" is unsupported`;
    if (!r.path || r.path.length > 256 || /[?#%\\\r\n\t]/.test(r.path) || !cleanPath(r.path))
      return `pre_auth_rate_limit.routes path "${r.path}" must be a canonical absolute path of at most 256 bytes`;
    if (routes.slice(0, i).some((p) => p.method === r.method && p.path === r.path))
      return `pre_auth_rate_limit.routes has duplicate ${where}`;
    if (r.requests_per_second < 1 || r.requests_per_second > rps || r.burst < 1 || r.burst > burst)
      return `pre_auth_rate_limit.routes ${where} must not exceed the app-wide rate and burst`;
    const f = r.failed_responses;
    if (f) {
      if (
        f.failures_per_minute < 1 ||
        f.failures_per_minute > r.requests_per_second * 60 ||
        f.burst < 1 ||
        f.burst > r.burst
      )
        return `pre_auth_rate_limit.routes ${where} failed_responses exceeds the route rate or burst`;
      const statuses = f.statuses ?? [];
      if (statuses.length > 4)
        return `pre_auth_rate_limit.routes ${where} failed_responses allows at most four statuses`;
      const bad = statuses.find(
        (s, j) => s < 400 || s > 499 || s === 429 || statuses.indexOf(s) !== j
      );
      if (bad !== undefined)
        return `pre_auth_rate_limit.routes ${where} failed_responses status ${bad} is unsupported`;
    }
    if (r.observe_targets && (r.method !== 'POST' || !f || r.coordination !== 'central'))
      return `pre_auth_rate_limit.routes ${where} observe_targets requires POST, failed_responses, and central coordination`;
  }
  return undefined;
}

/**
 * One policy slot per configured app, route, failed-response and target
 * policy, with counts that scale with the range (`n`). An off or absent guard
 * has no policies, which the console reads as "no guard is on".
 */
export function policies(config: Config | undefined, n: (v: number) => number): Policy[] {
  if (!config || config.mode === 'off') return [];
  const zero = { result_3xx: 0, result_5xx: 0, result_unknown: 0 };
  const out: Policy[] = [
    {
      policy_id: 'app',
      kind: 'app',
      would_block: n(37),
      result_2xx: n(2),
      result_4xx: n(31),
      ...zero,
      result_5xx: n(4),
    },
  ];
  (config.routes ?? []).forEach((r, i) => {
    const at = { method: r.method, path: r.path };
    out.push({
      policy_id: `route_${i}`,
      kind: 'route',
      ...at,
      would_block: n(12),
      result_2xx: 0,
      result_4xx: n(12),
      ...zero,
    });
    if (r.failed_responses)
      out.push({
        policy_id: `failures_${i}`,
        kind: 'failures',
        ...at,
        would_block: n(3),
        result_2xx: 0,
        result_4xx: n(3),
        ...zero,
      });
    if (r.observe_targets)
      out.push({
        policy_id: `targets_${i}`,
        kind: 'targets',
        ...at,
        would_block: 0,
        result_2xx: 0,
        result_4xx: 0,
        ...zero,
        target_failures: n(9),
        target_threshold: n(1),
        target_missing: 0,
        target_invalid: 0,
        target_fallback: 0,
      });
  });
  return out;
}
