import './bento.css';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { formatRelative, type RunState, type Workflow } from '@/lib/mock-data';
import { StateBadge } from './primitives';
import { compactFigure } from './overview/dot-numeral';

/** An error share at or above this reads as trouble on a tile. */
const HOT_ERROR_PCT = 5;

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

function Figure({ label, children, hot }: { label: string; children: ReactNode; hot?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="bento-label truncate">{label}</dt>
      <dd
        className="app-tile__figure mt-0.5 truncate text-xl leading-7 tracking-[-0.01em] tabular-nums"
        data-hot={hot || undefined}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * One app as a tile. Figures come from the store's 24 h reading; when the
 * plan has no metrics or the rollup is degraded, the tile says so rather
 * than showing zeros.
 */
export function AppTile({
  slug,
  app,
  label,
  detail,
}: {
  slug: string;
  app?: Workflow;
  /** A project workload's own name, when it differs from the app's. */
  label?: string;
  /** The latest deployment's status as the project reports it. */
  detail?: string;
}) {
  const deployed = app && app.state !== 'undeployed';
  const measured = deployed && !app.metricsUnavailable;
  const hasTraffic = measured && app.invocations24h > 0;
  return (
    <li className="app-tile" data-state={app?.state ?? 'unknown'}>
      <div className="flex items-center justify-between gap-3">
        {app ? (
          <StateBadge state={app.state} />
        ) : (
          <span className="text-xs text-muted-foreground">State not loaded</span>
        )}
        {app?.runtime && <span className="bento-chip">{app.runtime}</span>}
      </div>

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
        <dl className="mt-auto grid grid-cols-3 gap-3">
          <Figure label="Req · 24h">{compactFigure(app.invocations24h)}</Figure>
          <Figure label="Errors" hot={hasTraffic && app.errorRatePct >= HOT_ERROR_PCT}>
            {hasTraffic ? `${app.errorRatePct.toFixed(app.errorRatePct < 10 ? 2 : 1)}%` : '—'}
          </Figure>
          <Figure label="Memory">
            {app.memoryMb ? (
              <>
                {memoryOf(app.memoryMb).value}
                <span className="text-sm text-muted-foreground">
                  {' '}
                  {memoryOf(app.memoryMb).unit}
                </span>
              </>
            ) : (
              '—'
            )}
          </Figure>
        </dl>
      ) : (
        <p className="mt-auto text-sm text-muted-foreground">
          {!app
            ? 'Details not loaded'
            : !deployed
              ? 'Not deployed yet'
              : app.memoryMb
                ? `${app.memoryMb} MB · request figures unavailable`
                : 'Request figures unavailable'}
        </p>
      )}

      <p className="flex items-center justify-between gap-3 font-mono text-xs text-muted-foreground">
        <span className="truncate">
          {app?.lastDeployedAt
            ? [app.version, `deployed ${formatRelative(app.lastDeployedAt)}`]
                .filter(Boolean)
                .join(' · ')
            : 'No deployments'}
        </span>
        {detail && <span className="shrink-0">{detail}</span>}
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
