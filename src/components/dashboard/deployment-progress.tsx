import { useRef } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, OpenNewWindow, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { useDeployment } from '@/lib/api/queries';
import { deploymentPhase, isDeploymentTerminal } from '@/lib/deployment-status';
import { useLogStream } from '@/lib/api/logs';
import { LogView } from './log-view';
import { FailurePanel } from './failure-panel';
import { failureSummary } from './failure-summary';

// These are server states, not a simulated percentage or a timed sequence.
const ACTIVE_STATES: Record<string, [string, string]> = {
  pending: ['Queued for build', 'Your deployment was accepted and is waiting for a builder.'],
  queued: ['Queued for build', 'Your deployment was accepted and is waiting for a builder.'],
  building: [
    'Building your app',
    'The builder is processing your source. Build output is available below.',
  ],
  imaging: ['Preparing the image', 'The platform is preparing the image for your app.'],
  snapshotting: ['Preparing the runtime', 'The platform is preparing your app’s runtime snapshot.'],
  deploying: ['Deploying your app', 'Your deployment is being prepared to serve traffic.'],
  dispatching: ['Dispatching your app', 'Your deployment is being dispatched to a worker.'],
};

export function DeploymentProgress({
  appCreated,
  appName,
  deploymentId,
  repo,
  sourceRef,
  submissionError,
  endpoint,
}: {
  appCreated: boolean;
  appName: string;
  deploymentId: string | null;
  repo: string;
  sourceRef: string;
  submissionError?: string | null;
  endpoint?: string | null;
}) {
  const navigate = useNavigate();
  const outputRef = useRef<HTMLDetailsElement>(null);
  const statusQuery = useDeployment(deploymentId ?? '', {
    refetchInterval: (query) => {
      if (!deploymentId || isDeploymentTerminal(query.state.data?.status)) return false;
      return 2_500;
    },
  });
  const buildLog = useLogStream(
    { kind: 'build', deploymentId: deploymentId ?? '', limit: 200 },
    Boolean(deploymentId)
  );
  const deployment = deploymentId ? statusQuery.data : undefined;
  const status = deployment?.status?.toLowerCase();
  const phase = deploymentPhase(status);
  const unavailable = Boolean(deploymentId && statusQuery.isError);
  const live = phase === 'live' && !unavailable && !submissionError;
  const superseded = phase === 'superseded';
  const failed = Boolean(submissionError) || (phase === 'failed' && !unavailable);
  const cancelled = status === 'cancelled';

  const [title, description] = !appCreated
    ? ['Creating app', `Saving the configuration for ${appName}.`]
    : submissionError
      ? [
          'Build submission failed',
          'Your app was created. Retry below without creating another app.',
        ]
      : unavailable
        ? [
            'Status temporarily unavailable',
            'We can’t confirm the latest deployment state. This does not mean the deployment failed.',
          ]
        : !deploymentId
          ? [
              'Submitting your deployment',
              'Your app is created. We’re sending its source to the builder.',
            ]
          : live
            ? ['Your app is live', `${appName} is ready to receive requests.`]
            : superseded
              ? [
                  'Replaced by a newer deployment',
                  'This deployment is no longer serving. View your app to check the current release.',
                ]
              : cancelled
                ? [
                    'Deployment cancelled',
                    'This deployment was stopped. Your app still exists; you can start another deployment from its page.',
                  ]
                : failed
                  ? [
                      'Deployment failed',
                      'Your app is saved. Review the cause below, then open the deployment to inspect it and retry.',
                    ]
                  : status
                    ? (ACTIVE_STATES[status] ?? [
                        'Deployment in progress',
                        `The platform reports “${deployment?.status}”. Waiting for a confirmed live state.`,
                      ])
                    : [
                        'Reading deployment status',
                        'Your deployment was accepted. Waiting for its current status.',
                      ];

  return (
    <section
      aria-label="First deployment"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-1 shrink-0">
            {live ? (
              <Check className="h-5 w-5 text-brand" />
            ) : failed || unavailable || superseded ? (
              <WarningTriangle
                className="h-5 w-5"
                style={{ color: failed ? 'var(--status-critical)' : 'var(--status-warning)' }}
              />
            ) : (
              <RefreshDouble className="h-5 w-5 animate-spin text-brand motion-reduce:animate-none" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-medium tracking-tight">{title}</h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {title}
        </p>

        {failed && !submissionError && !cancelled && deployment ? (
          <div className="mt-5">
            <FailurePanel
              summary={failureSummary({ deployment })}
              onViewOutput={() => {
                if (!outputRef.current) return;
                outputRef.current.open = true;
                outputRef.current.querySelector('summary')?.focus();
                outputRef.current.scrollIntoView({ block: 'nearest' });
              }}
              onRetryOptions={
                deployment.status === 'failed'
                  ? () => {
                      void navigate({
                        to: '/dashboard/deployments',
                        search: { deployment: deployment.id, releaseSection: 'lifecycle' },
                      });
                    }
                  : undefined
              }
            />
          </div>
        ) : (
          failed && (
            <div
              role="alert"
              className="mt-5 rounded-lg border border-[color:var(--status-critical)]/30 p-4"
            >
              <p className="whitespace-pre-wrap break-words text-sm">
                {submissionError ||
                  deployment?.error ||
                  (cancelled
                    ? 'The deployment was cancelled.'
                    : 'No failure explanation was returned. Open the deployment to inspect its logs.')}
              </p>
            </div>
          )
        )}
        {unavailable && (
          <Button
            className="mt-4"
            variant="outline"
            size="sm"
            busy={statusQuery.isFetching}
            onClick={() => void statusQuery.refetch()}
          >
            Refresh status
          </Button>
        )}

        {endpoint && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-xs text-muted-foreground">
                App endpoint{!live && ' · available when live'}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="min-w-0 break-all font-mono text-sm">{endpoint}</span>
                {live && <CopyIconButton text={endpoint} label="Copy app endpoint" />}
              </div>
            </div>
            {live && (
              <Button asChild variant="cta">
                <a href={endpoint} target="_blank" rel="noopener noreferrer">
                  Open app
                  <OpenNewWindow aria-hidden />
                </a>
              </Button>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="min-w-0 break-all text-xs text-muted-foreground">
            Source{' '}
            <span className="font-mono text-foreground">
              {repo}@{sourceRef.trim() || 'main'}
            </span>
          </p>
          {deploymentId && (
            <Link
              to="/dashboard/deployments"
              search={{ deployment: deploymentId, releaseSection: 'overview' }}
              className="text-xs text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
            >
              Review deployment
            </Link>
          )}
        </div>

        {deploymentId && (
          <details
            ref={outputRef}
            key={deploymentId}
            open={failed || undefined}
            className="mt-4 border-t border-border pt-4"
          >
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand">
              Build output
            </summary>
            <div className="mt-3">
              {buildLog.lines.length > 0 ? (
                <LogView lines={buildLog.lines} className="max-h-64" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {buildLog.status === 'connecting'
                    ? 'Connecting to the build log…'
                    : buildLog.status === 'error'
                      ? 'The build log disconnected. Review the deployment for more details.'
                      : 'No build output has arrived yet.'}
                </p>
              )}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
