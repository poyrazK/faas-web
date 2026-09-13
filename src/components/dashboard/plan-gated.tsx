import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api/errors';
import { PlanGate } from './plan-gate';

/**
 * Turns a plan-gate error into the existing `PlanGate` panel.
 *
 * `PlanGate` is presentational and already used by the metrics and app-detail
 * panels, which know statically that a feature is gated. This is the other
 * half: surfaces that only discover it from a 402.
 *
 * Matched on the RFC 7807 code, never the status. `402` is also
 * `billing_past_due` — an unpaid invoice — which is a different situation with
 * a different fix, and reading one as the other turns "upgrade to use this"
 * into "something is broken".
 *
 * Anything else falls through untouched: a real error belongs to the section
 * that hit it, which renders its own error state.
 */
const PLAN_GATE_CODES = new Set([
  'jobs_not_allowed',
  'plan_feature_gated',
  'plan_alert_rules_not_allowed',
  'plan_mirror_not_allowed',
  'tenant_surfaces_not_allowed',
  'openapi_docs_not_allowed',
  'plan_per_app_metrics_not_allowed',
  'plan_app_usage_summary_not_allowed',
  'plan_static_egress_ip_not_allowed',
  'plan_cors_preset_not_allowed',
  'managed_postgres_not_in_plan',
  'plan_triggers_not_allowed',
]);

export function isPlanGate(error: unknown): boolean {
  return error instanceof ApiError && PLAN_GATE_CODES.has(error.code);
}

export function PlanGated({
  error,
  feature,
  children,
}: {
  error: unknown;
  /** Named in the heading, e.g. "Jobs". */
  feature: string;
  children: ReactNode;
}) {
  if (!isPlanGate(error)) return <>{children}</>;

  // The API names the plan and the upgrade in its own detail and owns the plan
  // matrix, so prefer its words over a second copy kept correct by hand.
  const detail = error instanceof ApiError ? error.detail : undefined;

  return (
    <PlanGate
      feature={feature}
      description={detail ?? `${feature} is not included on your current plan.`}
    />
  );
}
