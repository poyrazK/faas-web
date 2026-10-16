import type { ReactNode } from 'react';
import { ArrowLeft, Circle, OpenNewWindow } from 'iconoir-react';
import { Link } from '@tanstack/react-router';
import type { Workflow } from '@/lib/mock-data';
import type { Deployment } from '@/lib/api/queries';
import { deploymentPhase } from '@/lib/deployment-status';
import { publicAppUrl } from '@/lib/app-url';

type Read<T> = { data?: T; isPending: boolean; error: unknown };

const APP_STATES: Record<string, { label: string; tone: string }> = {
  active: { label: 'Running', tone: 'var(--status-good)' },
  running: { label: 'Running', tone: 'var(--status-good)' },
  // apid's word for a parked app: its VM is snapshotted and released.
  evicted_cold: { label: 'Idle', tone: 'var(--muted-foreground)' },
  undeployed: { label: 'Not deployed', tone: 'var(--muted-foreground)' },
  parked: { label: 'Idle', tone: 'var(--muted-foreground)' },
  stopped: { label: 'Stopped', tone: 'var(--muted-foreground)' },
  idle: { label: 'Idle', tone: 'var(--muted-foreground)' },
  deploying: { label: 'Deploying', tone: 'var(--status-warning)' },
  pending: { label: 'Pending', tone: 'var(--status-warning)' },
  building: { label: 'Building', tone: 'var(--status-warning)' },
  error: { label: 'App error', tone: 'var(--status-critical)' },
  failed: { label: 'App error', tone: 'var(--status-critical)' },
  crashed: { label: 'App crashed', tone: 'var(--status-critical)' },
};

/**
 * What the app is doing, as one label.
 *
 * The app row alone cannot say "never deployed" — an empty app and a parked
 * one both report idle — so the deployment history decides that, and until
 * it has answered the state is unconfirmed rather than guessed. A state the
 * console does not know is shown as the platform wrote it, never as Idle.
 */
export function appStatus(app: Workflow, releases: Read<Deployment[]>) {
  const releasesReady = !releases.isPending && !releases.error;
  const latest = releases.data?.[0];
  if (releasesReady && !latest) return { label: 'Not deployed', tone: 'var(--muted-foreground)' };
  if (!latest && !releasesReady)
    return { label: 'Status unconfirmed', tone: 'var(--muted-foreground)' };
  const raw = app.reportedStatus?.trim() || app.state;
  return Object.hasOwn(APP_STATES, raw.toLowerCase())
    ? APP_STATES[raw.toLowerCase()]
    : { label: raw, tone: 'var(--muted-foreground)' };
}

/**
 * The app's address, and whether it is safe and worth linking to: only an
 * API-assigned http(s) URL, only for a public app, and only once a release is
 * live — before that the link leads to an error page.
 */
export function appEndpoint(app: Workflow, releases: Read<Deployment[]>) {
  if (app.visibility === 'internal') return { kind: 'internal' as const };
  const href = publicAppUrl(app.url);
  if (!href) return { kind: 'none' as const };
  const host = href.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const live =
    !releases.isPending &&
    !releases.error &&
    Boolean(releases.data?.some((release) => deploymentPhase(release.status) === 'live'));
  return { kind: live ? ('live' as const) : ('pending' as const), href, host };
}

/**
 * The app page's header. It is the same on every tab — the Overview used to
 * drop the subtitle and badge and restate them in a card, so the tab strip
 * jumped as you moved between tabs and the address appeared twice.
 */
export function AppHeader({
  app,
  releases,
  project,
  actions,
}: {
  app: Workflow;
  releases: Read<Deployment[]>;
  /** The project this app belongs to, when known; standalone apps have none. */
  project?: string;
  actions: ReactNode;
}) {
  const status = appStatus(app, releases);
  const endpoint = appEndpoint(app, releases);
  return (
    <div className="flex flex-col gap-4">
      {project ? (
        <Link
          to="/dashboard/projects/$projectSlug"
          params={{ projectSlug: project }}
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Project {project}
        </Link>
      ) : (
        <Link
          to="/dashboard/projects"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Projects
        </Link>
      )}
      <div className="animate-item-enter flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
              {app.name}
            </h1>
            <span
              role="group"
              aria-label="App status"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
            >
              <Circle
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 fill-current"
                style={{ color: status.tone }}
              />
              {status.label}
            </span>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span>{app.runtime}</span>
            <span aria-hidden>·</span>
            <span>{app.memoryMb} MB</span>
            {endpoint.kind !== 'none' && <span aria-hidden>·</span>}
            {endpoint.kind === 'internal' && <span>Internal only</span>}
            {endpoint.kind === 'pending' && (
              <span className="[overflow-wrap:anywhere]">{endpoint.host}</span>
            )}
            {endpoint.kind === 'live' && (
              <a
                href={endpoint.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Endpoint ${endpoint.host}`}
                className="inline-flex items-center gap-1 text-brand underline-offset-2 [overflow-wrap:anywhere] hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {endpoint.host}
                <OpenNewWindow aria-hidden className="h-3 w-3 shrink-0" />
              </a>
            )}
          </p>
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}
