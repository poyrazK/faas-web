import type { App } from './data';

/**
 * The restart contract on `PATCH /v1/apps/{slug}`: restart_policy,
 * max_retries, startup_deadline_s, stop_signal and stop_grace_period_s.
 *
 * Mirrors apid: an empty or zero value inherits the default (lifecycle.go:239
 * merge), the per-plan caps are ValidatePlan's (appmanifest.go:885-958), and
 * a refusal is 400 validation_failed (lifecycle.go:63). The grace period is
 * stored as time.Duration and so reads back as nanoseconds.
 */

const CAPS: Record<string, { grace: number; startup: number; retries: number }> = {
  free: { grace: 15, startup: 15, retries: 3 },
  hobby: { grace: 30, startup: 30, retries: 5 },
  pro: { grace: 60, startup: 30, retries: 10 },
  scale: { grace: 120, startup: 30, retries: 20 },
};
const POLICIES = ['no', 'on-failure', 'always', 'unless-stopped'];
const FIELDS = [
  'restart_policy',
  'max_retries',
  'startup_deadline_s',
  'stop_signal',
  'stop_grace_period_s',
] as const;

type Refusal = { status: 400; code: 'validation_failed'; detail: string };
const refuse = (detail: string): Refusal => ({
  status: 400,
  code: 'validation_failed',
  detail: `app manifest: ${detail}`,
});

/** Applies the body's lifecycle fields to `app`, or returns apid's refusal and changes nothing. */
export function applyLifecycle(
  app: App,
  body: Record<string, unknown>,
  plan: string
): Refusal | undefined {
  if (!FIELDS.some((key) => key in body && body[key] !== null)) return undefined;
  const caps = CAPS[plan] ?? CAPS.pro;
  const next = { ...(app.manifest ?? { entrypoint: [] }) } as Record<string, unknown>;
  const int = (key: string) => (typeof body[key] === 'number' ? (body[key] as number) : undefined);

  if (typeof body.restart_policy === 'string')
    next.restart_policy = body.restart_policy || undefined;
  if (typeof body.stop_signal === 'string') next.stop_signal = body.stop_signal || undefined;
  for (const key of ['max_retries', 'startup_deadline_s'] as const) {
    const n = int(key);
    if (n !== undefined) next[key] = n || undefined;
  }
  const grace = int('stop_grace_period_s');
  if (grace !== undefined) next.stop_grace_period = grace ? grace * 1e9 : undefined;

  const policy = next.restart_policy as string | undefined;
  if (policy && !POLICIES.includes(policy))
    return refuse(
      `restart_policy "${policy}" must be one of {no,on-failure,always,unless-stopped}`
    );
  const graceS = grace ?? 0;
  if (graceS < 0) return refuse(`stop_grace_period ${graceS}s must be >= 0`);
  if (graceS > caps.grace)
    return refuse(
      `stop_grace_period ${graceS}s exceeds plan "${plan}" cap ${caps.grace}s (ADR-138 §Decision 4)`
    );
  if (next.execution_mode === 'job' && policy === 'always')
    return refuse(
      "restart_policy=always is rejected for execution_mode=job (use 'no', 'on-failure', or 'unless-stopped')"
    );
  for (const [key, cap] of [
    ['startup_deadline_s', caps.startup],
    ['max_retries', caps.retries],
  ] as const) {
    const n = int(key) ?? 0;
    if (n < 0) return refuse(`${key} ${n} must be >= 0`);
    if (n > cap)
      return refuse(`${key} ${n} exceeds plan "${plan}" cap ${cap} (ADR-138 §Decision 5)`);
  }

  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  app.manifest = next as App['manifest'];
  return undefined;
}
