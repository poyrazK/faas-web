import { useState } from 'react';
import { RefreshDouble } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import {
  isRollbackSettled,
  useRollbackOperation,
  useRollbackToRelease,
  type RollbackOperation,
} from '@/lib/api/deployment-detail';
import { ApiError, errorMessage } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';
import { deploymentLabel } from './deployment-promote';
import { InlinePhase, queryPhase } from './primitives';

const TRIGGER: Record<NonNullable<RollbackOperation['trigger']>, string> = {
  manual: 'Started by hand',
  auto_5xx: 'Started automatically after 5xx responses',
  alert: 'Started by an alert rule',
};

function statusSentence(op: RollbackOperation, target: string): string {
  switch (op.status) {
    case 'preparing':
      return `Preparing: Gregale is waking ${target} and checking its readiness. The release serving now keeps serving until then.`;
    case 'ready':
      return `Ready: ${target} passed its checks and waits for the traffic switch.`;
    case 'blocked':
      return 'Blocked: fresh evidence is missing. Gregale retries without choosing another release.';
    case 'routing':
      return `Moving traffic to ${target}.`;
    case 'complete':
      return op.recovery_ms != null
        ? `Complete: ${target} is serving again after ${(op.recovery_ms / 1000).toFixed(1)} s.`
        : `Complete: ${target} is serving again.`;
    case 'failed':
      return `Failed: ${op.error || 'the rollback did not finish'}. Traffic did not move to ${target}.`;
  }
}

/**
 * Progress of one accepted rollback (GET /v1/apps/{slug}/rollbacks/{operation},
 * handlers_checked_rollback.go:106). The POST only accepts the intent; this
 * polls until the operation completes or fails, which a plain rollback does
 * within 10 minutes (pkg/api/limits.go:1361).
 */
