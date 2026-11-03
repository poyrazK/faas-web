import type { components } from '../src/lib/api/schema';

/**
 * Managed PostgreSQL answers the dev mock derives rather than stores: the
 * month's usage and compute cap, plan capabilities, a database's conditions
 * and its connection planning. Each mirrors the faas code it is named after,
 * so the console's states come from the same rules apid applies.
 */

type S = components['schemas'];
type Plan = 'free' | 'hobby' | 'pro' | 'scale';
type Row = Record<string, unknown> & { id: string; state: string };

const HOUR = 3600;
const GIB = 1024 ** 3;
const DAY = 86_400;

/** faas pkg/api/managed_postgres.go managedPostgresPlanLimits. */
export const PG_PLAN_LIMITS: Record<
  Plan,
  {
    databases: number;
    storage: number;
    compute: number;
    classes: S['ManagedPostgresResize']['target_class'][];
  }
> = {
  free: { databases: 1, storage: GIB / 2, compute: 5 * HOUR, classes: ['development'] },
  hobby: { databases: 1, storage: GIB, compute: 25 * HOUR, classes: ['development'] },
  pro: {
    databases: 3,
    storage: 5 * GIB,
    compute: 75 * HOUR,
    classes: ['burstable', 'development'],
  },
  scale: {
    databases: 10,
    storage: 20 * GIB,
    compute: 200 * HOUR,
    classes: ['burstable', 'development', 'production'],
  },
};

export function pgPlan(raw: string | undefined): Plan {
  return raw === 'free' || raw === 'hobby' || raw === 'pro' || raw === 'scale' ? raw : 'pro';
}

const monthStart = (now: number) => {
  const at = new Date(now);
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
};

/**
 * Compute used this month, seeded by `MOCK_PG_CAP`: `suspended` sits exactly
 * at the allowance, `warning` past 80% of it, `overage` past it (and boots
 * with overage on); anything else is comfortably inside it.
 */
export function pgSeedCompute(cap: string | undefined, allowance: number): number {
  if (cap === 'suspended') return allowance;
  if (cap === 'overage') return Math.round(allowance * 1.2);
  if (cap === 'warning') return Math.round(allowance * 0.83);
  return Math.round(allowance * 0.42);
}

/** faas handlers_managed_postgres.go managedPostgresComputeCapState, enforcement on. */
export function pgCapState(
  used: number,
  allowance: number,
  overage: boolean
): NonNullable<S['ManagedPostgresUsageResponse']['compute_cap_state']> {
  const ceiling = overage ? allowance * 2 : allowance;
  if (ceiling > 0 && used >= ceiling) return 'suspended';
  if (overage && used >= allowance) return 'overage';
  if (used >= allowance - allowance / 5) return 'warning';
  return 'healthy';
}

/** faas handlers_managed_postgres.go managedPostgresUsageView, with the ledger on. */
export function pgUsage({
  plan,
  used,
  overage,
  readyDatabases,
  suspendedAt,
  now = Date.now(),
}: {
  plan: Plan;
  used: number;
  overage: boolean;
  readyDatabases: number;
  /** When the cap first suspended the subject this month, if it has. */
  suspendedAt?: number;
  now?: number;
}): S['ManagedPostgresUsageResponse'] {
  const limits = PG_PLAN_LIMITS[plan];
  const start = monthStart(now);
  const elapsed = Math.max(1, Math.floor((now - start) / 1000));
  const storageLimit = limits.storage * 31 * DAY;
  const stored = Math.round(limits.storage * 0.3) * elapsed;
  const state = pgCapState(used, limits.compute, overage);
  return {
    period_start: new Date(start).toISOString(),
    observed_at: new Date(now - 20 * 60_000).toISOString(),
    policy_enabled: true,
    fresh: true,
    guardrail_state: 'healthy',
    ready_databases: readyDatabases,
    database_limit: limits.databases,
    storage_limit_bytes: limits.storage,
    compute_unit_seconds: used,
    storage_byte_seconds: stored,
    storage_byte_seconds_limit: storageLimit,
    storage_byte_seconds_remaining: Math.max(0, storageLimit - stored),
    history_byte_seconds: Math.round(stored / 4),
    egress_bytes: 1_840_000_000,
    compute_allowance_unit_seconds: limits.compute,
    compute_ceiling_unit_seconds: overage ? limits.compute * 2 : limits.compute,
    compute_cap_state: state,
    overage_enabled: overage,
    ...(state === 'suspended'
      ? {
          compute_suspended_at: new Date(
            suspendedAt ?? Math.max(start, now - 18 * HOUR * 1000)
          ).toISOString(),
        }
      : {}),
  };
}

