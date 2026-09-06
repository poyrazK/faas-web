import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api/errors';
import { EmptyState } from '@/components/dashboard/primitives';

/**
 * The debugger is plan-gated: `DebugTelemetryEnabled` is false on Free, so
 * every debug endpoint answers `402 plan_feature_gated` there.
 *
 * That is a fact about the account, not a failure, and it must not read as a
 * broken page. It is matched on the code rather than the status because `402`
 * is also `billing_past_due` — a suspended account — which is a different
 * situation with a different fix.
 *
 * Anything else falls through: a real error belongs to the section that hit
 * it, which already renders its own error state.
 */
export function isPlanGated(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'plan_feature_gated';
}

export function DebugGate({ error, children }: { error: unknown; children: ReactNode }) {
  if (!isPlanGated(error)) return <>{children}</>;

  const detail = error instanceof ApiError ? error.detail : undefined;

  // The API names the upgrade in its own detail, and it knows the plan matrix;
  // restating it here would be a second place to keep correct.
  return (
    <EmptyState
      message={detail ?? 'The debugger is not included on this plan.'}
      action={
        <a
          href="/dashboard/plans"
          className="text-sm text-brand underline-offset-2 hover:underline"
        >
          See plans
        </a>
      }
    />
  );
}
