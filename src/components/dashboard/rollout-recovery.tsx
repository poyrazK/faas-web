import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { useRecoverRollout, type Deployment } from '@/lib/api/queries';
import { isRolloutInFlight } from '@/lib/deployment-history-view';
import { cn } from '@/lib/utils';
import { BindingsGateNotice, bindingsGateRefusal, type BindingsGateRefusal } from './bindings-gate';

/**
 * The escape hatch for a rollout that stopped moving (ADR-122).
 *
 * Distinct from the canary advance beside it: that one asks the API to take
 * the next scheduled step of a healthy rollout, while these are the manual
 * overrides. `advance` here is only legal once the platform considers the
 * rollout stuck — a healthy one answers `409 rollout_not_stuck` and says to
 * promote instead, which is repeated verbatim rather than softened. `promote`
 * ships the deployment at 100% with no stuck check, and `abort` stops the
 * rollout, recording the reason the customer types.
 *
 * Offered only while a rollout is actually in flight, and only on the plans
 * that have canaries at all; `403 plan_traffic_split_not_allowed` is read as
 * a plan gate. Recovery runs no bindings check, so under an enforced binding
 * release policy a promote or advance is refused with
 * `bindings_release_required` (faas handlers_rollouts.go:159-160), which is
 * explained in place with what to do instead.
 */

export { isRolloutInFlight } from '@/lib/deployment-history-view';

export type RecoverAction = 'advance' | 'promote' | 'abort';

/**
 * The recovery request with its confirmations and the refusals faas returns,
 * shared by this panel and the rollout headline on the Deployments tab.
 * `abort` zeroes the canary and hands its share back to the live release it
 * was replacing in the same transaction (faas pgstore.go recoverRollout), so
 * it reads as a roll back.
 */
export function useRolloutRecovery(slug: string) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const recover = useRecoverRollout(slug);
  const [refusal, setRefusal] = useState<BindingsGateRefusal | null>(null);

  const act = async (action: RecoverAction, reason = ''): Promise<boolean> => {
    if (action !== 'advance') {
      const ok = await confirm(
        action === 'promote'
          ? {
              title: 'Send all traffic to the new version?',
              description:
                'The remaining canary steps are skipped: this deployment serves 100% and the version it replaces drops to zero.',
              confirmLabel: 'Send all traffic',
            }
          : {
              title: 'Roll back this rollout?',
              description:
                'The rollout stops and is marked aborted. The new version drops to zero traffic and the version it was replacing serves all of it again. The new version stays in history.',
              confirmLabel: 'Roll back',
              destructive: true,
            }
      );
      if (!ok) return false;
    }
    setRefusal(null);
    try {
      const result = await recover.mutateAsync({
        action,
        ...(action === 'abort' && reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast({
        kind: 'success',
        title:
          action === 'advance'
            ? 'Rollout advanced'
            : action === 'promote'
              ? 'All traffic sent to the new version'
              : 'Rolled back',
        description: `Recorded as audit ${result.audit_id.slice(0, 12)}.`,
      });
      return true;
    } catch (err) {
      const gate = bindingsGateRefusal(err);
      if (gate) {
        setRefusal(gate);
        return false;
      }
      if (err instanceof ApiError && err.code === 'rollout_not_stuck') {
        toast({
          kind: 'info',
          title: 'The rollout is still moving',
          error: err,
        });
        return false;
      }
      if (err instanceof ApiError && err.code === 'plan_traffic_split_not_allowed') {
        toast({
          kind: 'info',
          title: 'Not on your plan',
          description: 'Canary rollouts and their recovery need the Pro or Scale plan.',
        });
        return false;
      }
      if (err instanceof ApiError && err.code === 'rollout_state_invalid') {
        toast({
          kind: 'info',
          title: 'Not in that state any more',
          error: err,
        });
        return false;
      }
      toast({
        kind: 'error',
        title: 'Could not recover the rollout',
        error: err,
      });
      return false;
    }
  };

  return { act, refusal, isPending: recover.isPending };
}

export function RolloutRecovery({ slug, deployment }: { slug: string; deployment: Deployment }) {
  const recovery = useRolloutRecovery(slug);
  const [reason, setReason] = useState('');
  if (!isRolloutInFlight(deployment)) return null;

  const act = async (action: RecoverAction) => {
    if (await recovery.act(action, reason)) setReason('');
  };
  const { refusal } = recovery;

  return (
    <div className="flex flex-col gap-2 well rounded-xl bg-muted/40 p-3">
      <p className="label-mono text-muted-foreground">Rollout recovery</p>
      <p className="text-xs text-muted-foreground">
        For a rollout that has stopped moving. Advancing is refused while the platform still sees
        progress.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          onClick={() => void act('advance')}
          disabled={recovery.isPending}
        >
          Advance
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => void act('promote')}
          disabled={recovery.isPending}
        >
          Promote to 100%
        </Button>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (recorded with an abort)"
          aria-label="Abort reason"
          className={cn(FIELD, 'h-7 w-64 text-xs')}
        />
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void act('abort')}
          disabled={recovery.isPending}
        >
          Abort
        </Button>
      </div>
      {refusal && (
        <BindingsGateNotice
          refusal={refusal}
          slug={slug}
          deploymentId={deployment.id}
          action="rollout recovery"
        />
      )}
    </div>
  );
}
