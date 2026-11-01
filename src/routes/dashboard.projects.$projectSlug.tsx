import { createFileRoute, Link } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useProject } from '@/lib/api/projects';
import { canonicalApprovalId, validApprovalId } from '@/lib/api/approval-id';
import { ErrorState, LoadingState, PageHeader, Panel } from '@/components/dashboard/primitives';
import { ProjectWorkloads } from '@/components/dashboard/projects/project-workloads';
import { ProjectEnvironments } from '@/components/dashboard/projects/environment-selector';
import type { ReadinessSearch } from '@/components/dashboard/projects/environment-readiness';
import { ProjectPreviews } from '@/components/dashboard/projects/preview-workload-set';
import { ProjectSourceSettings } from '@/components/dashboard/projects/project-source-settings';
import { ProjectDangerZone } from '@/components/dashboard/projects/project-danger-zone';
import { Route as ProjectsRoute } from './dashboard.projects';
export const Route = createFileRoute('/dashboard/projects/$projectSlug')({
  component: ProjectPage,
  validateSearch: (
    search: Record<string, unknown>
  ): ReadinessSearch & {
    environment?: string;
    compare?: string;
    preview?: string;
    queueWorkload?: string;
  } => {
    const selection = (value: unknown) =>
      value === undefined ? undefined : typeof value === 'string' ? value : '__invalid__';
    return {
      environment: selection(search.environment),
      compare: selection(search.compare),
      preview: selection(search.preview),
      queueWorkload: selection(search.queueWorkload),
      promotion:
        typeof search.promotion === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(search.promotion)
          ? search.promotion
          : undefined,
      approval:
        typeof search.approval === 'string' && validApprovalId(search.approval)
          ? canonicalApprovalId(search.approval)
          : undefined,
      promotionBefore:
        typeof search.promotionBefore === 'string' && search.promotionBefore.length <= 4096
          ? search.promotionBefore
          : undefined,
      promotionStatus: ['running', 'succeeded', 'failed'].includes(search.promotionStatus as string)
        ? (search.promotionStatus as ReadinessSearch['promotionStatus'])
        : undefined,
    };
  },
});
function ProjectPage() {
  const { projectSlug } = Route.useParams();
  const { account } = useAuth();
  const query = useProject(account?.id ?? '', projectSlug);
  const { q } = ProjectsRoute.useSearch();
  const search = Route.useSearch();
  const { environment, compare, preview, queueWorkload } = search;
  const navigate = Route.useNavigate();
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
        description="Project membership, environment evidence and stage desired queue settings."
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
      <ProjectSourceSettings
        key={`settings:${account.id}:${project.id}:${project.updated_at}`}
        accountId={account.id}
        project={project}
      />
      <ProjectWorkloads key={`${account.id}:${project.id}`} workloads={project.workloads} />
      <ProjectEnvironments
        accountId={account.id}
        plan={account.plan}
        projectId={project.id}
        slug={projectSlug}
        environment={environment}
        compare={compare}
        queueWorkload={queueWorkload}
        readinessSearch={search}
        onReadinessSearch={(patch) =>
          void navigate({ search: (current) => ({ ...current, ...patch }), resetScroll: false })
        }
        onChange={(next) =>
          void navigate({
            search: (current) => ({
              ...current,
              ...next,
              queueWorkload:
                current.environment === next.environment ? current.queueWorkload : undefined,
              promotion: undefined,
              approval: undefined,
              promotionBefore: undefined,
              promotionStatus: undefined,
            }),
            resetScroll: false,
          })
        }
        onSelectQueueWorkload={(slug) =>
          void navigate({
            search: (current) => ({ ...current, queueWorkload: slug }),
            resetScroll: false,
          })
        }
      />
      <ProjectPreviews
        key={`previews:${account.id}:${project.id}`}
        accountId={account.id}
        projectSlug={projectSlug}
        parents={project.workloads.map((workload) => workload.slug)}
        selected={preview}
        onSelect={(slug) =>
          void navigate({
            search: (current) => ({ ...current, preview: slug }),
            resetScroll: false,
          })
        }
      />
      <ProjectDangerZone
        key={`danger:${account.id}:${project.id}`}
        accountId={account.id}
        project={project}
        onDeleted={() => void navigate({ to: '/dashboard/projects', search: { q } })}
      />
    </div>
  );
}
