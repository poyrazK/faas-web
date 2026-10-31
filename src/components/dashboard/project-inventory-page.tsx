import { useState } from 'react';
import { getRouteApi, Link } from '@tanstack/react-router';
import { Upload } from 'iconoir-react';
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
  Panel,
  StateBadge,
} from '@/components/dashboard/primitives';

const projectsRoute = getRouteApi('/dashboard/projects');

const PAGE = 10;

function matches(q: string, ...values: (string | undefined)[]) {
  const needle = q.trim().toLowerCase();
  return !needle || values.some((value) => value?.toLowerCase().includes(needle));
}

/** One app inside a project or in the standalone group. */
function AppLine({
  slug,
  label,
  app,
  detail,
}: {
  slug: string;
  label?: string;
  app?: Workflow;
  detail?: string;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
      <div className="min-w-0">
        <Link
          to="/dashboard/apps/$appSlug"
          params={{ appSlug: slug }}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {app?.name ?? slug}
        </Link>
        {(label || app?.runtime) && (
          <span className="ml-2 text-xs text-muted-foreground">
            {[label, app?.runtime].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {detail && <span>{detail}</span>}
        {app ? <StateBadge state={app.state} /> : <span>State not loaded</span>}
      </div>
    </li>
  );
}

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
    <Panel
      title={slug}
      description={[repo || 'No repository connected', branch && `deploys ${branch}`]
        .filter(Boolean)
        .join(' · ')}
      actions={
        <Button asChild size="xs" variant="ghost">
          <Link
            to="/dashboard/projects/$projectSlug"
            params={{ projectSlug: slug }}
            search={{ q: q || undefined }}
            aria-label={`Open project ${slug}`}
          >
            Open project
          </Link>
        </Button>
      }
      padded={false}
    >
      {failed ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          This project's apps could not be read.
        </p>
      ) : loading ? (
        <p role="status" className="px-5 py-4 text-sm text-muted-foreground">
          Loading apps…
        </p>
      ) : !shown.length ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          {workloads?.length ? 'No apps match the search.' : 'This project has no apps yet.'}
        </p>
      ) : (
        <ul aria-label={`Apps in ${slug}`} className="divide-y divide-border">
          {shown.map((w) => (
            <AppLine
              key={w.slug}
              slug={w.slug}
              label={w.workload_name !== w.slug ? w.workload_name : undefined}
              app={apps.get(w.slug)}
              detail={w.deployment_status}
            />
          ))}
        </ul>
      )}
    </Panel>
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
  const { q = '' } = projectsRoute.useSearch();
  const navigate = projectsRoute.useNavigate();
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        description="A project is one repository and everything deployed from it — its apps, environments, and releases."
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
        <EmptyState message="Nothing deployed yet. Import a repository to create your first project, or deploy a single app." />
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

          <Panel
            title="Standalone apps"
            description="Deployed from a folder, an image, or a template rather than an imported repository, so they belong to no project."
            padded={false}
          >
            {appsError ? (
              <ErrorState error={appsError} onRetry={refresh} />
            ) : appsLoading || membership.state === 'pending' ? (
              <p role="status" className="px-5 py-4 text-sm text-muted-foreground">
                Checking which apps belong to projects…
              </p>
            ) : membership.state === 'error' ? (
              <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm text-muted-foreground">
                Some projects could not be read, so standalone apps cannot be told apart yet.
                <Button size="xs" variant="outline" onClick={membership.retry}>
                  Retry
                </Button>
              </div>
            ) : !standalone.length ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                {q ? 'No standalone apps match the search.' : 'Every app belongs to a project.'}
              </p>
            ) : (
              <ul aria-label="Standalone apps" className="divide-y divide-border">
                {standalone.map((app) => (
                  <AppLine key={app.id} slug={app.id} app={app} />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
