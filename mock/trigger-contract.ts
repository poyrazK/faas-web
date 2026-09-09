import type { components } from '../src/lib/api/schema';

type Plan = components['schemas']['AccountResponse']['plan'];
type Limits = components['schemas']['AccountResponse']['limits'];
type BrokerKind = Exclude<components['schemas']['TriggerKind'], 'cron'>;

export const FREE_TRIGGER_ERROR_CODE = 'plan_triggers_not_allowed';
export const KAFKA_SASL_MECHANISMS = ['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512'] as const;

type TriggerCapabilities = Pick<
  Limits,
  | 'triggers_allowed'
  | 'trigger_kinds'
  | 'trigger_limit_per_app'
  | 'trigger_limit_per_account'
  | 'trigger_batch_size_max'
  | 'trigger_batch_window_max_ms'
  | 'trigger_max_attempts_max'
  | 'trigger_payload_max_bytes'
  | 'trigger_tls_skip_verify_allowed'
>;

const ALL_KINDS: BrokerKind[] = ['kafka', 'nats', 'redis_streams', 'sqs_compat', 'queue'];

export const TRIGGER_CAPABILITIES_BY_PLAN: Record<Plan, TriggerCapabilities> = {
  free: {
    triggers_allowed: false,
    trigger_kinds: [],
    trigger_limit_per_app: 0,
    trigger_limit_per_account: 0,
    trigger_batch_size_max: 0,
    trigger_batch_window_max_ms: 0,
    trigger_max_attempts_max: 0,
    trigger_payload_max_bytes: 0,
    trigger_tls_skip_verify_allowed: false,
  },
  hobby: {
    triggers_allowed: true,
    trigger_kinds: ['sqs_compat', 'queue'],
    trigger_limit_per_app: 2,
    trigger_limit_per_account: 10,
    trigger_batch_size_max: 50,
    trigger_batch_window_max_ms: 30_000,
    trigger_max_attempts_max: 3,
    trigger_payload_max_bytes: 1_048_576,
    trigger_tls_skip_verify_allowed: false,
  },
  pro: {
    triggers_allowed: true,
    trigger_kinds: ALL_KINDS,
    trigger_limit_per_app: 10,
    trigger_limit_per_account: 50,
    trigger_batch_size_max: 500,
    trigger_batch_window_max_ms: 300_000,
    trigger_max_attempts_max: 10,
    trigger_payload_max_bytes: 6_291_456,
    trigger_tls_skip_verify_allowed: true,
  },
  scale: {
    triggers_allowed: true,
    trigger_kinds: ALL_KINDS,
    trigger_limit_per_app: 50,
    trigger_limit_per_account: 200,
    trigger_batch_size_max: 5000,
    trigger_batch_window_max_ms: 300_000,
    trigger_max_attempts_max: 25,
    trigger_payload_max_bytes: 16_777_216,
    trigger_tls_skip_verify_allowed: true,
  },
};

export const TRIGGER_PLATFORM_DEFAULTS = {
  batch_size_max: 64,
  batch_window_ms: 1000,
  max_attempts: 5,
  payload_max_bytes: 6_291_456,
} as const;

export function triggerDefaultsFor(plan: Plan) {
  const caps = TRIGGER_CAPABILITIES_BY_PLAN[plan];
  return {
    batch_size_max: Math.min(TRIGGER_PLATFORM_DEFAULTS.batch_size_max, caps.trigger_batch_size_max),
    batch_window_ms: Math.min(
      TRIGGER_PLATFORM_DEFAULTS.batch_window_ms,
      caps.trigger_batch_window_max_ms
    ),
    max_attempts: Math.min(TRIGGER_PLATFORM_DEFAULTS.max_attempts, caps.trigger_max_attempts_max),
    payload_max_bytes: Math.min(
      TRIGGER_PLATFORM_DEFAULTS.payload_max_bytes,
      caps.trigger_payload_max_bytes
    ),
  };
}
