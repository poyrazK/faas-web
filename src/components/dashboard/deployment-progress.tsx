import { useEffect, useRef } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, NavArrowDown, OpenNewWindow, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { useDeployment, type Deployment } from '@/lib/api/queries';
import { deploymentPhase, isDeploymentTerminal } from '@/lib/deployment-status';
import { useLogStream } from '@/lib/api/logs';
import { LogView } from './log-view';
import { FailurePanel } from './failure-panel';
import { failureSummary } from './failure-summary';
import { AppCallIt } from './call-it';
import { FirstResponse } from './first-response';
import { cn } from '@/lib/utils';

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
// The order the server walks a deployment through, by the statuses that mean
// each stage is under way. An image skips the build.
const SOURCE_STAGES: { label: string; statuses: string[] }[] = [
  { label: 'Queued', statuses: ['pending', 'queued'] },
  { label: 'Build', statuses: ['building'] },
  { label: 'Image', statuses: ['imaging'] },
  { label: 'Runtime', statuses: ['snapshotting', 'deploying', 'dispatching'] },
  { label: 'Live', statuses: [] },
];
const IMAGE_STAGES = SOURCE_STAGES.filter((st) => st.label !== 'Build').map((st) =>
  // An image deployment can report `building` while its image is prepared.
  st.label === 'Image' ? { ...st, statuses: ['building', ...st.statuses] } : st
);

export type DeploymentSource =
  | { kind: 'git'; repo: string; ref: string }
  | { kind: 'image'; reference: string }
  /** Source the console packed itself, such as a function written in New app. */
  | { kind: 'upload'; label: string };

