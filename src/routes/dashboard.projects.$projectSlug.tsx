import { createFileRoute, Link } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useProject } from '@/lib/api/projects';
import { ErrorState, LoadingState, PageHeader, Panel } from '@/components/dashboard/primitives';
import { ProjectWorkloads } from '@/components/dashboard/projects/project-workloads';
import { Route as ProjectsRoute } from './dashboard.projects';
export const Route = createFileRoute('/dashboard/projects/$projectSlug')({
  component: ProjectPage,
});
function ProjectPage() {
  const { projectSlug } = Route.useParams();
  const { account } = useAuth();
  const query = useProject(account?.id ?? '', projectSlug);
  const { q } = ProjectsRoute.useSearch();
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!account || query.isPending) return <LoadingState message="Loading project…" />;
  const project = query.data;
  if (!project || project.slug !== projectSlug)
    return (
      <ErrorState
        error={new Error('The project response does not match this selection.')}
        onRetry={() => void query.refetch()}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/dashboard/projects"
        search={{ q }}
        className="w-fit text-sm text-muted-foreground hover:text-foreground"
      >
        All projects
      </Link>
      <PageHeader
        title={project.slug}
        description="Project membership and latest reported workload state. Read-only."
      />
      <Panel title="Project details">
        <dl className="grid gap-4 p-4 text-sm sm:grid-cols-2">
          {[
            ['Repository', project.repo_full_name || 'Not connected'],
            ['Production branch', project.production_branch || 'Not configured'],
            ['Last reconciliation', project.last_reconciliation_status || 'Unknown'],
            ['Last build', project.last_build_status || 'Unknown'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-all">{value}</dd>
            </div>
          ))}
        </dl>
        {project.exclusions.length > 0 && (
          <p className="border-t border-border p-4 text-xs text-muted-foreground">
            Excluded workloads: {project.exclusions.join(', ')}
          </p>
        )}
      </Panel>
      <ProjectWorkloads key={`${account.id}:${project.id}`} workloads={project.workloads} />
    </div>
  );
}
