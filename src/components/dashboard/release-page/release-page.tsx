import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { components } from '@/lib/api/schema';
import {
  keys,
  useApp,
  useBuild,
  useDeployment,
  useDeploymentSummary,
  type Deployment,
  type DeploymentSummary,
} from '@/lib/api/queries';
import { deploymentPhase, isDeploymentTerminal } from '@/lib/deployment-status';
import { releaseProcess } from '@/lib/release-process';
import { useDocumentTitle } from '@/lib/seo';
import { useLogStream } from '@/lib/api/logs';
import { ErrorState, LoadingState, UnreachableState, queryPhase } from '../primitives';
import { FailurePanel } from '../failure-panel';
import { failureSummary } from '../failure-summary';
import { ReleaseProcess } from '../release-process';
import { ReleaseDetailsPopup, ReleaseFacts, relativeTime } from './facts';
import { ReleaseHeader, releaseName } from './release-header';
import { ReleasePanelHost, useReleasePanel, type ReleasePanelSpec } from './panel-host';
import type { ReleasePanel } from './panels';
import { ReleaseTileGrid } from './tile';
import { RELEASE_TILES } from './tiles';
import { ReleaseMainAction } from './main-action-button';
import { ReleaseAPISandboxes } from './api-sandboxes';
import type { RolloutGroup } from './rollout-popup';

export type Build = components['schemas']['BuildResponse'];

/** What every tile and popup on a release page reads. */
export interface ReleaseContext {
  slug: string;
  deployment: Deployment;
  build?: Build;
  summary?: DeploymentSummary;
  /** One build-log stream per page, shared by the tile and its popup. */
  buildLog: ReturnType<typeof useLogStream>;
}

