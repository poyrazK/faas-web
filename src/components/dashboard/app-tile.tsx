import './bento.css';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { formatRelative, type RunState, type Workflow } from '@/lib/mock-data';
import { StateBadge } from './primitives';
import { compactFigure } from './compact-figure';
import { failingShare, runtimeLabel, type DeployNote } from './app-tile-words';

/** 512 MB stays in megabytes; 2048 MB reads as 2 GB. */
export function memoryOf(mb: number): { value: string; unit: 'MB' | 'GB' } {
  return mb >= 1024
    ? { value: (mb / 1024).toLocaleString('en', { maximumFractionDigits: 1 }), unit: 'GB' }
    : { value: String(mb), unit: 'MB' };
}

/** Live apps first, never-deployed last; a name settles ties. */
const STATE_ORDER: Record<RunState, number> = {
  error: 0,
  deploying: 1,
  running: 2,
  idle: 3,
  undeployed: 4,
};

export function byState(a: Workflow, b: Workflow) {
  return STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name);
}

/**
 * One app as a tile, read top to bottom: is it running (and is a deploy
 * failing or under way), its name, its traffic, then what it runs on. Figures
 * are the store's 24 h reading; with no metrics they say so, never zero.
 */
export function AppTile({
  slug,
  app,
  label,
  deploy,
}: {
  slug: string;
  app?: Workflow;
  /** A project workload's own name, when it differs from the app's. */
  label?: string;
  /** The latest deployment, when it failed or is still running. */
  deploy?: DeployNote | null;
}) {
  const deployed = app && app.state !== 'undeployed';
  const measured = deployed && !app.metricsUnavailable;
  const hasTraffic = measured && app.invocations24h > 0;
  const failing = app ? failingShare(app) : null;
  const runsOn = [
    runtimeLabel(app?.runtime),
    app?.memoryMb ? `${memoryOf(app.memoryMb).value} ${memoryOf(app.memoryMb).unit}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="app-tile" data-state={app?.state ?? 'unknown'}>
      <p className="flex items-center gap-x-1.5 truncate text-xs">
        {app ? (
          <StateBadge state={app.state} />
        ) : (
          <span className="text-muted-foreground">State not loaded</span>
        )}
        {deploy && (
          <span
            className={cn(
              'truncate',
              deploy.tone === 'critical' ? 'text-status-critical' : 'text-status-warning'
            )}
          >
            · {deploy.text} {formatRelative(deploy.at)}
          </span>
        )}
      </p>

      <div className="min-w-0">
        <Link
          to="/dashboard/apps/$appSlug"
          params={{ appSlug: slug }}
          className="app-tile__link block truncate text-lg font-semibold tracking-[-0.01em] text-foreground"
        >
          {app?.name ?? slug}
        </Link>
        {label && <p className="truncate text-[13px] text-muted-foreground">{label}</p>}
      </div>

      {measured ? (
        <div className="mt-auto flex flex-col gap-0.5">
          <p className="tabular-nums">
            <span className="text-[22px] leading-7 tracking-[-0.01em]">
              {compactFigure(app.invocations24h)}
            </span>
            <span className="text-sm text-muted-foreground"> requests in 24 h</span>
          </p>
          {hasTraffic && (
            <p
              className="app-tile__figure text-[13px] text-muted-foreground tabular-nums"
              data-hot={failing != null || undefined}
            >
              {failing != null
                ? `${failing.toFixed(1)}% of requests failed`
                : `${app.errorRatePct.toFixed(2)}% errors`}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-auto text-sm text-muted-foreground">
          {!app
            ? 'Details not loaded'
            : !deployed
              ? 'Not deployed yet'
              : 'Request figures unavailable'}
        </p>
      )}

      <p className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">{runsOn}</span>
        <span className="shrink-0">
          {app?.lastDeployedAt
            ? `deployed ${formatRelative(app.lastDeployedAt)}`
            : 'No deployments'}
        </span>
      </p>
    </li>
  );
}

/** A grid of app tiles; the list's accessible name says whose apps they are. */
export function AppTiles({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="app-tiles">
      {children}
    </ul>
  );
}
