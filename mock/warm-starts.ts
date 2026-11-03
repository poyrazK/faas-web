import type { components } from '../src/lib/api/schema';
import * as db from './data';

/**
 * Warm pool and warm snapshots on `PATCH /v1/apps/{slug}`, as apid answers
 * them: the capability gate on the fields the `warm-pool` capability owns
 * (capgate/settings.go:74), the plan gates (403 plan_warm_pool_not_allowed on
 * Free, plan_warm_snapshot_not_allowed below Pro) and the bounds
 * (422 invalid_warm_pool_size, invalid_warm_snapshot_min_*), from faas
 * apidserver/handlers_ext.go:249-275, 519-526 and 582-599.
 *
 * The scheduler's pool shows on the instance list as `warm` rows. The mock
 * holds the size asked for unless the app is a worker or job, the plan has no
 * pool, or the spend cap is reached (sched/warm_pool.go:163-170).
 */

type Refusal = { status: 403 | 422; code: string; detail: string };
type Instance = components['schemas']['InstanceResponse'];

const FIELDS = [
  'warm_pool_size',
  'warm_snapshot_enabled',
  'warm_snapshot_min_ms',
  'warm_snapshot_min_requests',
] as const;
const POOL_PLANS = ['hobby', 'pro', 'scale'];
const SNAPSHOT_PLANS = ['pro', 'scale'];

const int = (v: unknown) => (typeof v === 'number' ? v : undefined);

export function warmStartsRefusal(
  app: db.App,
  body: Record<string, unknown>,
  plan: string,
  hidden: ReadonlySet<string>
): Refusal | undefined {
  if (hidden.has('warm-pool'))
    for (const key of FIELDS) {
      const value = body[key];
      if (value && value !== (app as Record<string, unknown>)[key])
        return {
          status: 403,
          code: 'capability_not_released',
          detail: `app.${key} needs the Warm pool capability, which is not available to this account; remove it or contact support for access.`,
        };
    }
  const size = int(body.warm_pool_size);
  const max = int(body.max_concurrency) ?? app.max_concurrency;
  if (size !== undefined) {
    if (size > 0 && !POOL_PLANS.includes(plan))
      return {
        status: 403,
        code: 'plan_warm_pool_not_allowed',
        detail: 'Free tier does not support per-app warm pools; upgrade to Hobby or higher.',
      };
    if (size < 0 || size > max)
      return {
        status: 422,
        code: 'invalid_warm_pool_size',
        detail: `warm_pool_size must be in [0, ${max}] (max_concurrency); got ${size}`,
      };
  } else if (int(body.max_concurrency) !== undefined && (app.warm_pool_size ?? 0) > max)
    return {
      status: 422,
      code: 'invalid_warm_pool_size',
      detail: `max_concurrency must be at least the current warm_pool_size (${app.warm_pool_size}); got ${max}`,
    };
  if (body.warm_snapshot_enabled === true && !SNAPSHOT_PLANS.includes(plan))
    return {
      status: 403,
      code: 'plan_warm_snapshot_not_allowed',
      detail:
        'Free and Hobby tiers do not support per-app warm snapshots; upgrade to Pro or higher.',
    };
  const requests = int(body.warm_snapshot_min_requests);
  if (requests !== undefined && (requests < 1 || requests > 100))
    return {
      status: 422,
      code: 'invalid_warm_snapshot_min_requests',
      detail: `warm_snapshot_min_requests must be in [1, 100]; got ${requests}`,
    };
  const ms = int(body.warm_snapshot_min_ms);
  if (ms !== undefined && (ms < 100 || ms > 60_000))
    return {
      status: 422,
      code: 'invalid_warm_snapshot_min_ms',
      detail: `warm_snapshot_min_ms must be in [100, 60000]; got ${ms}`,
    };
  return undefined;
}

/** Stores the warm fields the body names; call after `warmStartsRefusal`. */
export function applyWarmStarts(app: db.App, body: Record<string, unknown>) {
  for (const key of FIELDS)
    if (key in body && body[key] !== null) (app as Record<string, unknown>)[key] = body[key];
}

/** The pool's paused rows, with ids stable across reads. */
export function warmPoolRows(app: db.App, plan: string, capReached: boolean): Instance[] {
  const mode = app.manifest?.execution_mode ?? 'request';
  const size = app.warm_pool_size ?? 0;
  if (!size || capReached || !POOL_PLANS.includes(plan) || mode === 'worker' || mode === 'job')
    return [];
  const dep = db.deployments.find((d) => d.app_id === app.id);
  return Array.from({ length: size }, (_, i) => ({
    id: `${app.id.slice(0, 24)}${(0xfeed0000 + i).toString(16)}`,
    app_id: app.id,
    deployment_id: dep?.id ?? app.id,
    state: 'warm',
    ram_mb: app.ram_mb,
    resident: true,
    started_at: db.iso(10 * 60_000),
    last_request_at: null,
    parked_at: null,
  }));
}
