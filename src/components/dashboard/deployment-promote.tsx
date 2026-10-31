import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { useCapability } from '@/lib/api/capabilities';
import { usePromoteDeployment, type BindingFinding } from '@/lib/api/deployment-detail';
import { ApiError, errorMessage } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';
import { CapabilityNotice } from './capability-notice';
import { isRolloutInFlight } from './rollout-recovery';

/** `v44` when the release has a revision, else its short id. */
export function deploymentLabel(deployment: Pick<Deployment, 'id' | 'revision'>): string {
  return deployment.revision ? `v${deployment.revision}` : deployment.id.slice(0, 8);
}

/**
 * Whether promotion applies: a live release that does not serve everything,
 * outside a canary (which owns traffic and has its own promote in rollout
 * recovery) and not waiting for a scheduled start (the API refuses it with
 * `release_scheduled`).
 */
export function canPromote(deployment: Deployment): boolean {
  return (
    deployment.status.toLowerCase() === 'live' &&
    deployment.traffic_percent !== 100 &&
    !isRolloutInFlight(deployment) &&
    deployment.scheduled_release?.state !== 'scheduled'
  );
}

/**
 * Promote one live release to all traffic (POST /v1/deployments/{id}/promote,
 * handlers_binding_promotion.go). The server checks the release's bindings
 * inside the traffic transaction and changes nothing when the check fails or
 * its evidence changes. The strict variant also requires every workload that
 * holds a PostgreSQL or object-storage binding secret to have acknowledged
 * applying the current secret version; it has its own route so an older
 * server answers 404 rather than ignoring the requirement.
 */
export function PromoteDeployment({ deployment }: { deployment: Deployment }) {
  const capability = useCapability('progressive-rollouts');
  const promote = usePromoteDeployment();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [strict, setStrict] = useState(false);
  const [blockers, setBlockers] = useState<BindingFinding[] | null>(null);
  if (!canPromote(deployment)) return null;

  const label = deploymentLabel(deployment);
  const from = deployment.traffic_percent ?? 0;
  const scope = deployment.scope && deployment.scope !== 'default' ? ` ${deployment.scope}` : '';

  const onPromote = async () => {
    const ok = await confirm({
      title: `Move all traffic to ${label}?`,
      description:
        `${label} goes from ${from}% to 100% of this app's${scope} traffic, and every other live release in that scope drops to 0%. ` +
        'Gregale checks its bindings first and changes nothing if the check fails.' +
        (strict
          ? ' Every workload holding a database or object-storage binding secret must also have acknowledged the current secret version.'
          : ''),
      confirmLabel: 'Promote',
    });
    if (!ok) return;
    setBlockers(null);
    try {
      const result = await promote.mutateAsync({
        id: deployment.id,
        requireApplicationAck: strict,
      });
      toast({
        kind: 'success',
        title: result.already_promoted
          ? `${label} already served all traffic`
          : `${label} now serves all traffic`,
        description: result.already_promoted
          ? 'Nothing moved; the bindings check still passed.'
          : `Moved from ${result.from_percent}% to ${result.to_percent}%.`,
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'bindings_check_failed' || code === 'bindings_check_changed') {
        setBlockers((err as ApiError).problem.bindings_check?.blockers ?? []);
        return;
      }
      if (strict && code === 'not_found') {
        toast({
          kind: 'error',
          title: 'Not promoted',
          description:
            'This server does not support strict promotion, so traffic is unchanged. Promote without the requirement only if you mean to.',
        });
        return;
      }
      if (code === 'plan_traffic_split_not_allowed') {
        toast({ kind: 'info', title: 'Not on your plan', description: errorMessage(err) });
        return;
      }
      if (code === 'traffic_change_during_canary') {
        toast({
          kind: 'info',
          title: 'A canary rollout controls traffic',
          description: 'Advance or recover the rollout instead, then retry.',
        });
        return;
      }
      toast({ kind: 'error', title: 'Could not promote', description: errorMessage(err) });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="label-mono text-muted-foreground">Promote</p>
      {capability.state !== 'available' ? (
        <CapabilityNotice
          capability={capability.capability}
          state={capability.state}
          onRetry={capability.refresh}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Send all of this app&apos;s traffic to {label}, after a bindings check. A failed check
            leaves traffic as it is.
          </p>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={strict}
              onChange={(event) => setStrict(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--brand)]"
            />
            <span>
              Require application acknowledgements
              <span className="block text-muted-foreground">
                Each workload using a PostgreSQL or object-storage binding must report that it
                applied the current secret version. These are the app&apos;s own self-attestations,
                not a health check; workloads without secret reload support will block.
              </span>
            </span>
          </label>
          <div>
            <Button
              size="xs"
              variant="outline"
              busy={promote.isPending}
              onClick={() => void onPromote()}
            >
              Promote {label} to 100%
            </Button>
          </div>
          {blockers && (
            <div
              role="alert"
              className="rounded-md border border-border px-3 py-2 text-xs"
              style={{ color: 'var(--status-critical)' }}
            >
              <p>The bindings check did not pass, so traffic is unchanged.</p>
              {blockers.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-foreground">
                  {blockers.map((blocker, index) => (
                    <li key={`${blocker.code}-${index}`}>
                      {blocker.binding && <span className="font-mono">{blocker.binding}: </span>}
                      {blocker.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
