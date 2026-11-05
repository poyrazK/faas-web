import type { components } from './api/schema';
import { ApiError, errorMessage } from './api/errors';
import { ACCOUNT_CURRENCY, formatMillicents, parseUsdMillicents } from './money';

/**
 * Budgets (faas ADR-566, ADR-1750, ADR-20261019193500; docs/billing.md
 * "Budget previews" to "Strict compute budgets").
 *
 * A budget is saved intent: a scope, a limit in millicents and a response.
 * Readiness and enforcement are reported separately on every read, and a
 * saved budget never by itself means anything stopped. The console authors
 * the three responses apid can activate, graded upward:
 *
 * - **Alert** — `monitored` / `notify`: emails (and channels) at thresholds
 *   and on a projected overrun; workloads keep running.
 * - **Stop previews** — `monitored` / `stop_previews` over compute alone: at
 *   the limit, preview apps in scope drain and stop; production continues.
 * - **Strict cap** — `strict` / `suspend_workloads`: workloads run only while
 *   funded, and are held at the limit. Released per account behind the
 *   `strict_budgets` flag; until then apid refuses to enable one with 422
 *   `financial_budget_activation_unavailable` (handlers_financial_budgets.go:214).
 *
 * Every other intent (reject_traffic, suspend_background, …) is accepted by
 * the API only as a disabled draft (handlers_financial_budgets.go:225-246), so
 * the console shows such a budget but does not author or enable one.
 */
type S = components['schemas'];
export type BudgetSpec = S['FinancialBudgetSpec'];
export type Budget = S['FinancialBudgetResponse'];
export type BudgetPreview = S['FinancialBudgetPreviewResponse'];
export type BudgetTarget = S['FinancialBudgetTarget'];
export type BudgetEvaluation = S['FinancialBudgetEvaluation'];
export type BudgetAlert = S['FinancialBudgetAlert'];
export type BudgetStop = S['FinancialBudgetStop'];
export type BudgetRevision = S['FinancialBudgetRevisionResponse'];
export type ScopeKind = BudgetSpec['scope']['kind'];
export type Meter = BudgetSpec['meters'][number];
export type BudgetLevel = 'alert' | 'stop-previews' | 'strict';

export const SCOPE_KINDS: { kind: ScopeKind; label: string }[] = [
  { kind: 'account', label: 'Whole account' },
  { kind: 'project', label: 'Project' },
  { kind: 'environment', label: 'Environment' },
  { kind: 'app', label: 'App' },
  { kind: 'job', label: 'Job' },
];

export const METERS: { meter: Meter; label: string }[] = [
  { meter: 'compute', label: 'Compute' },
  { meter: 'egress', label: 'Egress' },
  { meter: 'object_storage', label: 'Object storage' },
];

export const LEVELS: Record<BudgetLevel, { label: string; summary: string; scopes: ScopeKind[] }> =
  {
    alert: {
      label: 'Alert',
      summary:
        'Emails you, and any channels, at each threshold and when the month is projected to overrun. Nothing stops.',
      scopes: ['account', 'project', 'environment', 'app', 'job'],
    },
    'stop-previews': {
      label: 'Stop previews',
      summary:
        'Alerts, then stops the preview apps in scope once known compute reaches the limit. Production keeps running and spending.',
      // apid refuses stop_previews on a job (pkg/financial/budget.go:80).
      scopes: ['account', 'project', 'environment', 'app'],
    },
    strict: {
      label: 'Strict cap',
      summary:
        'Runs workloads only while compute is funded and holds every one in scope at the limit. Sends no alerts; pair it with an Alert budget.',
      scopes: ['account', 'project', 'environment', 'app', 'job'],
    },
  };

/** apid's bounds (faas pkg/api/limits.go:1791-1796, 15639). */
export const BUDGET_LIMITS = {
  perAccount: 128,
  nameBytes: 128,
  thresholds: 8,
  drainMax: 300,
  channels: 5,
} as const;

