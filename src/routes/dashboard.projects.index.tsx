import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useProjects, type ProjectSummary } from '@/lib/api/projects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingState, PageHeader, Panel } from '@/components/dashboard/primitives';
import { Route as ProjectsRoute } from './dashboard.projects';
export const Route = createFileRoute('/dashboard/projects/')({ component: ProjectInventory });
function Rows({ items, q }: { items: ProjectSummary[]; q: string }) {
  const [limit, setLimit] = useState(10);
  return (
    <>
      <div className="overflow-x-auto">
        <table aria-label="Projects" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              {['Project', 'Repository', 'Production branch', 'Workloads', 'Updated'].map(
                (label) => (
                  <th key={label} scope="col" className="px-4 py-3 font-medium">
                    {label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.slice(0, limit).map((project) => (
              <tr key={project.id}>
                <th scope="row" className="px-4 py-3 font-medium">
                  <Link
                    className="text-brand underline-offset-4 hover:underline"
                    to="/dashboard/projects/$projectSlug"
                    params={{ projectSlug: project.slug }}
                    search={{ q: q || undefined }}
                  >
                    {project.slug}
                  </Link>
                </th>
                <td className="px-4 py-3">{project.repo_full_name || 'Not connected'}</td>
                <td className="px-4 py-3">{project.production_branch || 'Not configured'}</td>
                <td className="px-4 py-3 tabular-nums">{project.workload_count}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {Number.isNaN(Date.parse(project.updated_at))
                    ? 'Unknown'
                    : new Date(project.updated_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > limit && (
        <div className="p-4">
          <Button size="sm" variant="outline" onClick={() => setLimit(limit + 10)}>
            Show 10 more projects
          </Button>
        </div>
      )}
    </>
  );
}
export function ProjectInventory() {
  const { account } = useAuth();
  const query = useProjects(account?.id ?? '');
  const { q = '' } = ProjectsRoute.useSearch();
  const navigate = ProjectsRoute.useNavigate();
  const items = (query.data ?? []).filter((project) =>
    `${project.slug} ${project.repo_full_name ?? ''}`.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Repository-backed projects and the workloads they own. Console labels are separate from this inventory."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/workflows/new" search={{ source: 'import' }}>
              Import a project
            </Link>
          </Button>
        }
      />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !account || query.isPending ? (
        <LoadingState message="Loading projects…" />
      ) : !query.data?.length ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <Panel title="Project inventory" description={`${query.data.length} projects`}>
          <div className="p-4">
            <label className="flex max-w-sm flex-col gap-2 text-sm">
              Search projects
              <Input
                value={q}
                onChange={(event) =>
                  void navigate({
                    search: (current) => ({ ...current, q: event.target.value || undefined }),
                    replace: true,
                    resetScroll: false,
                  })
                }
              />
            </label>
          </div>
          {items.length ? (
            <Rows key={q} items={items} q={q} />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No matching projects.</p>
          )}
        </Panel>
      )}
    </div>
  );
}