/** faas handlers_managed_postgres_capabilities.go managedPostgresCapabilitiesView. */
export function pgCapabilities(plan: Plan, region: string): S['ManagedPostgresCapabilities'] {
  const limits = PG_PLAN_LIMITS[plan];
  return {
    contract_version: 1,
    region,
    provisioning_enabled: true,
    database_limit: limits.databases,
    postgres_majors: [15, 16, 17],
    service_classes: limits.classes,
    availability: ['single_zone'],
    credential_access: ['migration', 'read_only', 'read_write'],
    scale_to_zero: true,
    always_on: false,
    pooled_connections: true,
    point_in_time_restore: true,
    class_resize: limits.classes.length > 1,
    scale_to_zero_update: true,
    storage_limit_bytes: limits.storage,
    restore_window_seconds: 7 * DAY,
  };
}

/** faas pkg/conditions/resources.go Database. */
export function pgConditions(row: Row, now = Date.now()): S['ResourceStatus'] {
  const state = row.state;
  const error = typeof row.last_error_code === 'string' ? row.last_error_code : '';
  const failed = error ? `The database failed: ${error}.` : 'The database failed.';
  let ready: S['Condition'];
  if (state === 'ready') {
    ready = row.scale_to_zero
      ? {
          type: 'Ready',
          status: 'True',
          reason: 'suspended',
          message: 'Compute scaled to zero; the next connection wakes it.',
        }
      : {
          type: 'Ready',
          status: 'True',
          reason: 'ready',
          message: 'The database accepts connections.',
        };
  } else if (state === 'failed') {
    ready = { type: 'Ready', status: 'False', reason: 'failed', message: failed, terminal: true };
  } else {
    ready = {
      type: 'Ready',
      status: 'False',
      reason: state,
      message: `The database is ${state}.`,
      ...(state === 'deleting' ? { terminal: true } : {}),
    };
  }
  const busy = state === 'provisioning' || state === 'updating' || state === 'deleting';
  const progressing: S['Condition'] = busy
    ? { type: 'Progressing', status: 'True', reason: state, message: `The database is ${state}.` }
    : state === 'failed'
      ? { type: 'Progressing', status: 'False', reason: 'failed', message: failed, terminal: true }
      : {
          type: 'Progressing',
          status: 'False',
          reason: 'complete',
          message: 'Nothing is in progress.',
        };
  const degraded: S['Condition'] =
    state === 'ready'
      ? {
          type: 'Degraded',
          status: 'False',
          reason: 'healthy',
          message: 'The provider reports the database ready.',
        }
      : {
          type: 'Degraded',
          status: 'Unknown',
          reason: 'not_assessed',
          message: 'No health observation is available.',
        };
  return {
    kind: 'database',
    name: String(row.name),
    observed_at: new Date(now).toISOString(),
    conditions: [ready, progressing, degraded],
  };
}

/**
 * faas managedpostgres/connection_budget.go describeConnectionBudget: today's
 * adapters have no verified capacity, so the state stays unknown.
 */
export function pgConnectionBudget(
  row: Row,
  bindings: number,
  now = Date.now()
): S['ManagedPostgresConnectionBudget'] {
  const reasons = ['capacity_unverified', 'external_consumers_unobserved'];
  if (bindings > 0) reasons.push('client_pool_sizes_unknown');
  if (row.state !== 'ready') reasons.push('database_not_ready');
  return {
    version: 1,
    database_id: row.id,
    database_name: String(row.name),
    state: 'unknown',
    checked_at: new Date(now).toISOString(),
    expires_at: new Date(now + 5 * 60_000).toISOString(),
    enforced: false,
    model: 'canonical_runtime_pools',
    inventory: {
      bindings,
      data_api_consumers: 0,
      auth_consumers: 0,
      migration_bindings: 0,
      other_bindings: bindings,
      resident_instances: bindings ? 1 : 0,
      parked_instances: bindings ? 2 : 0,
      auxiliary_instances: 0,
      active_tasks: 0,
      rotation_pending: 0,
      overlap_consumers: 0,
      stale_node_instances: 0,
    },
    demand: {
      data_api_resident_estimate: 0,
      data_api_wake_estimate: 0,
      auth_wake_estimate: 0,
      control_headroom: 2,
      migration_headroom: 0,
      modeled_peak_connections: 2,
      runtime_observations: {
        state: 'not_applicable',
        source: 'workload_report',
        observed_instances: 0,
        unobserved_instances: 0,
        parked_instances: 0,
        configured_connections: 0,
      },
    },
    capacity: { state: 'unknown' },
    reasons: reasons.sort(),
  };
}
