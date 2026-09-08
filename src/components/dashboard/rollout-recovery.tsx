import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useRecoverRollout, type Deployment } from '@/lib/api/queries';
import { cn } from '@/lib/utils';

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
 * a plan gate.
 */

export function isRolloutInFlight(deployment: Deployment): boolean {
  return deployment.rollout_state === 'pending' || deployment.rollout_state === 'rolling_out';
}

export function RolloutRecovery({ slug, deployment }: { slug: string; deployment: Deployment }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const recover = useRecoverRollout(slug);
  const [reason, setReason] = useState('');
  if (!isRolloutInFlight(deployment)) return null;

  const act = async (action: 'advance' | 'promote' | 'abort') => {
    if (action !== 'advance') {
      const ok = await confirm(
        action === 'promote'
          ? {
              title: 'Promote this deployment to all traffic?',
              description:
                'The rollout jumps to its final step: this deployment serves 100% and its siblings drop to zero. The remaining canary steps are skipped.',
              confirmLabel: 'Promote',
            }
          : {
              title: 'Abort this rollout?',
              description:
                'The rollout stops where it is and is marked aborted. Traffic stays as it is now; roll back separately if the previous deployment should serve.',
              confirmLabel: 'Abort rollout',
              destructive: true,
            }
      );
      if (!ok) return;
    }
    try {
      const result = await recover.mutateAsync({
        action,
        ...(action === 'abort' && reason.trim() ? { reason: reason.trim() } : {}),
      });
      setReason('');
      toast({
        kind: 'success',
        title:
          action === 'advance'
            ? 'Rollout advanced'
            : action === 'promote'
              ? 'Deployment promoted'
              : 'Rollout aborted',
        description: `Recorded as audit ${result.audit_id.slice(0, 12)}.`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'rollout_not_stuck') {
        toast({
          kind: 'info',
          title: 'The rollout is still moving',
          description: errorMessage(err),
        });
        return;
      }
      if (err instanceof ApiError && err.code === 'plan_traffic_split_not_allowed') {
        toast({
          kind: 'info',
          title: 'Not on your plan',
          description: 'Canary rollouts and their recovery need the Pro or Scale plan.',
        });
        return;
      }
      if (err instanceof ApiError && err.code === 'rollout_state_invalid') {
        toast({
          kind: 'info',
          title: 'Not in that state any more',
          description: errorMessage(err),
        });
        return;
      }
      toast({
        kind: 'error',
        title: 'Could not recover the rollout',
        description: errorMessage(err),
      });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
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
          disabled={recover.isPending}
        >
          Advance
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => void act('promote')}
          disabled={recover.isPending}
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
          disabled={recover.isPending}
        >
          Abort
        </Button>
      </div>
    </div>
  );
}
