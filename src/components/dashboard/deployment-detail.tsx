import { RefreshDouble } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, Panel } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useLogStream } from '@/lib/api/logs';
import { useDeployment } from '@/lib/api/queries';
import { isDeploymentTerminal } from '@/lib/deployment-status';
import { formatRelative } from '@/lib/mock-data';
import { LogView } from './log-view';

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--status-good)',
  complete: 'var(--status-good)',
  completed: 'var(--status-good)',
  succeeded: 'var(--status-good)',
  failed: 'var(--status-critical)',
  error: 'var(--status-critical)',
  crashed: 'var(--status-critical)',
  building: 'var(--status-warning)',
  dispatching: 'var(--status-warning)',
  imaging: 'var(--status-warning)',
  pending: 'var(--status-warning)',
  queued: 'var(--status-warning)',
  running: 'var(--status-warning)',
};

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : formatRelative(timestamp);
}

function durationLabel(seconds: number | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * A refresh-safe detail surface for one deployment.
 *
 * The app page owns the selected id in its URL; this component owns the
 * server-backed detail and build stream. That means a copied history link can
 * be reopened without depending on React state from the original visit.
 */
export function DeploymentDetailPanel({
  deploymentId,
  timing,
  onClose,
}: {
  deploymentId: string;
  timing?: {
    durationSeconds?: number;
    enqueuedAt: string;
    startedAt?: string;
    finishedAt?: string;
  };
  onClose: () => void;
}) {
  const detail = useDeployment(deploymentId, {
    refetchInterval: (query) => (isDeploymentTerminal(query.state.data?.status) ? false : 2_500),
  });
  const buildLog = useLogStream({ kind: 'build', deploymentId, limit: 200 }, Boolean(deploymentId));
  const deployment = detail.data;
  const status = deployment?.status?.toLowerCase() ?? 'unknown';

  return (
    <Panel
      title="Deployment details"
      description={deployment ? `${deployment.kind} · ${deployment.id}` : deploymentId}
      actions={
        <Button size="xs" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {detail.isPending ? (
        <LoadingState message="Loading deployment…" />
      ) : detail.error || !deployment ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill label={deployment.status} color={STATUS_COLOR[status]} />
            {!isDeploymentTerminal(deployment.status) && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshDouble className="h-3 w-3 animate-spin" />
                Updating
              </span>
            )}
          </div>

          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {[
              ['Deployment ID', deployment.id],
              ['Kind', deployment.kind],
              ['Build ID', deployment.build_id ?? '—'],
              ['Image', deployment.image_digest || '—'],
              ['Created', relativeTime(deployment.created_at)],
              ['Enqueued', timing ? relativeTime(timing.enqueuedAt) : '—'],
              ['Started', timing?.startedAt ? relativeTime(timing.startedAt) : '—'],
              ['Finished', timing?.finishedAt ? relativeTime(timing.finishedAt) : '—'],
              ['Build duration', durationLabel(timing?.durationSeconds)],
              ['Error code', deployment.error_code ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-0.5">
                <dt className="label-mono text-muted-foreground">{label}</dt>
                <dd className="truncate font-mono text-xs" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {deployment.error && (
            <p
              role="alert"
              className="rounded-md border px-3 py-2 text-sm"
              style={{
                borderColor: 'color-mix(in oklab, var(--status-critical) 35%, transparent)',
                color: 'var(--status-critical)',
              }}
            >
              {deployment.error}
            </p>
          )}

          <div>
            <p className="label-mono mb-2 text-muted-foreground">Build output</p>
            {buildLog.lines.length > 0 ? (
              <LogView lines={buildLog.lines} className="max-h-72" />
            ) : buildLog.status === 'connecting' ? (
              <p className="text-sm text-muted-foreground">Reading the build log…</p>
            ) : buildLog.status === 'error' ? (
              <p className="text-sm text-muted-foreground">
                The build log disconnected{buildLog.reason ? `: ${buildLog.reason}` : '.'}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {buildLog.reason || 'No build output has arrived yet.'}
              </p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