/** Where a spec sits on the grade, or 'api' for an intent only the API authors. */
export function budgetLevel(spec: BudgetSpec): BudgetLevel | 'api' {
  if (spec.mode === 'monitored' && spec.action === 'notify') return 'alert';
  // pkg/financial/stop.go:7 — preview stopping is a compute-only response.
  if (
    spec.mode === 'monitored' &&
    spec.action === 'stop_previews' &&
    spec.meters.length === 1 &&
    spec.meters[0] === 'compute'
  )
    return 'stop-previews';
  if (spec.mode === 'strict' && spec.action === 'suspend_workloads') return 'strict';
  return 'api';
}

/**
 * The strict shapes apid can fund (pkg/financial/compute.go:18-51, egress.go:6):
 * gross compute for an app, job, project or environment; net compute, or net
 * compute and egress, for the account; always with no drain and no thresholds.
 */
export function isStrictCompute(spec: BudgetSpec): boolean {
  if (spec.mode !== 'strict' || spec.action !== 'suspend_workloads') return false;
  if (spec.drain_seconds !== 0 || spec.notify_millicents.length !== 0) return false;
  const meters = spec.meters.join(',');
  if (spec.scope.kind === 'account')
    return spec.basis === 'net_usage' && (meters === 'compute' || meters === 'compute,egress');
  return spec.basis === 'gross_usage' && meters === 'compute';
}

/** The form's view of a spec: text where a person types, choices elsewhere. */
export interface BudgetDraft {
  name: string;
  level: BudgetLevel;
  scopeKind: ScopeKind;
  scopeId: string;
  /** USD, as typed. */
  limit: string;
  /** USD amounts, comma separated, as typed. Ignored on a strict cap. */
  thresholds: string;
  meters: Meter[];
  basis: BudgetSpec['basis'];
  drainSeconds: string;
  resumeRule: BudgetSpec['resume_rule'];
  enabled: boolean;
}

export function emptyDraft(): BudgetDraft {
  return {
    name: '',
    level: 'alert',
    scopeKind: 'account',
    scopeId: '',
    limit: '',
    thresholds: '',
    meters: ['compute'],
    basis: 'net_usage',
    drainSeconds: '0',
    resumeRule: 'next_period',
    enabled: true,
  };
}

/** Millicents as the dollars a person would type back: "10", "8.50". */
function dollarsText(millicents: number): string {
  // A sub-cent amount (written through the API) is shown as is; the form then
  // asks for whole cents rather than silently rounding it.
  if (millicents % 1000 !== 0) return String(millicents / 100_000);
  const cents = millicents / 1000;
  const whole = Math.floor(cents / 100);
  return cents % 100 ? `${whole}.${String(cents % 100).padStart(2, '0')}` : String(whole);
}

export function draftFromSpec(spec: BudgetSpec): BudgetDraft {
  const level = budgetLevel(spec);
  return {
    name: spec.name,
    level: level === 'api' ? 'alert' : level,
    scopeKind: spec.scope.kind,
    scopeId: spec.scope.id ?? '',
    limit: dollarsText(spec.limit_millicents),
    thresholds: spec.notify_millicents.map(dollarsText).join(', '),
    meters: [...spec.meters],
    basis: spec.basis,
    drainSeconds: String(spec.drain_seconds),
    resumeRule: spec.resume_rule,
    enabled: spec.enabled,
  };
}

function parseThresholds(text: string): number[] | undefined {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const amounts = parts.map(parseUsdMillicents);
  return amounts.every((amount): amount is number => amount !== undefined) ? amounts : undefined;
}

