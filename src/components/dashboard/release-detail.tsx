import { useEffect, useState } from 'react';
import { RefreshDouble } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  ErrorState,
  InlinePhase,
  LoadingState,
  Panel,
  UnreachableState,
  queryPhase,
} from './primitives';
import { Pill } from './resource-table';
import { useLogStream } from '@/lib/api/logs';
import { useApp, useApps, useBuild, useDeployment } from '@/lib/api/queries';
import { isDeploymentTerminal } from '@/lib/deployment-status';
import { formatRelative } from '@/lib/mock-data';
import { AdvanceCanaryButton, ReorderDeploymentControl } from './deployment-actions';
import { DeploymentAudit, DeploymentPreviewUrl, DeploymentStages } from './deployment-insights';
import { DeploymentReleaseSummary } from './deployment-release-summary';
import { DeploymentLifecycle } from './deployment-lifecycle';
import { DeploymentControls } from './release-controls';
import { ReleaseProvenance, ReleaseScans } from './release-evidence';
import { RELEASE_SECTIONS, sourceSize, type ReleaseSection } from './releases-search';
import { RolloutRecovery } from './rollout-recovery';
import { LogView } from './log-view';

function relativeTime(value?: string): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : formatRelative(timestamp);
}

/** One evidence surface for account and app routes; the caller owns URL state. */
export function ReleaseDetailPanel({
  deploymentId,
  buildId,
  fallbackBuildId,
  appSlug,
  timing,
  section: controlledSection,
  onSectionChange,
  onClose,
}: {
  deploymentId?: string;
  buildId?: string;
  fallbackBuildId?: string;
  appSlug?: string;
  timing?: {
    durationSeconds?: number;
    enqueuedAt: string;
    startedAt?: string;
    finishedAt?: string;
  };
  section?: ReleaseSection;
  onSectionChange?: (section: ReleaseSection, replace?: boolean) => void;
  onClose: () => void;
}) {
  const [localSection, setLocalSection] = useState<ReleaseSection>('overview');
  const section = controlledSection ?? localSection;
  const selectedBuild = useBuild(!deploymentId ? (buildId ?? '') : '');
  const resolvedDeploymentId = deploymentId ?? selectedBuild.data?.deployment_id ?? '';
  const detail = useDeployment(resolvedDeploymentId, {
    refetchInterval: (query) => (isDeploymentTerminal(query.state.data?.status) ? false : 2_500),
  });
  const selectedApp = useApp(appSlug ?? '', { enabled: Boolean(appSlug) });
  const apps = useApps();
  const deployment = resolvedDeploymentId ? detail.data : undefined;
  const wrongApp = Boolean(
    appSlug && selectedApp.data && deployment && deployment.app_id !== selectedApp.data.id
  );
  const ownsDeployment = !appSlug || Boolean(selectedApp.data && deployment && !wrongApp);
  const joinedBuildId =
    deploymentId && ownsDeployment ? (deployment?.build_id ?? fallbackBuildId ?? '') : '';
  const joinedBuild = useBuild(joinedBuildId);
  const buildQuery = deploymentId ? joinedBuild : selectedBuild;
  const build = buildQuery.data;
  const slug = appSlug ?? apps.data?.find((app) => app.id === deployment?.app_id)?.slug;
  const buildLog = useLogStream(
    { kind: 'build', deploymentId: resolvedDeploymentId, limit: 200 },
    Boolean(resolvedDeploymentId) && ownsDeployment
  );
  const error =
    (resolvedDeploymentId ? detail.error : selectedBuild.error) ??
    (appSlug ? selectedApp.error : null);
  const phase = queryPhase({
    error,
    loading:
      (resolvedDeploymentId ? detail.isPending : selectedBuild.isPending) ||
      (Boolean(appSlug) && selectedApp.isPending),
  });
  const retry = () => {
    if (resolvedDeploymentId) void detail.refetch();
    else void selectedBuild.refetch();
    if (appSlug) void selectedApp.refetch();
  };
  const sections = RELEASE_SECTIONS.filter(
    ([value]) => deployment || ['overview', 'output', 'provenance'].includes(value)
  );
  const activeSection = sections.some(([value]) => value === section) ? section : 'overview';
  useEffect(() => {
    if (selectedBuild.data && !resolvedDeploymentId && section !== activeSection) {
      onSectionChange?.(activeSection, true);
    }
  }, [selectedBuild.data, resolvedDeploymentId, section, activeSection, onSectionChange]);

  return (
    <Panel
      title={resolvedDeploymentId ? 'Release details' : 'Build details'}
      description={
        deployment && !wrongApp
          ? `${deployment.kind} · ${deployment.id}`
          : (deploymentId ?? buildId)
      }
      actions={
        <Button size="xs" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {phase === 'unreachable' ? (
        <UnreachableState onRetry={retry} />
      ) : phase === 'loading' ? (
        <LoadingState message="Loading release…" />
      ) : phase === 'error' || (!deployment && !build) ? (
        <ErrorState error={error} onRetry={retry} />
      ) : wrongApp ? (
        <p className="text-sm text-muted-foreground">
          This deployment is not available for the selected app.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <nav
            aria-label="Release detail sections"
            className="flex flex-wrap gap-2 border-b border-border pb-3"
          >
            {sections.map(([value, label]) => (
              <Button
                key={value}
                size="xs"
                variant={value === activeSection ? 'outline' : 'ghost'}
                aria-pressed={value === activeSection}
                onClick={() => (onSectionChange ?? setLocalSection)(value)}
              >
                {label}
              </Button>
            ))}
          </nav>
          {activeSection === 'overview' && (
            <>
              {deployment ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill label={deployment.status} />
                    {!isDeploymentTerminal(deployment.status) && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <RefreshDouble className="h-3 w-3 animate-spin" />
                        Updating
                      </span>
                    )}
                    <span className="ml-auto">
                      <DeploymentPreviewUrl deploymentId={deployment.id} />
                    </span>
                  </div>
                  <EvidenceFields
                    values={[
                      ['Deployment ID', deployment.id],
                      ['Kind', deployment.kind],
                      ['Build ID', deployment.build_id ?? build?.id ?? '—'],
                      ['Image', deployment.image_digest || '—'],
                      ['Created', relativeTime(deployment.created_at)],
                      ['Error code', deployment.error_code ?? '—'],
                      [
                        'Canary',
                        deployment.canary_total_steps
                          ? `${deployment.canary_preset ?? ''} step ${deployment.canary_step ?? 0}/${deployment.canary_total_steps} · ${deployment.rollout_state ?? ''}`.trim()
                          : '—',
                      ],
                      [
                        'Traffic',
                        deployment.traffic_percent != null ? `${deployment.traffic_percent}%` : '—',
                      ],
                    ]}
                  />
                  {deployment.error && (
                    <p
                      role="alert"
                      className="rounded-md border border-border px-3 py-2 text-sm text-[color:var(--status-critical)]"
                    >
                      {deployment.error}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No deployment is attached to this build.
                </p>
              )}
              {build ? (
                <EvidenceFields
                  values={[
                    ['Build status', build.status],
                    ['Source', build.kind],
                    ['Failure class', build.failure_class ?? '—'],
                    ['Source size', sourceSize(build.source_bytes)],
                    [
                      'Build duration',
                      build.duration_seconds == null ? '—' : `${build.duration_seconds}s`,
                    ],
                    ['Enqueued', relativeTime(build.enqueued_at)],
                    ['Started', relativeTime(build.started_at)],
                    ['Finished', relativeTime(build.finished_at)],
                  ]}
                />
              ) : joinedBuildId ? (
                <InlinePhase
                  phase={queryPhase({
                    error: joinedBuild.error,
                    loading: joinedBuild.isPending,
                    isEmpty: !build,
                  })}
                  error={joinedBuild.error}
                  emptyMessage="No build record is available."
                />
              ) : timing ? (
                <EvidenceFields
                  values={[
                    [
                      'Build duration',
                      timing.durationSeconds == null ? '—' : `${timing.durationSeconds}s`,
                    ],
                    ['Enqueued', relativeTime(timing.enqueuedAt)],
                    ['Started', relativeTime(timing.startedAt)],
                    ['Finished', relativeTime(timing.finishedAt)],
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No build is recorded for this release.
                </p>
              )}
              {deployment && slug && (
                <DeploymentReleaseSummary appSlug={slug} deploymentId={deployment.id} />
              )}
            </>
          )}
          {activeSection === 'output' && (
            <div>
              {buildLog.lines.length ? (
                <LogView lines={buildLog.lines} className="max-h-72" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {!resolvedDeploymentId
                    ? 'Build output is available once a deployment is attached.'
                    : buildLog.status === 'connecting'
                      ? 'Reading the build log…'
                      : buildLog.status === 'error'
                        ? `The build log disconnected${buildLog.reason ? `: ${buildLog.reason}` : '.'}`
                        : buildLog.reason || 'No build output has arrived yet.'}
                </p>
              )}
            </div>
          )}
          {activeSection === 'provenance' && (
            <ReleaseProvenance
              buildId={build?.id ?? joinedBuildId}
              succeeded={build?.status === 'succeeded'}
            />
          )}
          {deployment && activeSection === 'scans' && <ReleaseScans deploymentId={deployment.id} />}
          {deployment && activeSection === 'lifecycle' && (
            <>
              <AdvanceCanaryButton deployment={deployment} />
              <ReorderDeploymentControl deployment={deployment} />
              <DeploymentLifecycle key={deployment.id} deployment={deployment} />
              {slug && <RolloutRecovery slug={slug} deployment={deployment} />}
              <DeploymentStages deploymentId={deployment.id} />
            </>
          )}
          {deployment && activeSection === 'runtime' && (
            <DeploymentControls
              key={`${deployment.id}-${deployment.min_instances}-${deployment.traffic_percent}`}
              deployment={deployment}
              version={deployment.id}
            />
          )}
          {deployment && activeSection === 'audit' && (
            <DeploymentAudit deploymentId={deployment.id} />
          )}
        </div>
      )}
    </Panel>
  );
}

function EvidenceFields({ values }: { values: [string, string][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {values.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="label-mono text-muted-foreground">{label}</dt>
          <dd className="truncate font-mono text-xs" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
