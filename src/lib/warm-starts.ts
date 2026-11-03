import type { App } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import type { Plan } from '@/lib/auth';
import { executionMode } from '@/lib/health-probes';

/**
 * Warm pool and warm snapshots (ledger C50): `warm_pool_size`,
 * `warm_snapshot_enabled`, `warm_snapshot_min_ms` and
 * `warm_snapshot_min_requests` on `PATCH /v1/apps/{slug}`.
 *
 * The plan gates are faas pkg/api/limits.go's WarmPoolAllowed (Free false,
 * Hobby/Pro/Scale true: :5613, :6053, :6475, :6906) and WarmSnapshotEnabled
 * (Pro and Scale: :5612, :6052, :6474, :6905). The bounds are
 * apidserver/handlers_ext.go's: a pool of 0..max_concurrency (:249-275), and
 * thresholds of 100..60,000 ms and 1..100 requests (:582-599).
 */

type InstanceResponse = components['schemas']['InstanceResponse'];

const POOL_PLANS: readonly Plan[] = ['hobby', 'pro', 'scale'];
const SNAPSHOT_PLANS: readonly Plan[] = ['pro', 'scale'];
export const warmPoolAllowed = (plan: Plan | undefined) => !!plan && POOL_PLANS.includes(plan);
export const warmSnapshotAllowed = (plan: Plan | undefined) =>
  !!plan && SNAPSHOT_PLANS.includes(plan);

export const MIN_MS = { min: 100, max: 60_000 } as const;
export const MIN_REQUESTS = { min: 1, max: 100 } as const;

/** The form's view: text as typed. */
export type WarmDraft = {
  warm_pool_size: string;
  warm_snapshot_enabled: boolean;
  warm_snapshot_min_ms: string;
  warm_snapshot_min_requests: string;
};
type Numeric = 'warm_pool_size' | 'warm_snapshot_min_ms' | 'warm_snapshot_min_requests';

const text = (n: number | undefined) => (n ? String(n) : '');

export function warmDraft(app: App): WarmDraft {
  return {
    warm_pool_size: String(app.warm_pool_size ?? 0),
    warm_snapshot_enabled: app.warm_snapshot_enabled ?? false,
    warm_snapshot_min_ms: text(app.warm_snapshot_min_ms),
    warm_snapshot_min_requests: text(app.warm_snapshot_min_requests),
  };
}

const range = (raw: string, min: number, max: number, unit: string) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max
    ? undefined
    : `Whole ${unit}, ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}.`;
};

export function warmErrors(draft: WarmDraft, app: App): Partial<Record<Numeric, string>> {
  const out: Partial<Record<Numeric, string>> = {};
  const max = app.max_concurrency;
  const size = Number(draft.warm_pool_size);
  if (draft.warm_pool_size === '' || !Number.isInteger(size) || size < 0)
    out.warm_pool_size = 'A whole number, 0 or more. 0 turns the pool off.';
  else if (size > max) out.warm_pool_size = `At most ${max}, the app’s max concurrency.`;
  if (draft.warm_snapshot_enabled) {
    const base = warmDraft(app);
    for (const [key, bounds, unit] of [
      ['warm_snapshot_min_ms', MIN_MS, 'milliseconds'],
      ['warm_snapshot_min_requests', MIN_REQUESTS, 'requests'],
    ] as const) {
      const raw = draft[key];
      // Empty is "unchanged", which only holds when nothing was stored.
      if (raw === '' && base[key] === '') continue;
      const error = range(raw, bounds.min, bounds.max, unit);
      if (error) out[key] = error;
    }
  }
  return out;
}

/** Only what changed. Thresholds go only while warm snapshots stay on. */
export function warmChanges(
  app: App,
  draft: WarmDraft
): Partial<Record<Numeric, number> & { warm_snapshot_enabled: boolean }> {
  const base = warmDraft(app);
  const out: Partial<Record<Numeric, number> & { warm_snapshot_enabled: boolean }> = {};
  if (draft.warm_pool_size !== base.warm_pool_size)
    out.warm_pool_size = Number(draft.warm_pool_size);
  if (draft.warm_snapshot_enabled !== base.warm_snapshot_enabled)
    out.warm_snapshot_enabled = draft.warm_snapshot_enabled;
  if (draft.warm_snapshot_enabled)
    for (const key of ['warm_snapshot_min_ms', 'warm_snapshot_min_requests'] as const)
      if (draft[key] !== base[key] && draft[key] !== '') out[key] = Number(draft[key]);
  return out;
}

/**
 * Workers and jobs are never snapshotted, so the scheduler keeps them no pool
 * (sched/warm_pool.go:168, lifecycle.go:83) and there is nothing to warm.
 */
export function warmApplies(app: App): boolean {
  const mode = executionMode(app);
  return mode === 'request' || mode === 'service';
}

/** Paused pool rows are instances in the `warm` state (state/machine.go:50). */
export const pausedNow = (instances: Pick<InstanceResponse, 'state'>[]) =>
  instances.filter((instance) => instance.state === 'warm').length;
