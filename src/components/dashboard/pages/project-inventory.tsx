import { useId, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Upload } from 'iconoir-react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/store';
import { useProjectMembership, type ProjectDetail } from '@/lib/api/projects';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { WorkspaceAppInventory } from '@/components/dashboard/workspace-app-inventory';
import type { Workflow } from '@/lib/mock-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@/components/dashboard/primitives';
import { AppTile, AppTiles, byState } from '@/components/dashboard/app-tile';
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
    <section aria-labelledby={id} className="flex flex-col gap-3.5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={id} className="flex items-center gap-1 text-xl font-semibold tracking-[-0.01em]">
            {title}
            {help && <HelpTip label={`About ${title}`}>{help}</HelpTip>}
          </h2>
          {meta && <span className="font-mono text-xs text-muted-foreground">{meta}</span>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

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
  q,
}: {
  slug: string;
  repo?: string;
  branch?: string;
  workloads?: ProjectDetail['workloads'];
  loading: boolean;
  failed: boolean;
  apps: Map<string, Workflow>;
  q: string;
}) {
  const shown = (workloads ?? []).filter((w) =>
    matches(q, slug, repo, w.slug, w.workload_name, apps.get(w.slug)?.name)
  );
  return (
    <AppGroup
      title={slug}
      meta={[repo || 'No repository connected', branch && `deploys ${branch}`]
        .filter(Boolean)
        .join(' · ')}
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
        <AppTiles label={`Apps in ${slug}`}>
          {shown.map((w) => (
            <AppTile
              key={w.slug}
              slug={w.slug}
              label={w.workload_name !== w.slug ? w.workload_name : undefined}
              app={apps.get(w.slug)}
              detail={w.deployment_status}
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
  const { workflows, loading: appsLoading, error: appsError, refresh } = useData();
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

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Projects"
        actions={
          <>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/dashboard/apps/new" search={{ source: 'import' }}>
                <Upload className="h-3.5 w-3.5" />
                Import a repository
              </Link>
            </Button>
          </>
        }
      />

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
          <label className="flex max-w-sm flex-col gap-2 text-sm">
            Search projects and apps
            <Input
              value={q}
              placeholder="Project, repository, or app"
              onChange={(event) =>
                void navigate({
                  search: (current) => ({ ...current, q: event.target.value || undefined }),
                  replace: true,
                  resetScroll: false,
                })
              }
            />
          </label>

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
                q={q}
              />
            );
          })}
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
              <AppTiles label="Standalone apps">
                {[...standalone].sort(byState).map((app) => (
                  <AppTile key={app.id} slug={app.id} app={app} />
                ))}
              </AppTiles>
            )}
          </AppGroup>
        </>
      )}
    </div>
  );
}