/** The spec a valid draft saves. Fields a level cannot carry are fixed to what apid requires. */
export function specFromDraft(draft: BudgetDraft): BudgetSpec {
  const scope =
    draft.scopeKind === 'account'
      ? { kind: draft.scopeKind }
      : { kind: draft.scopeKind, id: draft.scopeId };
  const base = {
    name: draft.name.trim(),
    scope,
    // New writes are USD only (FinancialBudgetSpec.currency).
    currency: ACCOUNT_CURRENCY,
    limit_millicents: parseUsdMillicents(draft.limit) ?? 0,
    resume_rule: draft.resumeRule,
    enabled: draft.enabled,
  } as const;
  const order = METERS.map((m) => m.meter);
  if (draft.level === 'strict') {
    const account = draft.scopeKind === 'account';
    return {
      ...base,
      // Strict account budgets may add egress under the same paid limit; a
      // resource cap covers compute alone, on gross usage (budget.go:94-107).
      meters: account && draft.meters.includes('egress') ? ['compute', 'egress'] : ['compute'],
      basis: account ? 'net_usage' : 'gross_usage',
      notify_millicents: [],
      mode: 'strict',
      action: 'suspend_workloads',
      drain_seconds: 0,
    };
  }
  const thresholds = parseThresholds(draft.thresholds) ?? [];
  if (draft.level === 'stop-previews')
    return {
      ...base,
      meters: ['compute'],
      basis: draft.basis,
      notify_millicents: thresholds,
      mode: 'monitored',
      action: 'stop_previews',
      drain_seconds: Number(draft.drainSeconds) || 0,
    };
  // Object storage carries no app, job, project or environment attribution
  // (ADR-20261020160000), so only an account budget may count it.
  const meters = order.filter(
    (meter) =>
      draft.meters.includes(meter) && (meter !== 'object_storage' || draft.scopeKind === 'account')
  );
  return {
    ...base,
    meters,
    basis: draft.basis,
    notify_millicents: thresholds,
    mode: 'monitored',
    action: 'notify',
    drain_seconds: 0,
  };
}

export type DraftField = 'name' | 'scope' | 'limit' | 'thresholds' | 'meters' | 'drain';

/** The rules apid enforces (budget.go:40-109, financial_budget.go:48-56), in words. */
export function draftErrors(draft: BudgetDraft): Partial<Record<DraftField, string>> {
  const errors: Partial<Record<DraftField, string>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Give the budget a name.';
  else if (new TextEncoder().encode(draft.name).length > BUDGET_LIMITS.nameBytes)
    errors.name = `Keep the name within ${BUDGET_LIMITS.nameBytes} bytes.`;
  if (!LEVELS[draft.level].scopes.includes(draft.scopeKind))
    errors.scope = 'A job has no previews to stop. Choose another scope or Alert.';
  else if (draft.scopeKind !== 'account' && !draft.scopeId)
    errors.scope = `Choose the ${draft.scopeKind} this budget covers.`;
  const limit = parseUsdMillicents(draft.limit);
  if (limit === undefined) errors.limit = 'Enter whole dollars and cents, such as 25 or 25.50.';
  if (draft.level !== 'strict') {
    const thresholds = parseThresholds(draft.thresholds);
    if (!thresholds) errors.thresholds = 'Enter dollar amounts separated by commas, such as 5, 8.';
    else if (thresholds.length > BUDGET_LIMITS.thresholds)
      errors.thresholds = `At most ${BUDGET_LIMITS.thresholds} thresholds.`;
    else if (thresholds.some((t, i) => i > 0 && t <= thresholds[i - 1]))
      errors.thresholds = 'Each threshold must increase on the one before it.';
    else if (limit !== undefined && thresholds.some((t) => t > limit))
      errors.thresholds = 'Thresholds must be at or below the limit.';
    if (draft.level === 'alert' && !draft.meters.length)
      errors.meters = 'Choose at least one meter.';
  }
  if (draft.level === 'stop-previews') {
    const drain = Number(draft.drainSeconds);
    if (!/^\d+$/.test(draft.drainSeconds.trim()) || drain > BUDGET_LIMITS.drainMax)
      errors.drain = `Enter whole seconds from 0 to ${BUDGET_LIMITS.drainMax}.`;
  }
  return errors;
}

/**
 * A write refusal in words, by code. `strictNotReleased` is true only when an
 * enabled strict cap of a shape apid can fund was refused as unavailable:
 * the release check runs first and answers with that code
 * (handlers_financial_budgets.go:214-223), and every other refusal of a
 * fundable cap has its own code.
 */
