import type { App } from './data';

/**
 * The restart contract on `PATCH /v1/apps/{slug}`: restart_policy,
 * max_retries, startup_deadline_s, stop_signal and stop_grace_period_s.
 *
 * Mirrors apid: an empty or zero value inherits the default (lifecycle.go:239
 * merge), the per-plan caps are ValidatePlan's (appmanifest.go:885-958), and
 * a refusal is 400 validation_failed (lifecycle.go:63). The grace period is
 * stored as time.Duration and so reads back as nanoseconds.
 *
 * The snapshot hooks, after_restore and before_checkpoint, ride the same
 * PATCH: a hook with neither path nor timeout clears it (lifecycle.go:265),
 * and the checks are validateLifecycleHook's (appmanifest.go:87-101, 810-821).
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
  'after_restore',
  'before_checkpoint',
] as const;
const HOOKS = ['after_restore', 'before_checkpoint'] as const;

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
  for (const key of HOOKS) {
    const hook = body[key] as { path?: string; timeout_ms?: number } | null | undefined;
    if (!hook || typeof hook !== 'object') continue;
    const path = hook.path ?? '';
    const timeout = hook.timeout_ms ?? 0;
    next[key] = path === '' && timeout === 0 ? undefined : { ...hook };
    if (next[key] === undefined) continue;
    if (!path.startsWith('/') || path.startsWith('//') || /[?#%]/.test(path))
      return refuse(
        `${key}.path must be an absolute path without query, fragment, or percent escapes`
      );
    // eslint-disable-next-line no-control-regex -- apid refuses exactly these bytes
    if (/[\u0000-\u001f\u007f]/.test(path))
      return refuse(`${key}.path must not contain control characters`);
    if (!Number.isInteger(timeout) || timeout < 0 || timeout > 2000)
      return refuse(`${key}.timeout_ms must be between 0 and 2000`);
    const mode = (next.execution_mode as string | undefined) ?? 'request';
    if (mode !== 'request' && mode !== 'service')
      return refuse(`${key} requires request or service execution mode`);
  }

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
