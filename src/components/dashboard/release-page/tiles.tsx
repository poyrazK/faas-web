import { formatPercent } from '@/lib/usage-format';
import { ApiError } from '@/lib/api/errors';
import { isDeploymentTerminal } from '@/lib/deployment-status';
import { useDeploymentRuntime, useReleaseDiff } from '@/lib/api/deployment-detail';
import {
  useBuildProvenance,
  useDeploymentAudit,
  useDeploymentScan,
  useDeploymentSecretScan,
} from '@/lib/api/queries';
import { queryPhase } from '../primitives';
import { CanaryHealth } from '../canary-health';
import { DeploymentDiff } from '../deployment-diff';
import { AUDIT_LABEL, DeploymentAudit } from '../deployment-insights';
import { DeploymentReleaseSummary } from '../deployment-release-summary';
import { DeploymentRuntime } from '../deployment-runtime';
import { LogStreamRecovery } from '../log-stream-recovery';
import { LogView } from '../log-view';
import { DeploymentControls } from '../release-controls';
import { ReleaseCommand } from '../release-command';
import { ReleaseProvenance, ReleaseScans } from '../release-evidence';
import { ResourceActivityTimeline } from '../resource-activity';
import { relativeTime } from './facts';
import type { ReleaseContext } from './release-page';
import { ReleaseTile, type ReleaseTileSpec } from './tile';
import { RolloutPopup } from './rollout-popup';

const notFound = (error: unknown) =>
  error instanceof ApiError && (error.code === 'not_found' || error.status === 404);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function seconds(from?: string | null, to?: string | null): string | undefined {
  if (!from || !to) return undefined;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? `${Math.round(ms / 1000)}s` : undefined;
}

function ChangesTile({ ctx, onOpen }: { ctx: ReleaseContext; onOpen: () => void }) {
  const diff = useReleaseDiff(ctx.deployment.id);
  const summary = diff.data?.summary?.trim();
  return (
    <ReleaseTile
      title="What changed"
      span={2}
      phase={
        notFound(diff.error)
          ? 'empty'
          : queryPhase({ error: diff.error, loading: diff.isPending, isEmpty: !summary })
      }
      error={diff.error}
      onRetry={() => void diff.refetch()}
      value={summary}
      emptyMessage="No earlier release to compare"
      hint="Open the full diff"
      onOpen={onOpen}
    />
  );
}

function OutputTile({ ctx, onOpen }: { ctx: ReleaseContext; onOpen: () => void }) {
  const lines = ctx.buildLog.lines.slice(-2);
  const took = ctx.build?.duration_seconds;
  return (
    <ReleaseTile
      title="Build output"
      span={2}
      phase={lines.length ? 'ready' : 'empty'}
      value={
        <span className="well block rounded-lg bg-muted/40 px-3 py-2 font-mono text-xs leading-5 font-normal">
          {lines.map((line) => (
            <span key={line.id} className="block truncate">
              {line.text}
            </span>
          ))}
        </span>
      }
      line={took == null ? undefined : `Built in ${took}s`}
      emptyMessage={
        took == null ? 'No build output has arrived yet.' : `Built in ${took}s · no output kept`
      }
      hint="Open the full log"
      onOpen={onOpen}
    />
  );
}

function OutputPopup({ ctx }: { ctx: ReleaseContext }) {
  const log = ctx.buildLog;
  return (
    <div className="flex flex-col gap-3">
      <LogStreamRecovery
        status={log.status}
        reason={log.reason}
        canRetry={log.canRetry}
        retry={log.retry}
      />
      {log.lines.length ? (
        <LogView lines={log.lines} className="max-h-[60dvh]" />
      ) : (
        <p className="text-sm text-muted-foreground">
          {log.status === 'connecting' || log.status === 'reconnecting'
            ? 'Reading the build log…'
            : log.status === 'error'
              ? `The build log disconnected${log.reason ? `: ${log.reason}` : '.'}`
              : log.reason || 'No build output has arrived yet.'}
        </p>
      )}
    </div>
  );
}

function RolloutTile({ ctx, onOpen }: { ctx: ReleaseContext; onOpen: () => void }) {
  const d = ctx.deployment;
  return (
    <ReleaseTile
      title="Traffic & rollout"
      phase="ready"
      value={`${formatPercent(d.traffic_percent ?? 0)}`}
      line={
        d.canary_total_steps
          ? `Canary step ${d.canary_step ?? 0} of ${d.canary_total_steps}`
          : 'No canary'
      }
      hint="Promote, schedule, approvals"
      onOpen={onOpen}
    />
  );
}