export function budgetRefusal(
  error: unknown,
  spec: BudgetSpec | undefined
): { message: string; strictNotReleased: boolean } {
  const code = error instanceof ApiError ? error.code : '';
  if (code === 'financial_budget_activation_unavailable') {
    if (spec && spec.enabled && isStrictCompute(spec))
      return {
        strictNotReleased: true,
        message:
          'Strict budgets are not released to this account yet, so Gregale will not turn one on. Monitored budgets and alerts are unaffected. You can keep this cap as a disabled draft.',
      };
    return {
      strictNotReleased: false,
      message:
        'Gregale can turn on Alert, Stop previews and strict caps only. Save this budget as a disabled draft instead.',
    };
  }
  const message =
    code === 'financial_compute_not_ready'
      ? 'A strict cap turns on only when every workload it covers is idle, accounting for the month is complete, and every node can fund compute. Try again when the apps in scope are quiet.'
      : code === 'financial_compute_budget_too_low'
        ? "The limit is below this month's committed and reserved funding. Raise it: changing a budget never resets what was spent."
        : code === 'conflict'
          ? 'This budget changed since it was read. It has been reloaded; check it and try again.'
          : errorMessage(error);
  return { message, strictNotReleased: false };
}

const REASONS: Record<string, string> = {
  enforcement_integration_pending:
    'Nothing is evaluated or enforced for this intent; it is kept as written.',
  notification_only_workloads_continue: 'Alerts only: workloads keep running and spending.',
  monitored_preview_stopping: 'Stops preview apps in scope once known compute reaches the limit.',
  production_can_continue: 'Production apps keep running and spending.',
  overshoot_possible: 'Usage that arrives late and the drain can take spending past the limit.',
  awaiting_first_evaluation: 'Not evaluated yet this month.',
  monitor_evaluation_stale: 'The last evaluation is stale; no new alert is raised from it.',
  strict_app_gross_compute: "Caps the app's compute before the included allowance.",
  strict_job_gross_compute: "Caps the job's compute before the included allowance.",
  strict_project_gross_compute:
    'Caps the compute of every app in the project, before the included allowance.',
  strict_environment_gross_compute:
    'Caps the compute of every deployment in the environment, before the included allowance.',
  strict_account_net_compute: "Caps the account's compute after the included allowance.",
  strict_account_net_compute_egress: "Caps the account's compute and egress under one limit.",
  conservative_compute_commitments:
    'Funding is committed conservatively, so it can run ahead of billed compute.',
  funded_execution_window_only: 'Workloads run only inside funded windows.',
  subscription_storage_egress_tax_excluded:
    'Subscription, storage, egress and tax are not covered.',
  subscription_storage_builds_object_delivery_tax_excluded:
    'Subscription, storage, builds, object delivery and tax are not covered.',
  shared_quantity_allowance: 'The included allowance is shared once across the account.',
  funded_job_attempts: 'Job attempts are funded from the same limit.',
  one_paid_limit_two_quantity_allowances:
    'Compute and egress share one paid limit with separate allowances.',
  kernel_byte_credits: 'Egress is funded in byte credits.',
  unused_egress_credits_commit_conservatively:
    'Unused egress credits are committed conservatively.',
  egress_period_rate_pinned: "Egress is funded at the month's lowest recorded allowance.",
  project_apps_only_jobs_excluded: 'Jobs are not part of a project and are not covered.',
  environment_deployments_only_floors_jobs_excluded:
    'Capacity floors and jobs are not covered by an environment cap.',
  awaiting_period_initialization: "This month's funding book has not started yet.",
  compute_budget_held: 'Held: the limit is reached and covered workloads are stopped.',
  cost_evidence_unavailable: "This month's cost evidence could not be read.",
  policy_disabled: 'Disabled: a draft neither alerts nor stops anything.',
  no_current_action_targets: 'Nothing currently running would be affected.',
  requires_quiet_app_complete_accounting_native_owners:
    'Turning it on needs every covered workload idle and complete accounting for the month.',
  incomplete_evidence: 'The evidence is incomplete or stale.',
};

const EVIDENCE: Record<string, string> = {
  missing_scope_attribution: 'some usage could not be attributed to this scope',
  missing_meter: 'no usage evidence for this meter',
  insufficient_history: 'less than a day of usage this month',
};

