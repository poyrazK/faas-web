import { OpenNewWindow } from 'iconoir-react';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useDeploymentAudit,
  useDeploymentPreviewUrl,
  useDeploymentStages,
  type DeploymentStages as Stages,
} from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';

/**
 * The three read-only views the deployment detail panel gained after cancel
 * and retry: the closed-stage summary (ADR-117), the per-deployment preview
 * host, and the audit timeline (ADR-122). Each reads one endpoint and says
 * so when that endpoint has nothing — a deployment that never left the queue
 * has no stages, and a closed preview is a 200 with an empty url, not an
 * error.
 */

const STAGE_LABEL: Record<string, string> = {
  source_download: 'Source download',
  dependency_restore: 'Dependency restore',
  image_build: 'Image build',
  security_scan: 'Security scan',
  snapshot_prepare: 'Snapshot prepare',
  readiness: 'Readiness',
};

const AUDIT_LABEL: Record<string, string> = {
  'deploy.created': 'Created',
  'deploy.traffic_changed': 'Traffic changed',
  'deploy.rolled_back': 'Rolled back',
  'deploy.rolled_forward': 'Rolled forward',
  'deploy.stuck': 'Stuck',
  'deploy.recovered': 'Recovered',
};

function stageLabel(name: string | undefined): string {
  return name ? (STAGE_LABEL[name] ?? name) : '—';
}

function durationMs(ms: number | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : formatRelative(timestamp);
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'not_found';
}

type StageRow = NonNullable<Stages['history']>[number];

export function DeploymentStages({ deploymentId }: { deploymentId: string }) {
  const stages = useDeploymentStages(deploymentId);
  const history: StageRow[] = stages.data?.history ?? [];
  const current = stages.data?.current;

  let body: React.ReactNode;
  if (stages.isPending) {
    body = <p className="text-sm text-muted-foreground">Reading the stage summary…</p>;
  } else if (stages.error && isNotFound(stages.error)) {
    body = (
      <p className="text-sm text-muted-foreground">
        No stage summary was recorded for this deployment.
      </p>
    );
  } else if (stages.error) {
    body = <p className="text-sm text-muted-foreground">{errorMessage(stages.error)}</p>;
  } else if (history.length === 0 && !current) {
    body = <p className="text-sm text-muted-foreground">No stage has closed yet.</p>;
  } else {
    body = (
      <ol className="flex flex-col divide-y divide-border">
        {history.map((row, index) => (
          <li
            key={`${row.name ?? 'stage'}-${index}`}
            className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0"
          >
            <Pill
              label={row.status ?? 'unknown'}
              color={row.status === 'failed' ? 'var(--status-critical)' : 'var(--status-good)'}
            />
            <span className="min-w-0 flex-1 text-sm">{stageLabel(row.name)}</span>
            {row.reason && (
              <span className="min-w-0 truncate text-xs text-muted-foreground" title={row.reason}>
                {row.reason}
              </span>
            )}
            <span className="w-16 text-right font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
              {durationMs(row.duration_ms)}
            </span>
          </li>
        ))}
        {current && (
          <li className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0">
            <Pill label="in progress" color="var(--status-warning)" />
            <span className="min-w-0 flex-1 text-sm">{stageLabel(current)}</span>
            <span className="text-xs text-muted-foreground">
              since {relativeTime(stages.data?.current_started_at)}
            </span>
          </li>
        )}
      </ol>
    );
  }

  return (
    <div>
      <p className="label-mono mb-2 text-muted-foreground">Stages</p>
      {body}
    </div>
  );
}

export function DeploymentPreviewUrl({ deploymentId }: { deploymentId: string }) {
  const preview = useDeploymentPreviewUrl(deploymentId);
  if (preview.isPending) {
    return <span className="text-xs text-muted-foreground">Resolving preview…</span>;
  }
  if (preview.error) {
    return (
      <span className="text-xs text-muted-foreground" title={errorMessage(preview.error)}>
        Preview unavailable
      </span>
    );
  }
  const data = preview.data;
  if (!data?.alive || !data.url) {
    return <Pill label="preview closed" color="var(--status-idle)" />;
  }
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline"
    >
      {data.host ?? data.url}
      <OpenNewWindow className="h-3 w-3" />
    </a>
  );
}

export function DeploymentAudit({ deploymentId }: { deploymentId: string }) {
  const audit = useDeploymentAudit(deploymentId);
  const items = audit.data?.items ?? [];

  let body: React.ReactNode;
  if (audit.isPending) {
    body = <p className="text-sm text-muted-foreground">Reading the audit timeline…</p>;
  } else if (audit.error && isNotFound(audit.error)) {
    body = <p className="text-sm text-muted-foreground">No audit rows for this deployment.</p>;
  } else if (audit.error) {
    body = <p className="text-sm text-muted-foreground">{errorMessage(audit.error)}</p>;
  } else if (items.length === 0) {
    body = <p className="text-sm text-muted-foreground">Nothing has been recorded yet.</p>;
  } else {
    body = (
      <ol className="flex flex-col divide-y divide-border">
        {items.map((row, index) => (
          <li key={`${row.at}-${index}`} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm">{AUDIT_LABEL[row.kind] ?? row.kind}</span>
              <span className="font-mono text-xs text-muted-foreground">{row.actor}</span>
              <span className="ml-auto text-xs text-muted-foreground">{relativeTime(row.at)}</span>
            </div>
            {row.data != null && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Details</summary>
                <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 font-mono">
                  {JSON.stringify(row.data, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
        {audit.data && items.length >= audit.data.limit && (
          <li className="pt-2 text-xs text-muted-foreground">
            Showing the latest {audit.data.limit} rows.
          </li>
        )}
      </ol>
    );
  }

  return (
    <div>
      <p className="label-mono mb-2 text-muted-foreground">Audit timeline</p>
      {body}
    </div>
  );
}
