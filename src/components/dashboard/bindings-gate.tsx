import { Link } from '@tanstack/react-router';
import { WarningTriangle } from 'iconoir-react';
import { ApiError } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import { CliCommand } from './cli-command';
import { ProblemHelp } from './problem-help';

type Finding = components['schemas']['BindingCheckFinding'];

/**
 * A traffic increase the binding release gate refused. Promotion always runs
 * the bindings check (faas handlers_binding_promotion.go:121-199); a traffic
 * change and a canary advance run it for every release gaining traffic in a
 * scope whose release policy is enforced (binding_release_traffic.go:26-86).
 * Rollout recovery never runs it, so under an enforced policy the store
 * refuses it outright (handlers_rollouts.go:159-160). In every case nothing
 * moved.
 */
export type BindingsGateRefusal = {
  code: 'bindings_check_failed' | 'bindings_check_changed' | 'bindings_release_required';
  blockers: Finding[];
  error: ApiError;
};

export function bindingsGateRefusal(error: unknown): BindingsGateRefusal | null {
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case 'bindings_check_failed':
    case 'bindings_check_changed':
      return { code: error.code, blockers: error.problem.bindings_check?.blockers ?? [], error };
    // bindingReleaseRequiredProblem carries no report (binding_release_traffic.go:20-22).
    case 'bindings_release_required':
      return { code: error.code, blockers: [], error };
  }
  return null;
}

/**
 * What to do about one blocker, by its code. The codes are faas
 * pkg/bindingcheck's (check.go, evidence.go, queue.go, object_storage.go,
 * runtime.go, application_adoption.go) and the write-time findings of
 * handlers_binding_promotion.go:203-235 and :280-288; the remedies follow
 * docs/errors.md:53-54.
 */
export function bindingBlockerRemedy(code: string): string {
  switch (code) {
    case 'verification_failed':
      return 'The last probe of this binding failed. Fix what it reaches, then verify this release again.';
    case 'verification_unsupported':
    case 'verification_unavailable':
    case 'managed_service_verification_unsupported':
      return 'No supported probe covers this binding here, so no evidence can be produced for it. An enforced release policy does not waive the gap.';
    case 'queue_consumer_stale':
      return 'The push consumer has not polled within its 30-second window. Wait for it to poll again, then retry.';
    case 'queue_consumer_paused':
      return 'The queue consumer is paused. Resume it on the Queues tab, then retry.';
    case 'queue_completion_unverified':
    case 'queue_completion_expired':
      return 'The release policy needs proof that the handler completed a message. Verify this release with a queue canary, then retry.';
    case 'binding_not_ready':
      return 'The binding is still provisioning or recovering. Wait until it is ready, then verify this release.';
    case 'promotion_observations_changed':
      return 'Bindings or runtime changed between the check and the traffic change. Retry.';
    case 'inventory_incomplete':
      return 'Not every binding catalog could be read. Retry; if it persists, check the binding inventory on the Services tab.';
  }
  if (
    code.startsWith('verification_') ||
    code === 'service_target_unverified' ||
    code === 'deployment_mismatch'
  )
    return 'There is no current evidence for this binding on this release. Verify this release, then retry.';
  if (code.startsWith('queue_consumer_'))
    return 'The scheduler has not seen a healthy poll from this push consumer. Check the consumer on the Queues tab, then retry.';
  if (
    code.startsWith('application_ack') ||
    code.startsWith('application_adoption') ||
    code.startsWith('reload_') ||
    code.startsWith('process_generation') ||
    code === 'signal_failed' ||
    code === 'binding_secret_unexpected'
  )
    return 'The workload has not reported applying the current secret version. Let it reload, or restart it, so it acknowledges; then retry.';
  if (code.startsWith('runtime_'))
    return 'The release’s instances are starting or have not reported yet. Wait for them to settle, then retry.';
  if (code.startsWith('object_storage_'))
    return 'The release policy needs an object-storage canary in the required mode. Verify this release with storage access consented, then retry.';
  return 'Resolve this blocker, verify this release again, then retry.';
}

export type GatedAction = 'promotion' | 'traffic change' | 'canary advance' | 'rollout recovery';

function lead(code: BindingsGateRefusal['code'], action: GatedAction): string {
  if (code === 'bindings_check_failed')
    return `Gregale checked this release’s bindings before the ${action}, and the check did not pass. Resolve each blocker:`;
  if (code === 'bindings_check_changed')
    return `The bindings check passed, but its evidence changed or expired before the ${action} committed.`;
  return action === 'rollout recovery'
    ? 'This scope’s binding release policy is enforced, and rollout recovery does not run the bindings check, so it cannot raise traffic. Verify this release, then advance the canary, which runs the check, or abort the rollout.'
    : 'This scope’s binding release policy requires fresh checked binding evidence before traffic can increase. Verify this release, then retry.';
}

const TITLE: Record<BindingsGateRefusal['code'], string> = {
  bindings_check_failed: 'Bindings check failed',
  bindings_check_changed: 'Bindings check changed',
  bindings_release_required: 'Binding release policy blocked traffic',
};

/**
 * The refusal, each blocker with what to do about it, and the two ways to
 * produce fresh evidence: a verification run on the Services tab, or the
 * CLI's verify (docs/errors.md:53).
 */
export function BindingsGateNotice({
  refusal,
  slug,
  deploymentId,
  action,
}: {
  refusal: BindingsGateRefusal;
  slug: string;
  deploymentId: string;
  action: GatedAction;
}) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
      <p
        className="flex items-start gap-1.5 text-xs font-medium"
        style={{ color: 'var(--status-critical)' }}
      >
        <WarningTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{TITLE[refusal.code]}. Traffic is unchanged.</span>
      </p>
      <p className="text-xs text-muted-foreground">{lead(refusal.code, action)}</p>
      {refusal.blockers.length > 0 && (
        <ul aria-label="Binding blockers" className="flex flex-col gap-1.5 text-xs">
          {refusal.blockers.map((blocker, index) => (
            <li key={`${blocker.code}-${blocker.binding ?? ''}-${index}`} className="min-w-0">
              <p className="break-words">
                {(blocker.binding || blocker.name) && (
                  <span className="font-mono">{blocker.binding || blocker.name}: </span>
                )}
                {blocker.message}{' '}
                <code className="font-mono text-muted-foreground">{blocker.code}</code>
              </p>
              <p className="text-muted-foreground">{bindingBlockerRemedy(blocker.code)}</p>
            </li>
          ))}
        </ul>
      )}
      <ProblemHelp error={refusal.error} />
      <Link
        to="/dashboard/apps/$appSlug"
        params={{ appSlug: slug }}
        search={{ tab: 'Services' }}
        className="w-fit text-xs font-medium text-brand hover:underline"
      >
        Verify bindings on the Services tab
      </Link>
      <CliCommand
        label="Or verify this release from the CLI"
        command={`gregale app binding verify ${slug} --release ${deploymentId} --all`}
        copyLabel={`binding verify command for ${slug}`}
      />
    </div>
  );
}
