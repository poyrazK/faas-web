import { useState } from 'react';
import { Pin, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { useCapability } from '@/lib/api/capabilities';
import {
  deploymentScope,
  servingPin,
  usePromoteDeployment,
  useServingRows,
} from '@/lib/api/deployment-detail';
import { ApiError, errorMessage } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';
import { BindingsGateNotice, bindingsGateRefusal, type BindingsGateRefusal } from './bindings-gate';
import { CapabilityNotice } from './capability-notice';
import { InlinePhase, queryPhase } from './primitives';
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
 * The serving read behind a pinned traffic change, shared by promotion and
 * the traffic-weight control: what serves now, and the pin it gives. Only a
 * ready read yields a pin, so nothing is sent while the console cannot say
 * what serves.
 */
export function useServingPin(slug: string, deployment: Deployment, enabled: boolean) {
  const read = useServingRows(slug, deploymentScope(deployment), { enabled });
  const phase = queryPhase({ error: read.error, loading: read.isPending });
  const pin = phase === 'ready' && read.data ? servingPin(deployment, read.data) : undefined;
  return { read, phase, pin };
}

/** The release a pinned change expects to be serving, if the API can pin one. */
export function pinnedRelease(serving: ReturnType<typeof useServingPin>): Deployment | undefined {
  return serving.pin?.kind === 'sole' ? serving.pin.serving : undefined;
}

/** What a traffic change will be pinned to, said before it is sent. */
export function ServingNote({
  serving,
  action,
  pinsNone = false,
}: {
  serving: ReturnType<typeof useServingPin>;
  action: string;
  /** The traffic route also pins "no other release serves" (`''`); promotion cannot. */
  pinsNone?: boolean;
}) {
  const { read, phase, pin } = serving;
  if (!pin)
    return (
      <InlinePhase
        phase={phase}
        error={read.error}
        loadingMessage="Reading which release serves this app…"
        onRetry={() => void read.refetch()}
      />
    );
  if (pin.kind === 'sole')
    return (
      <p className="flex items-start gap-1.5 text-xs">
        <Pin aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
        <span>
          <strong className="font-medium">{deploymentLabel(pin.serving)}</strong> serves all traffic
          now. The {action} is pinned to it: if another release takes over first, nothing moves.
        </span>
      </p>
    );
  if (pin.kind === 'none' && pinsNone)
    return (
      <p className="flex items-start gap-1.5 text-xs">
        <Pin aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
        <span>
          No other release serves this scope. The {action} is pinned to that: if one starts serving
          first, nothing moves.
        </span>
      </p>
    );
  const split =
    pin.kind === 'split'
      ? pin.serving.map((d) => `${deploymentLabel(d)} ${d.traffic_percent ?? 0}%`).join(', ')
      : '';
  return (
    <p className="text-xs text-muted-foreground">
      {pin.kind === 'split'
        ? `Traffic is split (${split}). Gregale can pin only a release that serves all traffic, so this ${action} is not pinned.`
        : pin.kind === 'none'
          ? `No other release serves this scope, so the ${action} has nothing to pin.`
          : `Gregale could not account for all of this scope's traffic in the deployment history, so this ${action} is not pinned.`}
    </p>
  );
}

/**
 * The refusal of a stale pin (`traffic_serving_changed`): the release shown
 * serving lost it before the write. Nothing moved; a refresh shows what
 * serves now, and the next attempt pins that instead.
 */
export function ServingChanged({
  pinned,
  refreshing,
  onRefresh,
}: {
  pinned: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
      <p className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--status-critical)' }}>
        <WarningTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Another release took over. {pinned} no longer serves all of this app&apos;s traffic, so
          nothing moved.
        </span>
      </p>
      <p className="text-xs text-muted-foreground">
        Refresh to see what serves now, then try again if you still mean to.
      </p>
      <div>
        <Button size="xs" variant="outline" busy={refreshing} onClick={onRefresh}>
          Refresh
        </Button>
      </div>
    </div>
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
 *
 * Every promotion pins the release shown serving all traffic, the console's
 * `--if-serving`; `ServingNote` says when the API has nothing to pin.
 */
export function PromoteDeployment({ slug, deployment }: { slug: string; deployment: Deployment }) {
  const capability = useCapability('progressive-rollouts');
  const promote = usePromoteDeployment();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [strict, setStrict] = useState(false);
  const [refusal, setRefusal] = useState<BindingsGateRefusal | null>(null);
  // The release a refused promotion was pinned to.
  const [takenOver, setTakenOver] = useState<string | null>(null);
  const serving = useServingPin(
    slug,
    deployment,
    canPromote(deployment) && capability.state === 'available'
  );
  if (!canPromote(deployment)) return null;

  const label = deploymentLabel(deployment);
  const from = deployment.traffic_percent ?? 0;
  const scope = deployment.scope && deployment.scope !== 'default' ? ` ${deployment.scope}` : '';

  const onPromote = async () => {
    if (!serving.pin) return;
    // Pinned to what is on screen now, so the dialog names the release the request pins.
    const pinned = pinnedRelease(serving);
    const ok = await confirm({
      title: `Move all traffic to ${label}?`,
      description:
        `${label} goes from ${from}% to 100% of this app's${scope} traffic, and every other live release in that scope drops to 0%. ` +
        'Gregale checks its bindings first and changes nothing if the check fails.' +
        (strict
          ? ' Every workload holding a database or object-storage binding secret must also have acknowledged the current secret version.'
          : '') +
        (pinned
          ? ` It is pinned to ${deploymentLabel(pinned)}: if another release takes over before it commits, nothing moves.`
          : ''),
      confirmLabel: 'Promote',
    });
    if (!ok) return;
    setRefusal(null);
    setTakenOver(null);
    try {
      const result = await promote.mutateAsync({
        id: deployment.id,
        requireApplicationAck: strict,
        ...(pinned ? { expectedServingDeploymentId: pinned.id } : {}),
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
      // Only a pinned request can be refused this way (pgstore.go:8713-8727).
      if (code === 'traffic_serving_changed') {
        setTakenOver(pinned ? deploymentLabel(pinned) : 'The release that was serving');
        return;
      }
      // A failed or changed check, or a write the release policy fenced
      // (handlers_binding_promotion.go:191, :278-288).
      const gate = bindingsGateRefusal(err);
      if (gate) {
        setRefusal(gate);
        return;
      }
      // A server without the strict route answers Go's plain-text 404, which
      // reaches us as http_404. Never fall back to the ordinary route.
      if (strict && code === 'http_404') {
        toast({
          kind: 'error',
          title: 'Not promoted',
          description:
            'This server does not support strict promotion, so traffic is unchanged. Promote without the requirement only if you mean to.',
        });
        return;
      }
      // A current server's not_found means the release is gone or not this
      // account's (handlers_binding_promotion.go:69-76), on either route.
      if (code === 'not_found') {
        toast({
          kind: 'error',
          title: 'Not promoted',
          description: `${label} no longer exists for this app, so traffic is unchanged.`,
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
          <ServingNote serving={serving} action="promotion" />
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
              disabled={!serving.pin}
              onClick={() => void onPromote()}
            >
              Promote {label} to 100%
            </Button>
          </div>
          {takenOver && (
            <ServingChanged
              pinned={takenOver}
              refreshing={serving.read.isFetching}
              onRefresh={() => void serving.read.refetch().then(() => setTakenOver(null))}
            />
          )}
          {refusal && (
            <BindingsGateNotice
              refusal={refusal}
              slug={slug}
              deploymentId={deployment.id}
              action="promotion"
            />
          )}
        </>
      )}
    </div>
  );
}
