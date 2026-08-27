import { Check, Circle, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { useDeployment } from '@/lib/api/queries';
import {
  deploymentPhase,
  isDeploymentTerminal,
  type DeploymentPhase,
} from '@/lib/deployment-status';
import { cn } from '@/lib/utils';

type StepState = 'pending' | 'active' | 'done' | 'failed';

const STEPS = ['App created', 'Build', 'Live'] as const;

function stepState(index: number, appCreated: boolean, phase: DeploymentPhase): StepState {
  if (index === 0) return appCreated ? 'done' : 'active';
  if (index === 1) {
    if (phase === 'failed') return 'failed';
    if (phase === 'live') return 'done';
    return appCreated ? 'active' : 'pending';
  }
  return phase === 'live' ? 'done' : 'pending';
}

export function DeploymentProgress({
  appCreated,
  appName,
  deploymentId,
  repo,
  ref,
  submissionError,
}: {
  appCreated: boolean;
  appName: string;
  deploymentId: string | null;
  repo: string;
  ref: string;
  submissionError?: string | null;
}) {
  const statusQuery = useDeployment(deploymentId ?? '', {
    refetchInterval: (query) => {
      if (!deploymentId || isDeploymentTerminal(query.state.data?.status)) return false;
      return 2_500;
    },
  });
  const deployment = statusQuery.data;
  const phase = deploymentPhase(deployment?.status);
  const hasBuild = Boolean(deploymentId);
  const live = phase === 'live';
  const failed = phase === 'failed' || Boolean(submissionError);
  const progress = !appCreated ? 8 : live ? 100 : failed ? 66 : hasBuild ? 50 : 33;

  const title = !appCreated
    ? 'Creating app'
    : submissionError
      ? 'Build submission failed'
      : !hasBuild
        ? 'Submitting build'
        : live
          ? 'Deployment live'
          : failed
            ? 'Deployment failed'
            : 'Build in progress';

  const description = !appCreated
    ? `Creating ${appName} with the configuration you reviewed.`
    : submissionError
      ? 'The app was created, but the first deployment could not be submitted.'
      : !hasBuild
        ? 'The app exists. The first deployment is being submitted to the builder.'
        : live
          ? `${appName} is live. This status came from the deployment API.`
          : failed
            ? 'The deployment API reported a failure. Review the error below and try again from the app page.'
            : 'The deployment is queued or building. This page refreshes its real status automatically.';

  const statusText = !appCreated
    ? 'Creating app…'
    : submissionError
      ? 'Build submission failed'
      : !hasBuild
        ? 'Submitting first build…'
        : statusQuery.isError
          ? 'Unable to refresh deployment status'
          : deployment?.status
            ? `Deployment status: ${deployment.status}`
            : 'Waiting for the builder…';

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="h-0.5 w-full bg-muted">
        <div
          className="h-full bg-brand transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium">{title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </div>
          {hasBuild && !live && !failed && (
            <RefreshDouble className="h-4 w-4 shrink-0 animate-spin text-brand" aria-hidden />
          )}
          {live && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
          {failed && (
            <WarningTriangle
              className="h-4 w-4 shrink-0"
              style={{ color: 'var(--status-critical)' }}
              aria-hidden
            />
          )}
        </div>

        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {statusText}
        </p>

        <ol className="mt-5 flex flex-col gap-1">
          {STEPS.map((label, index) => {
            const state = stepState(index, appCreated, failed ? 'failed' : phase);
            return (
              <li
                key={label}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm',
                  state === 'pending' && 'text-muted-foreground/50',
                  state === 'active' && 'bg-muted text-foreground',
                  state === 'done' && 'text-muted-foreground',
                  state === 'failed' && 'text-[color:var(--status-critical)]'
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {state === 'done' && <Check className="h-3.5 w-3.5 text-brand" />}
                  {state === 'active' && (
                    <RefreshDouble className="h-3.5 w-3.5 animate-spin text-brand" />
                  )}
                  {state === 'failed' && <WarningTriangle className="h-3.5 w-3.5" />}
                  {state === 'pending' && <Circle className="h-2.5 w-2.5" />}
                </span>
                {label}
              </li>
            );
          })}
        </ol>

        <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>
            Source{' '}
            <span className="font-mono text-foreground">
              {repo}@{ref || 'main'}
            </span>
          </p>
          {deploymentId && (
            <p className="mt-1">
              Deployment <span className="font-mono text-foreground">{deploymentId}</span>
            </p>
          )}
          {statusQuery.isError && (
            <p className="mt-2" style={{ color: 'var(--status-warning)' }}>
              {statusText}. We’ll keep trying to read the server state.
            </p>
          )}
          {deployment?.error && (
            <p className="mt-2" style={{ color: 'var(--status-critical)' }}>
              {deployment.error}
            </p>
          )}
          {submissionError && (
            <p className="mt-2" style={{ color: 'var(--status-critical)' }}>
              {submissionError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
