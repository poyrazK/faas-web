import type { components } from '@/lib/api/schema';
import type { Plan } from '@/lib/auth';

/**
 * The retry curve and retention every durable invocation carries — an async
 * invoke, a delayed task, or the app's own default for both.
 *
 * Semantics are faas's: `RetryPolicyDTO.Validate` (pkg/api/dto.go:6087) holds
 * max_attempts to 0–25 and jitter to 0–1, and `effectiveInvocationRetryPolicy`
 * (apidserver/handlers_invocations.go:987) takes the request's policy, else the
 * app default, else nothing — then caps attempts at the plan
 * (`EffectiveRetryMaxAttempts`, pkg/api/limits.go:9426), where 0 or "unset"
 * means the plan's cap, never unlimited. The backoff starts at base_seconds
 * (1 s when unset) and doubles, stopping at max_seconds when one is set
 * (pkg/dispatch/backoff.go:39-59).
 */

export type RetryPolicy = components['schemas']['RetryPolicyDTO'];

/** Total attempts, original included (pkg/api/limits.go DurableRetryMaxAttempts). */
export const MAX_ATTEMPTS = 25;

/**
 * Per-plan ceilings: `MaxQueueAttempts` (limits.go:5368, 5786, 6236, 6649;
 * Free's 0 becomes 1 in EffectiveRetryMaxAttempts) and
 * `MaxAsyncResultRetentionSeconds` (limits.go:5378, 5794, 6244, 6659). A
 * requested retention can only shorten the plan's window
 * (retentionForRequestAt, handlers_invocations.go:912).
 */
const PLAN_LIMITS: Record<Plan, { maxAttempts: number; retentionSeconds: number }> = {
  free: { maxAttempts: 1, retentionSeconds: 86_400 },
  hobby: { maxAttempts: 3, retentionSeconds: 604_800 },
  pro: { maxAttempts: 10, retentionSeconds: 2_592_000 },
  scale: { maxAttempts: 25, retentionSeconds: 7_776_000 },
};

export function invocationLimits(plan: Plan | undefined | null) {
  return plan ? PLAN_LIMITS[plan] : undefined;
}

/** What the inputs hold. Jitter is a percentage here and a fraction on the wire. */
export interface RetryDraft {
  maxAttempts: string;
  baseSeconds: string;
  maxSeconds: string;
  jitter: string;
}

export const NO_RETRY_DRAFT: RetryDraft = {
  maxAttempts: '',
  baseSeconds: '',
  maxSeconds: '',
  jitter: '',
};

export type RetryErrors = Partial<Record<keyof RetryDraft, string>>;

const blank = (value: string) => value.trim() === '';
const num = (value: string) => Number(value.trim());

export function retryDraftErrors(draft: RetryDraft): RetryErrors {
  const errors: RetryErrors = {};
  if (!blank(draft.maxAttempts)) {
    const n = num(draft.maxAttempts);
    // 0 is valid on the wire but means "the plan cap", which blank already says.
    if (!Number.isInteger(n) || n < 1 || n > MAX_ATTEMPTS)
      errors.maxAttempts = `Enter a whole number from 1 to ${MAX_ATTEMPTS}, or leave blank.`;
  }
  for (const field of ['baseSeconds', 'maxSeconds'] as const) {
    if (blank(draft[field])) continue;
    const n = num(draft[field]);
    if (!Number.isFinite(n) || n < 0) errors[field] = 'Enter a number of seconds, 0 or more.';
  }
  if (!errors.baseSeconds && !errors.maxSeconds) {
    const base = blank(draft.baseSeconds) ? 0 : num(draft.baseSeconds);
    const max = blank(draft.maxSeconds) ? 0 : num(draft.maxSeconds);
    if (base > 0 && max > 0 && max < base)
      errors.maxSeconds = 'The longest wait must be at least the first one.';
  }
  if (!blank(draft.jitter)) {
    const n = num(draft.jitter);
    if (!Number.isFinite(n) || n < 0 || n > 100)
      errors.jitter = 'Enter a percentage from 0 to 100.';
  }
  return errors;
}