/** A release's own page: header, failure, process, tiles and facts. */
export function ReleasePage({
  appSlug,
  deploymentId,
  openAPISandboxes = false,
  initialSandboxScenario,
}: {
  appSlug: string;
  deploymentId: string;
  openAPISandboxes?: boolean;
  initialSandboxScenario?: string;
}) {
  const app = useApp(appSlug);
  const detail = useDeployment(deploymentId, {
    refetchInterval: (query) => (isDeploymentTerminal(query.state.data?.status) ? false : 2_500),
  });
  const deployment = detail.data;
  const wrongApp = Boolean(app.data && deployment && deployment.app_id !== app.data.id);
  const owned = app.data && deployment && !wrongApp ? deployment : undefined;
  const buildQuery = useBuild(owned?.build_id ?? '');
  const build = buildQuery.data;
  // A release with no build ID has no build to wait for (a disabled read stays pending).
  const buildPhase = owned?.build_id
    ? queryPhase({ error: buildQuery.error, loading: buildQuery.isPending, isEmpty: !build })
    : 'empty';
  const summary = useDeploymentSummary(owned ? appSlug : '', owned?.id ?? '').data;
  const buildLog = useLogStream(
    { kind: 'build', deploymentId: owned?.id ?? '', limit: 500 },
    Boolean(owned)
  );
  useRefreshWhenSettled(owned, appSlug);
  const { panel, open, close } = useReleasePanel();
  useDocumentTitle(owned ? `${releaseName(owned)} · ${appSlug}` : undefined);

  const ctx: ReleaseContext | undefined = owned
    ? { slug: appSlug, deployment: owned, build, summary, buildLog }
    : undefined;
  const tiles = ctx ? RELEASE_TILES.filter((tile) => tile.when?.(ctx) ?? true) : [];
  const panels: Partial<Record<ReleasePanel, ReleasePanelSpec>> = ctx
    ? {
        ...Object.fromEntries(
          tiles.map((tile) => [
            tile.panel,
            { title: tile.title, width: tile.width, render: () => <tile.Popup ctx={ctx} /> },
          ])
        ),
        details: {
          title: 'All details',
          render: () => (
            <ReleaseDetailsPopup
              deployment={ctx.deployment}
              build={ctx.build}
              buildPhase={buildPhase}
              buildError={buildQuery.error}
              onRetryBuild={() => void buildQuery.refetch()}
            />
          ),
        },
      }
    : {};

  // A popup this release does not have (an old link, a hand-edited URL) closes quietly.
  const unknownPanel = Boolean(ctx && panel && !panels[panel]);
  useEffect(() => {
    if (unknownPanel) close();
  }, [unknownPanel, close]);

  // A failed refresh of a page already on screen keeps what it shows (and any
  // open popup); only a read that never answered replaces the page.
  const blockingError = (!app.data && app.error) || (!detail.data && detail.error) || null;
  const phase = queryPhase({
    error: blockingError,
    loading: app.isPending || detail.isPending,
  });
  const retry = () => {
    void app.refetch();
    void detail.refetch();
  };
  if (phase === 'unreachable') return <UnreachableState onRetry={retry} />;
  if (phase === 'loading') return <LoadingState message="Loading release…" />;
  if (phase === 'error') return <ErrorState error={blockingError} onRetry={retry} />;
  if (wrongApp)
    return <p className="text-sm text-muted-foreground">This release is not part of this app.</p>;
  if (!ctx) return <ErrorState error={detail.error} onRetry={retry} />;

  const openRollout = (focus?: RolloutGroup) =>
    open('rollout', focus ? `rollout-${focus}` : undefined);
  const failed =
    deploymentPhase(ctx.deployment.status) === 'failed' &&
    ctx.deployment.status.toLowerCase() !== 'cancelled';
  const failedBuild = build?.status === 'failed';

  return (
    <div className="flex flex-col gap-6">
      <ReleaseHeader
        deployment={ctx.deployment}
        actions={<ReleaseMainAction ctx={ctx} onOpenRollout={openRollout} />}
      />
      {(failed || failedBuild) && (
        <FailurePanel
          summary={failureSummary({
            deployment: failed ? ctx.deployment : undefined,
            build: failedBuild ? build : undefined,
          })}
          onViewOutput={() => open('output')}
          onRetryOptions={failed ? () => openRollout('recover') : undefined}
        />
      )}
      <section aria-label="Process" className="well flex flex-col gap-3 rounded-xl bg-muted/40 p-4">
        <p className="text-sm">{shippedLine(ctx.deployment, build)}</p>
        <ReleaseProcess phases={releaseProcess(ctx.deployment)} />
      </section>
      {app.data?.type === 'app' &&
      !app.data.preview_of_slug &&
      ['live', 'superseded'].includes(ctx.deployment.status) ? (
        <ReleaseAPISandboxes
          key={`${ctx.deployment.id}/${openAPISandboxes}/${initialSandboxScenario ?? ''}`}
          slug={appSlug}
          deployment={ctx.deployment.id}
          initialOpen={openAPISandboxes}
          initialScenario={initialSandboxScenario}
        />
      ) : null}
      <ReleaseTileGrid>
        {tiles.map((tile) => (
          <tile.Tile key={tile.panel} ctx={ctx} onOpen={() => open(tile.panel)} />
        ))}
      </ReleaseTileGrid>
      <ReleaseFacts
        deployment={ctx.deployment}
        build={build}
        onOpenDetails={() => open('details')}
      />
      <ReleasePanelHost
        panel={panel}
        onClose={close}
        panels={panels}
        releaseName={releaseName(ctx.deployment)}
      />
    </div>
  );
}

function shippedLine(deployment: Deployment, build?: Build): string {
  const took = build?.duration_seconds == null ? '' : ` · took ${build.duration_seconds}s`;
  const verb = isDeploymentTerminal(deployment.status) ? 'Shipped' : 'Started';
  return `${verb} ${relativeTime(deployment.created_at)}${took}`;
}

/**
 * The scan, provenance, diff, runtime and summary of a release only exist once
 * its build finishes; they are read once, so when the polled release settles
 * they are read again rather than left saying what was true mid-build.
 */
function useRefreshWhenSettled(deployment: Deployment | undefined, slug: string) {
  const client = useQueryClient();
  const settled = deployment ? isDeploymentTerminal(deployment.status) : undefined;
  const was = useRef(settled);
  useEffect(() => {
    const before = was.current;
    was.current = settled;
    if (!deployment || before !== false || settled !== true) return;
    void client.invalidateQueries({ queryKey: ['deployments', deployment.id] });
    void client.invalidateQueries({ queryKey: keys.deploymentSummary(slug, deployment.id) });
    if (deployment.build_id)
      void client.invalidateQueries({ queryKey: ['builds', deployment.build_id] });
  }, [client, deployment, settled, slug]);
}