const RUNTIME_LINE: Record<string, string> = {
  pinned: 'Runtime pinned to this release',
  unknown: 'Runtime not recorded',
  unsupported: 'Runtime pinning not supported',
};

function RuntimeTile({ ctx, onOpen }: { ctx: ReleaseContext; onOpen: () => void }) {
  const runtime = useDeploymentRuntime(ctx.deployment.id);
  const warm = ctx.deployment.min_instances ?? 0;
  return (
    <ReleaseTile
      title="Runtime"
      phase={queryPhase({ error: runtime.error, loading: runtime.isPending })}
      error={runtime.error}
      onRetry={() => void runtime.refetch()}
      value={warm ? `${warm} kept warm` : 'Scales from zero'}
      line={runtime.data ? (RUNTIME_LINE[runtime.data.status] ?? runtime.data.status) : undefined}
      hint="Instances and settings"
      onOpen={onOpen}
    />
  );
}

function SecurityTile({ ctx, onOpen }: { ctx: ReleaseContext; onOpen: () => void }) {
  const scan = useDeploymentScan(ctx.deployment.id);
  const secrets = useDeploymentSecretScan(ctx.deployment.id);
  const counts = scan.data?.severity_counts;
  // Only a secret scan that answered can say what it found.
  const found = secrets.data?.findings?.length;
  const secretLine = secrets.isPending
    ? 'checking secrets…'
    : found === undefined
      ? 'secrets not scanned'
      : found
        ? `${plural(found, 'secret')} found`
        : 'no secrets found';
  const scanned = Boolean(counts) && scan.data?.status === 'complete';
  return (
    <ReleaseTile
      title="Security"
      phase={
        notFound(scan.error)
          ? 'empty'
          : queryPhase({ error: scan.error, loading: scan.isPending, isEmpty: !scanned })
      }
      error={scan.error}
      onRetry={() => void scan.refetch()}
      value={`${counts?.critical ?? 0} critical`}
      line={`${counts?.high ?? 0} high · ${secretLine}`}
      emptyMessage={
        !isDeploymentTerminal(ctx.deployment.status)
          ? 'Scanned after the build'
          : scan.data?.status === 'pending'
            ? 'Scanning…'
            : 'Not scanned'
      }
      hint="All findings"
      onOpen={onOpen}
    />
  );
}

function ProvenanceTile({ ctx, onOpen }: { ctx: ReleaseContext; onOpen: () => void }) {
  const provenance = useBuildProvenance(ctx.deployment.build_id ?? '');
  const commit = provenance.data?.commit_sha?.slice(0, 7);
  return (
    <ReleaseTile
      title="Provenance"
      phase={
        notFound(provenance.error)
          ? 'empty'
          : queryPhase({
              error: provenance.error,
              loading: provenance.isPending,
              isEmpty: !provenance.data,
            })
      }
      error={provenance.error}
      onRetry={() => void provenance.refetch()}
      value={commit ? <span className="font-mono">{commit}</span> : 'No commit recorded'}
      line={provenance.data?.sbom_storage_key ? 'SBOM ready' : 'No SBOM'}
      emptyMessage={
        isDeploymentTerminal(ctx.deployment.status)
          ? 'No provenance recorded'
          : 'Recorded when the build finishes'
      }
      hint="Build inputs and SBOM"
      onOpen={onOpen}
    />
  );
}

function ReleaseCommandTile({ ctx, onOpen }: { ctx: ReleaseContext; onOpen: () => void }) {
  const run = ctx.deployment.release;
  const took = seconds(run?.started_at, run?.finished_at);
  return (
    <ReleaseTile
      title="Release command"
      phase="ready"
      value={<span className="capitalize">{run?.status.replace('_', ' ')}</span>}
      line={took ? `Took ${took}` : undefined}
      hint="Its output"
      onOpen={onOpen}
    />
  );
}

