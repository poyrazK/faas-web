import { useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { Modal } from '@/components/ui/modal';
import { useLogStream } from '@/lib/api/logs';
import { useBuild } from '@/lib/api/queries';
import { ErrorState, LoadingState, UnreachableState, queryPhase } from './primitives';
import { LogStreamRecovery } from './log-stream-recovery';
import { LogView } from './log-view';
import { ReleaseProvenance } from './release-evidence';
import { SegmentedControl } from './tabs';
import { BuildFields } from './release-page/facts';
import { releaseLink } from './release-page/links';
import type { ReleaseSection } from './releases-search';

const BUILD_SECTIONS = [
  ['overview', 'Overview'],
  ['output', 'Build output'],
  ['provenance', 'Provenance / SBOM'],
] as const satisfies readonly (readonly [ReleaseSection, string])[];

type BuildSection = (typeof BUILD_SECTIONS)[number][0];
const isBuildSection = (value?: string): value is BuildSection =>
  BUILD_SECTIONS.some(([key]) => key === value);

/**
 * One build, from the Releases page's Builds view. A build that became a
 * release links to the release's page; this popup covers what a build has on
 * its own: its facts, its output and its provenance.
 */
export function BuildDetailPanel({
  buildId,
  section,
  onSectionChange,
  onClose,
}: {
  buildId: string;
  section?: ReleaseSection;
  onSectionChange: (section: ReleaseSection, replace?: boolean) => void;
  onClose: () => void;
}) {
  const query = useBuild(buildId);
  const build = query.data;
  const deploymentId = build?.deployment_id || '';
  const active: BuildSection = isBuildSection(section) ? section : 'overview';
  const log = useLogStream({ kind: 'build', deploymentId, limit: 500 }, Boolean(deploymentId));
  const invalid = Boolean(section) && !isBuildSection(section);
  useEffect(() => {
    if (invalid) onSectionChange('overview', true);
  }, [invalid, onSectionChange]);

  const phase = queryPhase({ error: query.error, loading: query.isPending, isEmpty: !build });
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title="Build details" description={buildId}>
      <section
        aria-label="Build details"
        className="max-h-[calc(100dvh-17rem)] overflow-y-auto overscroll-contain p-1"
      >
        {phase === 'unreachable' ? (
          <UnreachableState onRetry={() => void query.refetch()} />
        ) : phase === 'loading' ? (
          <LoadingState message="Loading build…" />
        ) : phase !== 'ready' || !build ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <div className="flex flex-col gap-5">
            <SegmentedControl
              label="Build detail sections"
              value={active}
              options={BUILD_SECTIONS.map(([key, label]) => ({ key, label }))}
              onChange={(value) => onSectionChange(value)}
            />
            {active === 'overview' && (
              <>
                <BuildFields build={build} />
                {deploymentId ? (
                  <Link
                    {...releaseLink(deploymentId)}
                    className="text-sm text-brand underline-offset-4 hover:underline"
                  >
                    Open its release
                  </Link>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No deployment is attached to this build.
                  </p>
                )}
              </>
            )}
            {active === 'output' && (
              <div className="flex flex-col gap-3">
                <LogStreamRecovery
                  status={log.status}
                  reason={log.reason}
                  canRetry={log.canRetry}
                  retry={log.retry}
                />
                {log.lines.length ? (
                  <LogView lines={log.lines} className="max-h-72" />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {!deploymentId
                      ? 'Build output is available once a deployment is attached.'
                      : log.reason || 'No build output has arrived yet.'}
                  </p>
                )}
              </div>
            )}
            {active === 'provenance' && (
              <ReleaseProvenance buildId={build.id} succeeded={build.status === 'succeeded'} />
            )}
          </div>
        )}
      </section>
    </Modal>
  );
}
