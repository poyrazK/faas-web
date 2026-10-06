import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { deploymentRecovery } from '@/lib/deployment-recovery';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useApps, useCancelDeployment, useRetryDeployment } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';

/** Recovery always acts on the selected record, never on the configuration editor. */
export function DeploymentLifecycle({
  deployment,
}: {
  deployment: components['schemas']['DeploymentResponse'];
}) {
  // Reset locks and accepted results if a caller changes the selected release.
  return <RecoveryActions key={deployment.id} deployment={deployment} />;
}

function RecoveryActions({
  deployment,
}: {
  deployment: components['schemas']['DeploymentResponse'];
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const cancel = useCancelDeployment();
  const retry = useRetryDeployment();
  const { data: apps } = useApps();
  const [busy, setBusy] = useState(false);
  const [resultId, setResultId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(false);
  const latestStatus = useRef(deployment.status);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    latestStatus.current = deployment.status;
  }, [deployment.status]);

  const availability = deploymentRecovery(deployment.status);
  const slug = (apps ?? []).find((app) => app.id === deployment.app_id)?.slug;

  const recover = async (action: 'cancel' | 'retry') => {
    if (lock.current || accepted || uncertain || availability.kind !== action) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      if (action === 'cancel' && !slug) {
        setFailure('Could not resolve the app for this deployment. Refresh and try again.');
        return;
      }
      const approved = await confirm(
        action === 'cancel'
          ? {
              title: 'Cancel this deployment?',
              description: `Stop attempt ${deployment.id}. The currently live release keeps serving.`,
              confirmLabel: 'Cancel deployment',
              destructive: true,
            }
          : {
              title: 'Retry this failed deployment?',
              description: `Create a new attempt from release ${deployment.id}'s recorded source/image and release inputs. All build and security stages run again; intermediate checkpoints are not retained. The failed record stays unchanged.`,
              confirmLabel: 'Retry deployment',
            }
      );
      if (!mounted.current || !approved) return;
      if (deploymentRecovery(latestStatus.current).kind !== action) {
        setFailure(
          'The deployment state changed while confirmation was open. Review its current status.'
        );
        return;
      }
      if (action === 'cancel') {
        await cancel.mutateAsync({ slug: slug!, id: deployment.id });
        if (mounted.current) {
          setAccepted(true);
          toast({ kind: 'success', title: 'Deployment cancelled' });
        }
      } else {
        // The API currently rebuilds from the original inputs for every requested
        // stage. Do not offer a checkpoint selector that implies work is skipped.
        const result = await retry.mutateAsync({
          id: deployment.id,
          from_stage: 'source_download',
        });
        if (mounted.current) {
          setAccepted(true);
          if (result.id && result.id !== deployment.id) {
            setResultId(result.id);
            toast({
              kind: 'success',
              title: 'Retry started',
              description: 'View the new attempt below.',
            });
          } else {
            setFailure(
              'The retry was accepted, but the response did not identify a new deployment. Check deployment history before starting another attempt.'
            );
          }
        }
      }
    } catch (error) {
      if (!mounted.current) return;
      let message = errorMessage(error);
      if (error instanceof ApiError && error.status === 409) {
        message =
          error.code === 'source_invalid'
            ? `The original source is unavailable. ${message}`
            : `The deployment cannot be ${action === 'cancel' ? 'cancelled' : 'retried'} in its current state. ${message}`;
      } else if (error instanceof ApiError && error.status === 403) {
        message = `You do not have permission to ${action} this deployment. ${message}`;
      } else if (error instanceof ApiError && error.status === 404) {
        message = `This deployment is unavailable to your account. ${message}`;
      }
      // A dropped/5xx response can arrive after a non-idempotent retry committed.
      // Disable another retry until the user has inspected history/refreshed.
      if (action === 'retry' && (!(error instanceof ApiError) || error.status >= 500)) {
        setUncertain(true);
        message += ' The outcome is unknown. Check deployment history before retrying again.';
      }
      setFailure(message);
      toast({ kind: 'error', title: `Could not ${action}`, description: message });
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="label-mono mb-3 text-muted-foreground">Lifecycle</p>
      <p className="mb-3 text-xs text-muted-foreground">{availability.explanation}</p>
      {availability.kind === 'cancel' && (
        <Button
          size="xs"
          variant="outline"
          busy={busy || cancel.isPending}
          disabled={accepted}
          onClick={() => void recover('cancel')}
        >
          Cancel deployment
        </Button>
      )}
      {availability.kind === 'retry' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Rebuild retained source or image using this release’s recorded inputs. All build and
            security stages run again. Intermediate checkpoints are not retained.
          </p>
          <Button
            size="xs"
            variant="outline"
            busy={busy || retry.isPending}
            disabled={accepted || uncertain}
            onClick={() => void recover('retry')}
          >
            Retry deployment
          </Button>
        </div>
      )}
      {failure && (
        <p
          role="alert"
          className="mt-3 whitespace-pre-wrap text-sm text-status-critical [overflow-wrap:anywhere]"
        >
          {failure}
        </p>
      )}
      {(uncertain || (accepted && !resultId && availability.kind === 'retry')) && (
        <Link
          to="/dashboard/deployments"
          search={{}}
          className="mt-2 inline-block text-sm text-brand underline-offset-4 hover:underline"
        >
          Check deployment history
        </Link>
      )}
      {resultId && (
        <div role="status" className="mt-3 rounded-md border border-brand/25 p-3 text-sm">
          <p>The retry was accepted as a new deployment. This failed record is unchanged.</p>
          <Link
            to="/dashboard/deployments"
            search={{ deployment: resultId, releaseSection: 'overview' }}
            className="mt-2 inline-block text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            View new deployment
          </Link>
        </div>
      )}
    </div>
  );
}
