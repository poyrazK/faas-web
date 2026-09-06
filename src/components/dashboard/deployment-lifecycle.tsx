import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useApps,
  useCancelDeployment,
  useRetryDeployment,
  type RetryStage,
} from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';

/**
 * Cancel an in-flight deployment, or retry a failed one from a chosen stage.
 *
 * Which verb applies is a function of status, so only the applicable one is
 * rendered: offering Cancel on a live deployment would be a button whose only
 * outcome is a 409.
 *
 * Retry does not mutate the failed row — the API duplicates it and answers 202
 * with a new deployment — so the failed row stays visible and the list gains an
 * entry. That is deliberate: the history is supposed to show that a retry
 * happened, not overwrite the failure that prompted it.
 */

/** Statuses where the build is still running and can still be stopped. */
const IN_FLIGHT = new Set(['pending', 'building', 'imaging', 'snapshotting']);

/** ADR-117's closed-6 vocabulary, earliest stage first. */
const STAGES: { value: RetryStage; label: string }[] = [
  { value: 'source_download', label: 'Source download — re-run everything' },
  { value: 'dependency_restore', label: 'Dependency restore' },
  { value: 'image_build', label: 'Image build' },
  { value: 'security_scan', label: 'Security scan' },
  { value: 'snapshot_prepare', label: 'Snapshot prepare' },
  { value: 'readiness', label: 'Readiness' },
];

export function DeploymentLifecycle({
  deployment,
}: {
  deployment: components['schemas']['DeploymentResponse'];
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const cancel = useCancelDeployment();
  const retry = useRetryDeployment();
  const { data: apps } = useApps();
  const [stage, setStage] = useState<RetryStage>('source_download');

  const inFlight = IN_FLIGHT.has(deployment.status);
  const failed = deployment.status === 'failed';
  if (!inFlight && !failed) return null;

  // Cancel is keyed by app slug; the deployment carries only the id.
  const slug = (apps ?? []).find((a) => a.id === deployment.app_id)?.slug;

  const onCancel = async () => {
    if (!slug) {
      toast({ kind: 'error', title: 'Could not resolve the app for this deployment' });
      return;
    }
    if (
      !(await confirm({
        title: 'Cancel this deployment?',
        description: 'The build stops where it is. The currently live deployment keeps serving.',
        confirmLabel: 'Cancel deployment',
        destructive: true,
      }))
    )
      return;

    void cancel
      .mutateAsync({ slug, id: deployment.id })
      .then(() => toast({ kind: 'success', title: 'Deployment cancelled' }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 409) {
          toast({
            kind: 'info',
            title: 'Too late to cancel',
            description: 'This deployment is already live.',
          });
          return;
        }
        toast({ kind: 'error', title: 'Could not cancel', description: errorMessage(err) });
      });
  };

  const onRetry = () => {
    void retry
      .mutateAsync({ id: deployment.id, from_stage: stage })
      .then(() =>
        toast({
          kind: 'success',
          title: 'Retry started',
          description: 'It appears as a new deployment; this one stays as it is.',
        })
      )
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not retry', description: errorMessage(err) })
      );
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="label-mono mb-3 text-muted-foreground">Lifecycle</p>

      {inFlight && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="xs"
            variant="outline"
            busy={cancel.isPending}
            onClick={() => void onCancel()}
          >
            Cancel deployment
          </Button>
          <span className="text-xs text-muted-foreground">
            Stops the build. The live deployment keeps serving.
          </span>
        </div>
      )}

      {failed && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Resume from</span>
            <span className="text-xs text-muted-foreground">
              Earlier stages re-run more work. The retry is recorded as a new deployment.
            </span>
            <select
              aria-label="Resume from"
              value={stage}
              onChange={(e) => setStage(e.target.value as RetryStage)}
              className="mt-1 h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
            >
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <Button size="xs" variant="outline" busy={retry.isPending} onClick={onRetry}>
              Retry deployment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