export function RollbackStatus({
  slug,
  operation,
  targetLabel,
}: {
  slug: string;
  operation: RollbackOperation;
  targetLabel?: string;
}) {
  const query = useRollbackOperation(slug, operation.id, operation);
  const op = query.data ?? operation;
  const target = targetLabel ?? op.target_deployment_id.slice(0, 8);
  const settled = isRollbackSettled(op.status);
  const tone =
    op.status === 'failed'
      ? 'var(--status-critical)'
      : op.status === 'complete'
        ? 'var(--status-good)'
        : undefined;
  return (
    <div
      role="status"
      aria-label="Rollback progress"
      className="flex flex-col gap-1.5 rounded-md bg-muted px-3 py-2 text-xs"
    >
      <p className="flex items-start gap-2 text-sm" style={tone ? { color: tone } : undefined}>
        {!settled && (
          <RefreshDouble className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        )}
        {statusSentence(op, target)}
      </p>
      {op.blockers && op.blockers.length > 0 && (
        <ul className="list-disc pl-4">
          {op.blockers.map((blocker, index) => (
            <li key={`${blocker.code}-${index}`}>{blocker.message}</li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground">
        {[
          op.trigger ? TRIGGER[op.trigger] : 'Checked rollback',
          op.code ? `code ${op.code}` : '',
          `operation ${op.id.slice(0, 8)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {query.error ? (
        <InlinePhase
          phase={queryPhase({ error: query.error })}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}
    </div>
  );
}

/** What to say about a refusal faas returns for an explicit rollback target. */
function refusal(
  code: string,
  label: string,
  err: unknown
): { title: string; description: string } | null {
  switch (code) {
    // verifyRollbackTargetArtifact: the cold-boot artifact cannot be verified.
    case 'rollback_target_unavailable':
      return {
        title: `Cannot roll back to ${label}`,
        description: `${errorMessage(err)}. Redeploy that release instead.`,
      };
    // A database switch undid the target's own release command; cannot be acknowledged.
    case 'rollback_target_database_restored':
      return {
        title: `Cannot roll back to ${label}`,
        description: `A database switch restored the database to before ${label}'s release command ran. Deploy that code again so its release command runs first.`,
      };
    case 'rollback_target_not_found':
      return {
        title: `Cannot roll back to ${label}`,
        description: `${label} is no longer a rollback target of this app. Refresh the release list.`,
      };
    // Cancelled, failed or still progressing; or its artifacts were reclaimed.
    case 'rollback_target_ineligible':
      return { title: `Cannot roll back to ${label}`, description: errorMessage(err) };
    default:
      return null;
  }
}

/**
 * One rollback flow for every button that rolls back to a named release
 * (POST /v1/apps/{slug}/rollback with `target_deployment_id`,
 * handlers_ext.go:2376): a destructive confirmation, a second one when the
 * rollback crosses release commands, the refusals faas returns, and the
 * accepted operation to watch.
 */
export function useRollbackFlow(slug: string) {
  const rollback = useRollbackToRelease();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [operation, setOperation] = useState<RollbackOperation | null>(null);
  const [operationLabel, setOperationLabel] = useState('');

  const submit = async (target: string, label: string, acknowledgeReleases: boolean) => {
    try {
      const result = await rollback.mutateAsync({
        slug,
        targetDeploymentId: target,
        ...(acknowledgeReleases ? { acknowledgeReleases: true } : {}),
      });
      if (result.rollback_operation) {
        setOperation(result.rollback_operation);
        setOperationLabel(label);
      } else
        toast({
          kind: 'success',
          title: 'Rollback accepted',
          description: `${label} serves once its readiness check passes.`,
        });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      // release/migrations.go:79; acknowledging is the only way past it.
      if (code === 'rollback_crosses_release' && !acknowledgeReleases) {
        const crossed = (err as ApiError).problem.crossed_releases ?? [];
        const list = crossed
          .map(
            (release) =>
              `${release.revision ? `v${release.revision}` : release.deployment_id.slice(0, 8)} (${release.status})`
          )
          .join(', ');
        const again = await confirm({
          title: `Roll back past release commands?`,
          description: `Release commands ran after ${label} last served${list ? `: ${list}` : ''}. A rollback does not undo them, so ${label} would run against the database as they left it.`,
          confirmLabel: 'Roll back anyway',
          destructive: true,
        });
        if (again) await submit(target, label, true);
        return;
      }
      if (code === 'rollback_target_already_live') {
        toast({ kind: 'info', title: `${label} is already live`, description: errorMessage(err) });
        return;
      }
      const known = refusal(code, label, err);
      toast({
        kind: 'error',
        title: known?.title ?? 'Could not roll back',
        description: known?.description ?? errorMessage(err),
      });
    }
  };

  const start = async (target: string, label: string) => {
    const ok = await confirm({
      title: `Roll back to ${label}?`,
      description: `${label} takes this app's traffic back once its readiness check passes, and the release serving now is superseded. It stays in history.`,
      confirmLabel: 'Roll back',
      destructive: true,
    });
    if (ok) await submit(target, label, false);
  };

  return { start, operation, operationLabel, isPending: rollback.isPending };
}

/**
 * Roll the app back to this exact release. The API accepts only a superseded
 * release, or a live one at zero traffic; a release with no traffic is
 * promoted instead, so only superseded rows offer this.
 */
export function RollbackToRelease({ slug, deployment }: { slug: string; deployment: Deployment }) {
  const flow = useRollbackFlow(slug);
  const eligible = deployment.status.toLowerCase() === 'superseded';
  // Once a rollback starts, its progress outlives the row turning live.
  if (!eligible && !flow.operation) return null;
  const label = deploymentLabel(deployment);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="label-mono text-muted-foreground">
        {eligible ? 'Roll back to this release' : 'Rollback'}
      </p>
      {eligible && (
        <div>
          <Button
            size="xs"
            variant="destructive"
            busy={flow.isPending}
            onClick={() => void flow.start(deployment.id, label)}
          >
            Roll back to {label}
          </Button>
        </div>
      )}
      {flow.operation && (
        <RollbackStatus slug={slug} operation={flow.operation} targetLabel={label} />
      )}
    </div>
  );
}