const humanise = (code: string) => code.replace(/_/g, ' ');
const meterLabel = (meter: string) =>
  METERS.find((m) => m.meter === meter)?.label ?? humanise(meter);

/** A reason code in words; evidence reasons arrive as `meter:reason`. */
export function reasonText(code: string): string {
  if (REASONS[code]) return REASONS[code];
  const at = code.indexOf(':');
  if (at > 0) {
    const reason = code.slice(at + 1);
    return `${meterLabel(code.slice(0, at))}: ${EVIDENCE[reason] ?? humanise(reason)}`;
  }
  return humanise(code);
}

/** The preview's `guarantee`, which apid states as `;`-separated terms. */
export function guaranteeText(guarantee: string): string {
  if (guarantee.startsWith('notification_only'))
    return 'Alerts once usage is recorded. Workloads keep running.';
  if (guarantee.startsWith('monitored_after_retained_evidence'))
    return 'Acts once usage is recorded, so late usage and the drain can take spending past the limit.';
  if (guarantee.startsWith('strict_compute_pending'))
    return 'Strict enforcement is not available for this intent.';
  if (guarantee.startsWith('strict_'))
    return 'Compute runs only while funded and stops at the limit. Commitments are conservative; meters outside the cap keep spending.';
  return guarantee
    .split(';')
    .map((term) => humanise(term.trim()))
    .filter(Boolean)
    .join('; ');
}

const EFFECTS: Record<string, string> = {
  notify_only: 'Alerted only',
  reject_new_traffic: 'New requests refused; running work continues',
  block_traffic_and_wakes_then_stop_at_drain_deadline:
    'Requests and wakes blocked, then stopped at the drain deadline',
  block_traffic_and_wakes_then_park_at_drain_deadline: 'Requests and wakes blocked, then parked',
  block_dispatch_then_terminate_at_drain_deadline: 'Dispatch blocked, then terminated',
  compute_can_continue: 'Keeps running and spending',
};

export const effectText = (effect: string) => EFFECTS[effect] ?? humanise(effect);

function names(targets: Pick<BudgetTarget, 'name'>[], max = 8): string {
  const shown = targets.slice(0, max).map((t) => t.name);
  const rest = targets.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

/**
 * The confirm text for turning on an automatic stop: what stops, when, what
 * keeps running, and what releases it (docs/billing.md "Monitored preview
 * stopping"; strict-budgets.md). Names come from the preview of this exact
 * spec; without one, the scope is named instead of guessing members.
 */
export function stopSummary(
  spec: BudgetSpec,
  scopeLabel: string,
  preview: Pick<BudgetPreview, 'targets' | 'continuing_targets'> | undefined
): string {
  const limit = formatMillicents(spec.limit_millicents);
  const strict = spec.mode === 'strict';
  const release =
    spec.resume_rule === 'next_period'
      ? 'It lifts at the start of the next UTC month.'
      : 'It stays until you change, disable or delete this budget.';
  if (strict) {
    const held = preview?.targets.length
      ? `these are held: ${names(preview.targets)}`
      : `every workload in ${scopeLabel} is held`;
    return `When funded compute in ${scopeLabel} reaches ${limit} this month, ${held}. New requests and wakes are refused while held. ${release}`;
  }
  const drain = spec.drain_seconds
    ? `after a ${spec.drain_seconds} second${spec.drain_seconds === 1 ? '' : 's'} drain`
    : 'at once, with no drain';
  const stops = preview
    ? preview.targets.length
      ? `Gregale blocks new requests to ${names(preview.targets)}, then stops ${preview.targets.length === 1 ? 'it' : 'them'} ${drain}`
      : `no preview app is running in ${scopeLabel} now; any that is then is blocked and stopped ${drain}`
    : `Gregale blocks new requests to every preview app in ${scopeLabel}, then stops them ${drain}`;
  const continuing = preview?.continuing_targets.length
    ? ` ${names(preview.continuing_targets)} ${preview.continuing_targets.length === 1 ? 'keeps' : 'keep'} running.`
    : ' Production keeps running.';
  return `When known compute in ${scopeLabel} reaches ${limit} this month, ${stops}; snapshots are kept for the next allowed wake.${continuing} ${release}`;
}
