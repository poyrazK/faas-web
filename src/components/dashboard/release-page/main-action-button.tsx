import { Button } from '@/components/ui/button';
import { AdvanceCanaryButton } from '../deployment-actions';
import { RollbackStatus, useRollbackFlow } from '../rollback-status';
import { chooseMainAction } from './main-action';
import { releaseName } from './release-header';
import type { ReleaseContext } from './release-page';
import type { RolloutGroup } from './rollout-popup';

/**
 * The header's one action plus More. Rollbacks run here, through the same
 * confirmation and status flow the release summary used, so the page offers
 * each destructive action once.
 */
export function ReleaseMainAction({
  ctx,
  onOpenRollout,
}: {
  ctx: ReleaseContext;
  onOpenRollout: (focus?: RolloutGroup) => void;
}) {
  const action = chooseMainAction(ctx.deployment, ctx.summary);
  const rollback = useRollbackFlow(ctx.slug);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onOpenRollout()}>
          More
        </Button>
        {action?.kind === 'retry' && (
          <Button size="sm" onClick={() => onOpenRollout('recover')}>
            Retry
          </Button>
        )}
        {action?.kind === 'promote' && (
          <Button size="sm" onClick={() => onOpenRollout('move')}>
            Promote
          </Button>
        )}
        {action?.kind === 'advance-canary' && (
          <AdvanceCanaryButton deployment={ctx.deployment} slug={ctx.slug} />
        )}
        {action?.kind === 'rollback-to-this' && (
          <Button
            size="sm"
            variant="destructive"
            busy={rollback.isPending}
            onClick={() => void rollback.start(ctx.deployment.id, releaseName(ctx.deployment))}
          >
            Roll back to this release
          </Button>
        )}
        {action?.kind === 'rollback-to' && (
          <Button
            size="sm"
            variant="destructive"
            busy={rollback.isPending}
            onClick={() => void rollback.start(action.targetId, action.targetLabel)}
          >
            Roll back to {action.targetLabel}
          </Button>
        )}
      </div>
      {rollback.operation && (
        <RollbackStatus
          slug={ctx.slug}
          operation={rollback.operation}
          targetLabel={rollback.operationLabel}
        />
      )}
    </div>
  );
}
