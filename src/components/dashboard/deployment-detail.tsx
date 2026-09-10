import { RefreshDouble } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  ErrorState,
  LoadingState,
  Panel,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useLogStream } from '@/lib/api/logs';
import { useApp, useDeployment } from '@/lib/api/queries';
import { isDeploymentTerminal } from '@/lib/deployment-status';
import { formatRelative } from '@/lib/mock-data';
import { AdvanceCanaryButton, ReorderDeploymentControl } from './deployment-actions';
import { DeploymentAudit, DeploymentPreviewUrl, DeploymentStages } from './deployment-insights';
import { RolloutRecovery } from './rollout-recovery';
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
  appSlug,
  timing,
  onClose,
}: {
  deploymentId: string;
  /** Enables the per-app rollout recovery actions; omitted on account-wide views. */
  appSlug?: string;
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
  const selectedApp = useApp(appSlug ?? '', { enabled: Boolean(appSlug) });
  const deployment = detail.data;
  const appCheckPending = Boolean(appSlug) && selectedApp.isPending;
  const appCheckError = appSlug ? selectedApp.error : null;
  const wrongApp = Boolean(
    appSlug && selectedApp.data && deployment && deployment.app_id !== selectedApp.data.id
  );
  const ownsDeployment = !appSlug || Boolean(selectedApp.data && deployment && !wrongApp);
  const buildLog = useLogStream(
    { kind: 'build', deploymentId, limit: 200 },
    Boolean(deploymentId) && ownsDeployment
  );
  const status = deployment?.status?.toLowerCase() ?? 'unknown';
  const error = detail.error ?? appCheckError;
  // The shared precedence: an unreachable API renders as the quiet outage
  // box, matching the tables beside this panel, not as a red fault.
  const phase = queryPhase({ error, loading: detail.isPending || appCheckPending });
  const retry = () => {
    void detail.refetch();
    if (appSlug) void selectedApp.refetch();
  };

  return (
    <Panel
      title="Deployment details"
      description={deployment && !wrongApp ? `${deployment.kind} · ${deployment.id}` : deploymentId}
      actions={
        <Button size="xs" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {phase === 'unreachable' ? (
        <UnreachableState onRetry={retry} />
      ) : phase === 'loading' ? (
        <LoadingState message="Loading deployment…" />
      ) : phase === 'error' || !deployment ? (
        <ErrorState error={error} onRetry={retry} />
      ) : wrongApp ? (
        <p className="text-sm text-muted-foreground">
          This deployment is not available for the selected app.
        </p>
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
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <DeploymentPreviewUrl deploymentId={deployment.id} />
              <AdvanceCanaryButton deployment={deployment} />
            </span>
          </div>

          <ReorderDeploymentControl deployment={deployment} />
          {appSlug && <RolloutRecovery slug={appSlug} deployment={deployment} />}

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

          <DeploymentStages deploymentId={deployment.id} />
          <DeploymentAudit deploymentId={deployment.id} />
        </div>
      )}
    </Panel>
  );
}
