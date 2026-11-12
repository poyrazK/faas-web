import { useId, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Search, Upload } from 'iconoir-react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/store';
import { useProjectMembership, type ProjectDetail } from '@/lib/api/projects';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { WorkspaceAppInventory } from '@/components/dashboard/workspace-app-inventory';
import type { Deployment, Workflow } from '@/lib/mock-data';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/primitives';
import { AppTile, AppTiles, byState } from '@/components/dashboard/app-tile';
import { latestDeployNote, projectsSummary } from '@/components/dashboard/app-tile-words';
import { HelpTip } from '@/components/dashboard/kit/help-tip';
import { Route as ProjectsRoute } from '@/routes/dashboard.projects';

const PAGE = 10;

function matches(q: string, ...values: (string | undefined)[]) {
  const needle = q.trim().toLowerCase();
  return !needle || values.some((value) => value?.toLowerCase().includes(needle));
}

/** A heading, its context and a grid of app tiles — no frame around the tiles. */
function AppGroup({
  title,
  meta,
  help,
  action,
  children,
}: {
  title: string;
  meta?: ReactNode;
  help?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    // A faint tray holds the group together, so its tiles read as one
    // project rather than loose cards.
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-[1.75rem] bg-muted/25 p-4 sm:p-5"
    >
      <header className="flex items-start justify-between gap-3 px-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="flex items-center gap-1 text-lg font-semibold tracking-[-0.01em]">
            {title}
            {help && <HelpTip label={`About ${title}`}>{help}</HelpTip>}
          </h2>
          {meta && <p className="text-[13px] text-muted-foreground">{meta}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  );
}

const appCount = (n: number | undefined) =>
  n == null ? 'Apps loading' : `${n} ${n === 1 ? 'app' : 'apps'}`;

const GroupNote = ({ children, status }: { children: ReactNode; status?: boolean }) => (
  <p role={status ? 'status' : undefined} className="text-sm text-muted-foreground">
    {children}
  </p>
);

function ProjectCard({
  slug,
  repo,
  branch,
  workloads,
  loading,
  failed,
  apps,
  deployments,
  q,
}: {
  slug: string;
  repo?: string;
  branch?: string;
  workloads?: ProjectDetail['workloads'];
  loading: boolean;
  failed: boolean;
  apps: Map<string, Workflow>;
  deployments: Deployment[];
  q: string;
}) {
  const shown = (workloads ?? []).filter((w) =>
    matches(q, slug, repo, w.slug, w.workload_name, apps.get(w.slug)?.name)
  );
  return (
    <AppGroup
      title={slug}
      meta={
        <>
          {appCount(workloads?.length)}
          {repo ? (
            <>
              {' · '}deploys {branch ? <span className="font-mono">{branch}</span> : 'pushes'} from{' '}
              <span className="font-mono">{repo}</span>
            </>
          ) : (
            ' · not connected to a repository'
          )}
        </>
      }
      action={
        <Link
          to="/dashboard/projects/$projectSlug"
          params={{ projectSlug: slug }}
          search={{ q: q || undefined }}
          aria-label={`Open project ${slug}`}
          className="pressable inline-flex h-8 items-center gap-1 rounded-full bg-muted px-3 text-[13px] text-foreground"
        >
          Open project
          <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {failed ? (
        <GroupNote>This project's apps could not be read.</GroupNote>
      ) : loading ? (
        <GroupNote status>Loading apps…</GroupNote>
      ) : !shown.length ? (
        <GroupNote>
          {workloads?.length ? 'No apps match the search.' : 'This project has no apps yet.'}
        </GroupNote>
      ) : (
        <AppTiles label={`Apps in ${slug}`} stacked>
          {shown.map((w) => (
            <AppTile
              key={w.slug}
              slug={w.slug}
              label={w.workload_name !== w.slug ? w.workload_name : undefined}
              app={apps.get(w.slug)}
              deploy={latestDeployNote(w.slug, deployments)}
            />
          ))}
        </AppTiles>
      )}
    </AppGroup>
  );
}

/**
 * Projects are the console's way in: a project is one repository and the
 * apps, environments and releases that come from it.
 *
 * Apps deployed without importing a repository (`gregale deploy` from a
 * folder, an image, a template) belong to no project — the API has no way to
 * attach one yet — so they are listed as standalone rather than hidden. Until
 * every project's membership has loaded, nothing is called standalone.
 */
export function ProjectInventory() {
  const { account } = useAuth();
  const membership = useProjectMembership(account?.id ?? '');
  const {
    workflows,
    deployments: storeDeployments,
    loading: appsLoading,
    error: appsError,
    refresh,
  } = useData();
  const deployments = storeDeployments ?? [];
  const workspace = useWorkspaceTarget();
  const { q = '' } = ProjectsRoute.useSearch();
  const navigate = ProjectsRoute.useNavigate();
  const [limit, setLimit] = useState(PAGE);
  const apps = new Map(workflows.map((app) => [app.id, app]));
  const projects = membership.projects.filter((project) => {
    const workloads = membership.workloadsOf.get(project.slug) ?? [];
    return matches(
      q,
      project.slug,
      project.repo_full_name,
      ...workloads.flatMap((w) => [w.slug, w.workload_name])
    );
  });
  const standalone = workflows.filter(
    (app) => !membership.projectOfApp.has(app.id) && matches(q, app.id, app.name, app.runtime)
  );
  const nothingYet =
    membership.state === 'ready' && !membership.projects.length && !workflows.length;
  const summary =
    membership.state === 'ready' && !appsLoading && !appsError
      ? projectsSummary({
          apps: workflows,
          projectCount: membership.projects.length,
          standaloneCount: workflows.filter((app) => !membership.projectOfApp.has(app.id)).length,
          deployments,
        })
      : null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.02em]">Projects</h1>
          {/* The answer first: what there is, then what needs a look. */}
          {summary && (
            <p className="max-w-2xl text-[15px] text-muted-foreground">
              <span className="text-foreground">{summary.what}</span>{' '}
              {summary.problems.length === 0 ? (
                'Everything is running normally.'
              ) : (
                <span className="text-status-warning">
                  {summary.problems.join('; ')}
                  {summary.extra > 0 ? `; ${summary.extra} more.` : '.'}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {!nothingYet && (
            <label className="flex h-9 min-w-56 items-center gap-2 rounded-full bg-muted px-3.5 text-muted-foreground">
              <Search aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <input
                type="search"
                aria-label="Search projects and apps"
                value={q}
                placeholder="Find a project or app"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                onChange={(event) =>
                  void navigate({
                    search: (current) => ({ ...current, q: event.target.value || undefined }),
                    replace: true,
                    resetScroll: false,
                  })
                }
              />
            </label>
          )}
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/dashboard/apps/new" search={{ source: 'import' }}>
              <Upload className="h-3.5 w-3.5" />
              Import a repository
            </Link>
          </Button>
        </div>
      </header>

      {/* A shared workspace was chosen in the switcher, so its own inventory
          comes first; projects and standalone apps below stay the signed-in
          account's. */}
      {workspace.org && (
        <WorkspaceAppInventory
          workspace={{ ...workspace, org: workspace.org }}
          ownSlugs={new Set(workflows.map((app) => app.id))}
        />
      )}

      {!account || (membership.list.isPending && !membership.list.isError) ? (
        <LoadingState message="Loading projects…" />
      ) : membership.list.isError ? (
        <ErrorState error={membership.list.error} onRetry={membership.retry} />
      ) : nothingYet ? (
        <EmptyState message="Nothing deployed yet." />
      ) : (
        <>
          {/* Projects stand side by side as columns, apps stacked inside; each
              column is as tall as its own apps, never stretched to a row's. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))] items-start gap-4">
            {projects.slice(0, limit).map((project) => {
              const index = membership.projects.indexOf(project);
              const detail = membership.details[index];
              return (
                <ProjectCard
                  key={project.id}
                  slug={project.slug}
                  repo={project.repo_full_name}
                  branch={project.production_branch}
                  workloads={membership.workloadsOf.get(project.slug)}
                  loading={Boolean(detail?.isPending)}
                  failed={Boolean(detail?.isError)}
                  apps={apps}
                  deployments={deployments}
                  q={q}
                />
              );
            })}
            <AppGroup
              title="Standalone apps"
              help="Apps deployed from a folder, an image, or a template belong to no project."
            >
              {appsError ? (
                <ErrorState error={appsError} onRetry={refresh} />
              ) : appsLoading || membership.state === 'pending' ? (
                <GroupNote status>Checking which apps belong to projects…</GroupNote>
              ) : membership.state === 'error' ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  Some projects could not be read, so standalone apps cannot be told apart yet.
                  <Button size="xs" variant="outline" onClick={membership.retry}>
                    Retry
                  </Button>
                </div>
              ) : !standalone.length ? (
                <GroupNote>
                  {q ? 'No standalone apps match the search.' : 'Every app belongs to a project.'}
                </GroupNote>
              ) : (
                <AppTiles label="Standalone apps" stacked>
                  {[...standalone].sort(byState).map((app) => (
                    <AppTile
                      key={app.id}
                      slug={app.id}
                      app={app}
                      deploy={latestDeployNote(app.id, deployments)}
                    />
                  ))}
                </AppTiles>
              )}
            </AppGroup>
          </div>
          {projects.length > limit && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => setLimit(limit + PAGE)}
            >
              Show {Math.min(PAGE, projects.length - limit)} more projects
            </Button>
          )}
          {q && !projects.length && membership.projects.length > 0 && (
            <p className="text-sm text-muted-foreground">No projects match the search.</p>
          )}
        </>
      )}
    </div>
  );
}