export function DeploymentProgress({
  appCreated,
  appName,
  deploymentId,
  repo,
  sourceRef,
  source,
  submissionError,
  endpoint,
  onLive,
  onTerminal,
  hideRetryOptions = false,
  appSlug,
}: {
  appCreated: boolean;
  appName: string;
  deploymentId: string | null;
  repo?: string;
  sourceRef?: string;
  source?: DeploymentSource;
  submissionError?: string | null;
  endpoint?: string | null;
  onLive?: (deployment: Deployment) => void;
  onTerminal?: (deployment: Deployment) => void;
  hideRetryOptions?: boolean;
  /** Once live, shows how to call the app and tail its logs. */
  appSlug?: string;
}) {
  const navigate = useNavigate();
  const outputRef = useRef<HTMLDetailsElement>(null);
  const statusQuery = useDeployment(deploymentId ?? '', {
    refetchInterval: (query) => {
      if (!deploymentId || isDeploymentTerminal(query.state.data?.status)) return false;
      return 2_500;
    },
  });
  const origin = source ?? { kind: 'git' as const, repo: repo ?? '', ref: sourceRef ?? 'main' };
  const image = origin.kind === 'image';
  const hasBuildOutput = Boolean(deploymentId && (!image || statusQuery.data?.build_id));
  const buildLog = useLogStream(
    { kind: 'build', deploymentId: deploymentId ?? '', limit: 200 },
    hasBuildOutput
  );
  const deployment = deploymentId ? statusQuery.data : undefined;
  const status = deployment?.status?.toLowerCase();
  const phase = deploymentPhase(status);
  const unavailable = Boolean(deploymentId && statusQuery.isError);
  const live = phase === 'live' && !unavailable && !submissionError;
  useEffect(() => {
    if (live && deployment) onLive?.(deployment);
  }, [live, deployment, onLive]);
  useEffect(() => {
    if (deployment && !unavailable && !submissionError && isDeploymentTerminal(deployment.status))
      onTerminal?.(deployment);
  }, [deployment, unavailable, submissionError, onTerminal]);
  const superseded = phase === 'superseded';
  const failed = Boolean(submissionError) || (phase === 'failed' && !unavailable);
  const cancelled = status === 'cancelled';

  const [title, description] = !appCreated
    ? ['Creating app', `Saving the configuration for ${appName}.`]
    : submissionError
      ? [
          image ? 'Image submission failed' : 'Build submission failed',
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
              image
                ? 'Your app is created. We’re submitting its pinned image.'
                : 'Your app is created. We’re sending its source to the builder.',
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
                      hideRetryOptions
                        ? 'Your app is saved. Review the cause below, then retry the original deployment or deploy a fix.'
                        : 'Your app is saved. Review the cause below, then open the deployment to inspect it and retry.',
                    ]
                  : image && ['pending', 'queued', 'building'].includes(status ?? '')
                    ? [
                        'Preparing your image deployment',
                        'The platform is preparing your pinned image. Waiting for a confirmed live state.',
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

  // The stages the server has reported so far. Only while the deployment is
  // moving or live: on a failure the explanation leads, and a status this
  // list does not know is shown as reported rather than placed on it.
  const stages = image ? IMAGE_STAGES : SOURCE_STAGES;
  const reached = live
    ? stages.length - 1
    : status
      ? stages.findIndex((st) => st.statuses.includes(status))
      : -1;
  const showStages =
    Boolean(deploymentId) && !failed && !unavailable && !superseded && !cancelled && reached >= 0;
  const tone = live
    ? 'bg-brand/15 text-brand'
    : failed
      ? 'bg-[color:var(--status-critical)]/15 text-[color:var(--status-critical)]'
      : unavailable || superseded
        ? 'bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)]'
        : 'bg-muted text-brand';

  return (
    <section aria-label="First deployment" className="flex flex-col gap-6">
      <div className="@container flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        <div className="flex items-start gap-3.5 px-4 py-4">
          <span
            aria-hidden
            className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', tone)}
          >
            {live ? (
              <Check className="h-[18px] w-[18px]" />
            ) : failed || unavailable || superseded ? (
              <WarningTriangle className="h-[18px] w-[18px]" />
            ) : (
              <RefreshDouble className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" />
            )}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-base font-medium">{title}</h2>
            <p className="max-w-lg text-[13px] leading-5 text-muted-foreground">{description}</p>
            {unavailable && (
              <Button
                className="mt-2 w-fit"
                variant="outline"
                size="sm"
                busy={statusQuery.isFetching}
                onClick={() => void statusQuery.refetch()}
              >
                Refresh status
              </Button>
            )}
          </div>
          <p aria-live="polite" aria-atomic="true" className="sr-only">
            {title}
          </p>
        </div>

        {showStages && (
          <ol
            aria-label="Deployment stages"
            className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3"
          >
            {stages.map((st, i) => {
              const state = i < reached || live ? 'done' : i === reached ? 'current' : 'upcoming';
              return (
                <li
                  key={st.label}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className="flex items-center gap-2 text-[13px]"
                >
                  {i > 0 && <span aria-hidden className="h-px w-5 bg-border" />}
                  <span aria-hidden className="flex h-4 w-4 items-center justify-center">
                    {state === 'done' ? (
                      <Check className="h-4 w-4 text-brand" />
                    ) : state === 'current' ? (
                      <RefreshDouble className="h-3.5 w-3.5 animate-spin text-brand motion-reduce:animate-none" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-border-secondary" />
                    )}
                  </span>
                  <span
                    className={cn(
                      state === 'current' ? 'font-medium text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {st.label}
                  </span>
                  <span className="sr-only">
                    {state === 'done' ? ', done' : state === 'current' ? ', in progress' : ''}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {failed && !submissionError && !cancelled && deployment ? (
          <div className="px-4 py-4">
            <FailurePanel
              summary={failureSummary({ deployment })}
              onViewOutput={
                !hasBuildOutput
                  ? undefined
                  : () => {
                      if (!outputRef.current) return;
                      outputRef.current.open = true;
                      outputRef.current.querySelector('summary')?.focus();
                      outputRef.current.scrollIntoView({ block: 'nearest' });
                    }
              }
              onRetryOptions={
                deployment.status === 'failed' && !hideRetryOptions
                  ? () => {
                      void navigate({
                        to: '/dashboard/releases',
                        search: { deployment: deployment.id, releaseSection: 'lifecycle' },
                      });
                    }
                  : undefined
              }
            />
          </div>
        ) : (
          failed && (
            <div className="px-4 py-4">
              <div
                role="alert"
                className="rounded-lg border border-[color:var(--status-critical)]/30 p-4"
              >
                <p className="whitespace-pre-wrap break-words text-sm">
                  {submissionError ||
                    deployment?.error ||
                    (cancelled
                      ? 'The deployment was cancelled.'
                      : 'No failure explanation was returned. Open the deployment to inspect its logs.')}
                </p>
              </div>
            </div>
          )
        )}

        {endpoint && (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
              <p className="text-[13px] text-muted-foreground">
                App endpoint{!live && ' · available when live'}
              </p>
              <div className="flex items-center gap-2">
                <span className="min-w-0 break-all font-mono text-sm">{endpoint}</span>
                {live && <CopyIconButton text={endpoint} label="Copy app endpoint" />}
              </div>
            </div>
            {live && (
              <Button asChild variant="cta" size="sm" className="gap-1.5">
                <a href={endpoint} target="_blank" rel="noopener noreferrer">
                  Open app
                  <OpenNewWindow aria-hidden />
                </a>
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
            <p className="text-[13px] text-muted-foreground">Source</p>
            <p className="min-w-0 break-all font-mono text-sm">
              {origin.kind === 'image'
                ? origin.reference
                : origin.kind === 'upload'
                  ? origin.label
                  : `${origin.repo}@${origin.ref.trim() || 'main'}`}
            </p>
          </div>
          {deploymentId && (
            <Link
              to="/dashboard/releases"
              search={{ deployment: deploymentId, releaseSection: 'overview' }}
              className="text-[13px] text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
            >
              Review deployment
            </Link>
          )}
        </div>

        {hasBuildOutput && (
          <details
            ref={outputRef}
            key={deploymentId}
            open={failed || undefined}
            className="group/out"
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
              Build output
              <NavArrowDown
                aria-hidden
                className="h-4 w-4 transition-transform group-open/out:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <div className="px-4 pb-4">
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

      {/* An explicit request to the public host, separate from deployment
          status: only when asked, and never counted as verification on failure. */}
      {live && endpoint && <FirstResponse key={`response-${deploymentId}`} endpoint={endpoint} />}
      {live && appSlug && <AppCallIt slug={appSlug} />}
    </section>
  );
}