function CanaryTile({ ctx, onOpen }: { ctx: ReleaseContext; onOpen: () => void }) {
  const d = ctx.deployment;
  return (
    <ReleaseTile
      title="Canary health"
      phase="ready"
      value={`Step ${d.canary_step ?? 0} of ${d.canary_total_steps}`}
      line={d.rollout_state ? d.rollout_state.replace(/_/g, ' ') : undefined}
      hint="Compare with the stable release"
      onOpen={onOpen}
    />
  );
}

function ActivityTile({ ctx, onOpen }: { ctx: ReleaseContext; onOpen: () => void }) {
  const audit = useDeploymentAudit(ctx.deployment.id, 1);
  const latest = audit.data?.items?.[0];
  return (
    <ReleaseTile
      title="Activity"
      span={2}
      phase={queryPhase({ error: audit.error, loading: audit.isPending, isEmpty: !latest })}
      error={audit.error}
      onRetry={() => void audit.refetch()}
      value={
        latest
          ? `${AUDIT_LABEL[latest.kind] ?? latest.kind}${latest.actor ? ` by ${latest.actor}` : ''}`
          : undefined
      }
      line={latest ? relativeTime(latest.at) : undefined}
      emptyMessage="No activity recorded yet"
      hint="Full history and audit"
      onOpen={onOpen}
    />
  );
}

/** Every tile on a release page, in grid order, and the popup each opens. */
export const RELEASE_TILES: ReleaseTileSpec[] = [
  {
    panel: 'changes',
    title: 'What changed',
    span: 2,
    width: 'max-w-5xl',
    Tile: ChangesTile,
    Popup: ({ ctx }) => (
      <div className="flex flex-col gap-5">
        <DeploymentReleaseSummary
          appSlug={ctx.slug}
          deploymentId={ctx.deployment.id}
          showRollback={false}
        />
        <DeploymentDiff
          deploymentId={ctx.deployment.id}
          slug={ctx.slug}
          deployment={ctx.deployment}
        />
      </div>
    ),
  },
  {
    panel: 'output',
    title: 'Build output',
    span: 2,
    width: 'max-w-5xl',
    Tile: OutputTile,
    Popup: OutputPopup,
  },
  {
    panel: 'rollout',
    title: 'Traffic & rollout',
    Tile: RolloutTile,
    Popup: RolloutPopup,
  },
  {
    panel: 'runtime',
    title: 'Runtime',
    Tile: RuntimeTile,
    Popup: ({ ctx }) => (
      <div className="flex flex-col gap-5">
        <DeploymentControls
          key={`${ctx.deployment.id}-${ctx.deployment.min_instances}-${ctx.deployment.traffic_percent}`}
          slug={ctx.slug}
          deployment={ctx.deployment}
          version={ctx.deployment.id}
        />
        <DeploymentRuntime deploymentId={ctx.deployment.id} />
      </div>
    ),
  },
  {
    panel: 'security',
    title: 'Security',
    Tile: SecurityTile,
    Popup: ({ ctx }) => <ReleaseScans deploymentId={ctx.deployment.id} />,
  },
  {
    panel: 'provenance',
    title: 'Provenance',
    when: (ctx) => Boolean(ctx.deployment.build_id),
    Tile: ProvenanceTile,
    Popup: ({ ctx }) => (
      <ReleaseProvenance
        buildId={ctx.deployment.build_id ?? ''}
        succeeded={ctx.build?.status === 'succeeded'}
      />
    ),
  },
  {
    panel: 'release-command',
    title: 'Release command',
    when: (ctx) => Boolean(ctx.deployment.release),
    Tile: ReleaseCommandTile,
    Popup: ({ ctx }) => <ReleaseCommand slug={ctx.slug} deployment={ctx.deployment} />,
  },
  {
    panel: 'canary',
    title: 'Canary health',
    when: (ctx) => Boolean(ctx.deployment.canary_total_steps),
    Tile: CanaryTile,
    Popup: ({ ctx }) => <CanaryHealth slug={ctx.slug} deploymentId={ctx.deployment.id} />,
  },
  {
    panel: 'activity',
    title: 'Activity',
    span: 2,
    Tile: ActivityTile,
    Popup: ({ ctx }) => (
      <div className="flex flex-col gap-5">
        <ResourceActivityTimeline
          appId={ctx.deployment.app_id}
          appSlug={ctx.slug}
          deploymentId={ctx.deployment.id}
        />
        <DeploymentAudit deploymentId={ctx.deployment.id} />
      </div>
    ),
  },
];