export function isBlankRetryDraft(draft: RetryDraft): boolean {
  return Object.values(draft).every(blank);
}

/**
 * The policy to send, or `undefined` when nothing was set (so the next layer —
 * the app default, then the plan — decides). Throws the first problem.
 */
export function retryPolicyFromDraft(draft: RetryDraft): RetryPolicy | undefined {
  const first = Object.values(retryDraftErrors(draft))[0];
  if (first) throw new Error(`Retry policy: ${first}`);
  if (isBlankRetryDraft(draft)) return undefined;
  const policy: RetryPolicy = {};
  if (!blank(draft.maxAttempts)) policy.max_attempts = num(draft.maxAttempts);
  if (!blank(draft.baseSeconds)) policy.base_seconds = num(draft.baseSeconds);
  if (!blank(draft.maxSeconds)) policy.max_seconds = num(draft.maxSeconds);
  if (!blank(draft.jitter)) policy.jitter_seconds = Math.round(num(draft.jitter) * 100) / 10_000;
  return policy;
}

export function retryDraftFrom(policy: RetryPolicy | null | undefined): RetryDraft {
  if (!policy) return NO_RETRY_DRAFT;
  const text = (value: number | undefined) => (value ? String(value) : '');
  return {
    maxAttempts: text(policy.max_attempts),
    baseSeconds: text(policy.base_seconds),
    maxSeconds: text(policy.max_seconds),
    jitter: policy.jitter_seconds ? String(Math.round(policy.jitter_seconds * 10_000) / 100) : '',
  };
}

const seconds = (value: number) => `${value} s`;

/** One sentence for a stored or effective policy, in the plan's terms. */
export function describeRetryPolicy(
  policy: RetryPolicy | null | undefined,
  plan: Plan | undefined | null
): string {
  const cap = invocationLimits(plan)?.maxAttempts;
  const asked = policy?.max_attempts ?? 0;
  const capNote = cap !== undefined && asked > cap ? ` (${asked} asked, capped by the plan)` : '';
  const attempts =
    asked > 0
      ? `up to ${cap !== undefined ? Math.min(asked, cap) : asked} attempts${capNote}`
      : cap !== undefined
        ? `up to ${cap} attempts`
        : "up to the plan's attempt cap";
  const base = policy?.base_seconds ? policy.base_seconds : 1;
  const curve = policy?.max_seconds
    ? `first retry after ${seconds(base)}, doubling to at most ${seconds(policy.max_seconds)}`
    : `first retry after ${seconds(base)}, doubling each time`;
  const jitter = policy?.jitter_seconds
    ? `, ±${Math.round(policy.jitter_seconds * 100)}% jitter`
    : '';
  const sentence = `${attempts}, ${curve}${jitter}`;
  const empty =
    !policy ||
    (!policy.max_attempts && !policy.base_seconds && !policy.max_seconds && !policy.jitter_seconds);
  return empty ? `Plan default: ${sentence}` : sentence[0].toUpperCase() + sentence.slice(1);
}

/* ------------------------------------------------------------------ *
 * Durations — a relative delay or a retention window, typed as an
 * amount and a unit and sent as whole seconds.
 * ------------------------------------------------------------------ */

export const DURATION_UNITS = {
  seconds: 1,
  minutes: 60,
  hours: 3_600,
  days: 86_400,
} as const;

export type DurationUnit = keyof typeof DURATION_UNITS;

export interface DurationDraft {
  amount: string;
  unit: DurationUnit;
}

/** `null` when blank, `NaN` when not a positive whole number of seconds. */
export function durationSeconds(draft: DurationDraft): number | null {
  if (blank(draft.amount)) return null;
  const amount = num(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) return NaN;
  const total = amount * DURATION_UNITS[draft.unit];
  return Number.isInteger(total) ? total : NaN;
}

/** A window in the largest unit that divides it evenly, for hints. */
export function formatDuration(totalSeconds: number): string {
  for (const [unit, size] of [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ] as const) {
    if (totalSeconds >= size && totalSeconds % size === 0) {
      const n = totalSeconds / size;
      return `${n} ${unit}${n === 1 ? '' : 's'}`;
    }
  }
  return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
}
