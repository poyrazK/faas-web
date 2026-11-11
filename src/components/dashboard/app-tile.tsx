import './bento.css';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { formatRelative, type RunState, type Workflow } from '@/lib/mock-data';
import { StateBadge } from './primitives';
import { runtimeLabel, type DeployNote } from './app-tile-words';

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
 * failing or under way), its name, then what it runs on. No traffic figures:
 * the tile says what the app is; its numbers live on the app's own page.
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

      <p className="mt-auto flex items-center justify-between gap-3 text-xs text-muted-foreground">
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
export function AppTiles({
  label,
  stacked,
  children,
}: {
  label: string;
  /** One tile per row, for a group laid out as a column. */
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <ul aria-label={label} className="app-tiles" data-stacked={stacked || undefined}>
      {children}
    </ul>
  );
}
